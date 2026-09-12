#include "keys/key_commands.h"
#include <Arduino.h>
#include <string.h>
#include "common/memory.h"
#include "deck/deck.h"
#include "keygrid.h"
#include "network/wireless.h"

namespace {
Stream &reply() { return wireless::reply(); }
}  // namespace

bool KeyCommands::run(const char *name, const char *line) {
    static const Command COMMANDS[] = {
        {"WHEEL", &KeyCommands::upload},
        {"WHEELAT", &KeyCommands::arm},
        {"WHEELROLL", &KeyCommands::roll},
        {"WHEELSPIN", &KeyCommands::spin},
    };
    return run_from(COMMANDS, name, line);
}

// Spin a drum on the page shown to a label and land on it (a dice roll), or
// throw a die.
bool KeyCommands::roll(const char *line) {
    int page = 0, cell = 0, index = 0;
    unsigned int signature = 0;
    char extra = 0;
    if (sscanf(line, "WHEELROLL %d %u %d %d %c", &page, &signature, &cell, &index, &extra) != 4) return false;
    const Page *active = deck_.pages().active;
    if (!active || active->id != page || active->signature != signature ||
        !deck_.animations().armed(cell, page, signature)) {
        reply().println("ERR invalid wheel");
        return true;
    }
    deck_.animations().roll(cell, index, millis());
    reply().println("OK roll");
    return true;
}

// Diagnostics: set a drum coasting at <tenths of labels a second>, as a flick would.
bool KeyCommands::spin(const char *line) {
    int cell = 0, units = 0;
    char extra = 0;
    if (sscanf(line, "WHEELSPIN %d %d %c", &cell, &units, &extra) != 2) return false;
    deck_.animations().spin(cell, units / 10.f, millis());
    reply().println("OK spin");
    return true;
}

// A look for a key of the page shown, and the label it starts on. The look is
// kept by its CRC, so arming the same one again (WHEELAT) sends none. Cell -1
// only keeps the look, for a page not shown yet: loading sends every page's
// ahead, so a page opens with its animations at once.
bool KeyCommands::upload(const char *line) {
    int id = 0, cell = 0, index = 0;
    unsigned int signature = 0, bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "WHEEL %d %u %d %d %u %u %c", &id, &signature, &cell, &index, &bytes, &checksum, &extra) != 6)
        return false;
    Session &session = deck_.session();
    keys::AnimatedKeys &animations = deck_.animations();
    const bool ahead = cell == -1;
    Page *page = deck_.pages().find(id, signature);
    if (!page || (!ahead && (page != deck_.pages().active || cell < 0 || cell >= keygrid::COUNT)) || !bytes ||
        bytes > keys::AnimatedKeys::MAX_BYTES) {
        reply().println("ERR invalid wheel");
        return true;
    }
    if (ahead && animations.known(checksum)) {
        if (session.warming) {
            ++session.warm_done;
            deck_.warm_progress();
        }
        reply().println("OK wheel cached=1");
        return true;
    }
    auto *payload = static_cast<uint8_t *>(memory::psram(bytes));
    if (!payload) {
        reply().println("ERR wheel allocation failed");
        return true;
    }
    if (!deck_.transfer().read(payload, bytes, checksum)) {
        free(payload);
        return true;
    }
    session.heard(millis());
    const keys::AnimatedKeys::Loaded loaded = animations.load(payload, bytes, checksum);
    if (loaded != keys::AnimatedKeys::Loaded::Kept) {
        reply().println(loaded == keys::AnimatedKeys::Loaded::NoRoom ? "ERR wheel memory" : "ERR wheel payload");
        return true;
    }
    if (ahead) {
        if (session.warming) {
            ++session.warm_done;
            deck_.warm_progress();
        }
        reply().println("OK wheel");
        return true;
    }
    if (!animations.arm(cell, id, signature, checksum, index)) {
        reply().println("ERR wheel index");
        return true;
    }
    if (deck_.panel_free()) deck_.view().draw_key(cell, false);
    reply().println("OK wheel");
    return true;
}

// Arm a key with a look the deck already keeps, or move it to a label; index
// -1 takes the animation away and the key shows its page's picture again.
bool KeyCommands::arm(const char *line) {
    int id = 0, cell = 0, index = 0;
    unsigned int signature = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "WHEELAT %d %u %d %d %u %c", &id, &signature, &cell, &index, &checksum, &extra) != 5)
        return false;
    keys::AnimatedKeys &animations = deck_.animations();
    Page *page = deck_.pages().find(id, signature);
    if (!page || page != deck_.pages().active || cell < 0 || cell >= keygrid::COUNT) {
        reply().println("ERR invalid wheel");
        return true;
    }
    if (index < 0) animations.disarm(cell);
    else if (!animations.known(checksum)) {
        reply().println("ERR wheel unknown");
        return true;
    } else if (!animations.arm(cell, id, signature, checksum, index)) {
        reply().println("ERR wheel index");
        return true;
    }
    if (deck_.panel_free()) deck_.view().draw_key(cell, false);
    reply().println("OK wheel");
    return true;
}
