#include "deck/session_commands.h"
#include <Arduino.h>
#include <esp_mac.h>
#include <string.h>
#include "common/key_image.h"
#include "deck/deck.h"
#include "decky_version.h"
#include "keygrid.h"
#include "keys/die/die.h"
#include "network/wireless.h"
#include "panel.h"
#include "protocol/identity.h"
#include "storage/artwork_store.h"

namespace {
Stream &reply() { return wireless::reply(); }
}  // namespace

bool SessionCommands::run(const char *name, const char *line) {
    static const Command COMMANDS[] = {
        {"ID", &SessionCommands::identify},
        {"HELLO", &SessionCommands::hello},
        {"PING", &SessionCommands::ping},
        {"BYE", &SessionCommands::bye},
        {"UPDATING", &SessionCommands::updating},
        {"BLOCK", &SessionCommands::block},
        {"DRAG", &SessionCommands::drag},
        {"SDINFO", &SessionCommands::storage},
        {"SCREEN", &SessionCommands::screen},
        {"DISPLAY_STATE", &SessionCommands::display_state},
        {"DISPLAY_RESYNC", &SessionCommands::display_resync},
    };
    return run_from(COMMANDS, name, line);
}

// `OK id decky <protocol> <serial> ...` - the geometry, and a flag for each
// command an older desktop can do without: live=1 LIVE patches, drag=1 finger
// movement, wheel=1 drums, dial=1 dials and dice, warm=1 every page's widgets
// while loading, block= the largest USB block, slide=1 sliding text, sweep=1
// rings' arcs the deck moves.
bool SessionCommands::identify(const char *line) {
    if (strcmp(line, "ID") != 0) return false;
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    reply().printf(
        "OK id decky %d %02x%02x%02x%02x%02x%02x cells=%d cols=%d rows=%d w=%d h=%d pages=%d cache=%d storage=%d fw=%s "
        "live=1 drag=1 wheel=1 dial=1 warm=1 block=%u slide=1 sweep=1 reset=%s\n",
        DECKY_PROTOCOL, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], keygrid::COUNT, keygrid::COLS, keygrid::ROWS,
        KeyImage::width(), KeyImage::height(), PageCache::MAX_PAGES, PageCache::CACHE_SLOTS,
        artwork_store::available() ? 1 : 0, DECKY_FW_VERSION, static_cast<unsigned>(Transfer::SERIAL_BLOCK_MAX),
        reset_reason());
    return true;
}

// Loading: <units> counts every key, ON picture, widget picture and look to come.
bool SessionCommands::hello(const char *line) {
    if (strncmp(line, "HELLO ", 6) != 0) return false;
    Session &session = deck_.session();
    int pages = 0, units = 0;
    char extra = 0;
    const int count = sscanf(line, "HELLO %d %d %c", &pages, &units, &extra);
    if ((count != 1 && count != 2) || pages < 1 || pages > PageCache::CACHE_SLOTS ||
        (count == 2 && (units < pages * keygrid::COUNT || units > pages * keygrid::COUNT * 3))) {
        reply().println("ERR cache capacity exceeded");
        return true;
    }
    session.online = true;
    session.updating_until = 0;
    deck_.drag().clear();
    deck_.transfer().reset_block();
    deck_.animations().disarm_all();
    deck_.pages().drop_lives();
    session.warming = true;
    session.transitioning = true;
    session.warm_total = count == 2 ? units : pages * keygrid::COUNT;
    session.warm_done = 0;
    deck_.pages().pending = nullptr;
    deck_.status().show(15);
    reply().println("OK warming");
    return true;
}

bool SessionCommands::ping(const char *line) {
    if (strcmp(line, "PING") != 0) return false;
    reply().printf("OK ping online=%d\n", deck_.session().online ? 1 : 0);
    return true;
}

bool SessionCommands::bye(const char *line) {
    if (strcmp(line, "BYE") != 0) return false;
    deck_.disconnected();
    reply().println("OK disconnected");
    return true;
}

// Decky on the PC is updating itself: the percent follows its download, and
// the screen stays while Decky closes for the installer. END means it stopped
// - cancelled or failed - and the deck goes back to its page.
bool SessionCommands::updating(const char *line) {
    if (strncmp(line, "UPDATING ", 9) != 0) return false;
    Session &session = deck_.session();
    int percent = 0;
    char extra = 0;
    if (strcmp(line + 9, "END") == 0) {
        session.updating_until = 0;
        Page *active = deck_.pages().active;
        if (active && active->complete) {
            deck_.status().hide();
            deck_.view().draw_page();
        } else deck_.disconnected();
        reply().println("OK updating end");
    } else if (sscanf(line + 9, "%d %c", &percent, &extra) == 1 && percent >= 0 && percent <= 100) {
        session.online = true;
        session.transitioning = false;
        session.updating_until = millis() + Session::UPDATING_HOLD_MS;
        if (!session.updating_until) session.updating_until = 1;
        deck_.status().show(percent, "Updating Decky");
        reply().println("OK updating");
    } else
        reply().println("ERR invalid update progress");
    return true;
}

// Uploads over USB in blocks of <n> bytes from here, until HELLO or the desktop goes.
bool SessionCommands::block(const char *line) {
    unsigned int bytes = 0;
    char extra = 0;
    if (sscanf(line, "BLOCK %u %c", &bytes, &extra) != 1) return false;
    if (!deck_.transfer().set_block(bytes)) reply().println("ERR invalid block");
    else reply().printf("OK block %u\n", bytes);
    return true;
}

// The keys to report finger movement on: 15 bits, one per key; 0 for none.
bool SessionCommands::drag(const char *line) {
    unsigned int mask = 0;
    char extra = 0;
    if (sscanf(line, "DRAG %u %c", &mask, &extra) != 1) return false;
    deck_.drag().set(mask);
    reply().println("OK drag");
    return true;
}

bool SessionCommands::storage(const char *line) {
    if (strcmp(line, "SDINFO") != 0) return false;
    reply().printf("OK storage card=%d bytes=%llu\n", artwork_store::available() ? 1 : 0,
                   static_cast<unsigned long long>(artwork_store::capacity()));
    return true;
}

// The whole framebuffer, as the panel scans it out.
bool SessionCommands::screen(const char *line) {
    if (strcmp(line, "SCREEN") != 0) return false;
    reply().printf("OK screen %d %d %d\n", panel::WIDTH, panel::HEIGHT, panel::WIDTH * panel::HEIGHT * 2);
    reply().write(reinterpret_cast<const uint8_t *>(panel::framebuffer()), panel::WIDTH * panel::HEIGHT * 2);
    reply().println("OK screen complete");
    deck_.session().heard(millis());
    return true;
}

// Scanout health: the bounce position at the last frame end (76800 when
// right), EOFs per frame since the last ask (10 when right), slipped pictures
// averted since boot, the last page redraw and the last animation frame
// composed (us), frames since boot, and a die's last frame in parts.
bool SessionCommands::display_state(const char *line) {
    if (strcmp(line, "DISPLAY_STATE") != 0) return false;
    int32_t pos = 0;
    uint32_t low = 0, high = 0, fixed = 0;
    if (!panel::scanout_state(pos, low, high, fixed)) {
        reply().println("ERR display state unavailable");
        return true;
    }
    const uint32_t *die = keys::Die::timings();
    const keys::AnimatedKeys &animations = deck_.animations();
    reply().printf(
        "OK display pos=%ld eofs=%lu..%lu corrected=%lu draw=%lu wheel=%lu frames=%lu die=%lu/%lu/%lu/%lu "
        "overlays=%lu/%lu gap=%lu\n",
        static_cast<long>(pos), static_cast<unsigned long>(low), static_cast<unsigned long>(high),
        static_cast<unsigned long>(fixed), static_cast<unsigned long>(deck_.view().page_draw_us()),
        static_cast<unsigned long>(animations.compose_us()), static_cast<unsigned long>(animations.frames()),
        static_cast<unsigned long>(die[0]), static_cast<unsigned long>(die[1]), static_cast<unsigned long>(die[2]),
        static_cast<unsigned long>(die[3]), static_cast<unsigned long>(deck_.view().overlays_drawn()),
        static_cast<unsigned long>(deck_.view().overlay_us()),
        static_cast<unsigned long>(deck_.view().take_longest_gap_us()));
    return true;
}

bool SessionCommands::display_resync(const char *line) {
    if (strcmp(line, "DISPLAY_RESYNC") != 0) return false;
    reply().println(panel::recover_scanout() ? "OK display realigned" : "ERR display recovery failed");
    return true;
}
