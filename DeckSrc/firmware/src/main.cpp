// Decky v5: independent OFF/ON images eliminate whole-page toggle uploads.
// Static page images are cached in PSRAM. No changes to the measured RGB timing or touch bus.
#include <Arduino.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <limits.h>
#include "keygrid.h"
#include "panel.h"
#include "decky_logo.h"
#include "decky_version.h"
#include "wireless.h"
#include "artwork_store.h"
#include "live_patch.h"
#include "wheel.h"
#include "slide.h"

namespace {
constexpr int CACHE_SLOTS = 8;
// Two staging slots preserve all advertised pages while replacing artwork,
// including the old active page that stays visible until the final PAGE command.
constexpr int STORAGE_SLOTS = CACHE_SLOTS + 2;
constexpr int MAX_PAGES = 64;
constexpr size_t BLOCK_BYTES = 128;
constexpr uint32_t PRESS_GAP_MS = 120;
struct CachedPage {
    int id = -1;
    uint32_t signature = 0;
    uint32_t used = 0;
    uint16_t mask = 0;
    uint16_t lit_mask = 0;
    uint16_t *pixels = nullptr;
    bool complete = false;
    uint16_t *alternates[15] = {};
    uint32_t alternate_crc[15] = {};
    uint16_t alternate_lit = 0;
    uint16_t artwork_dirty = 0;
    // Widget keys' current pictures (LIVE), kept apart from the page's own:
    // those stay exactly as the desktop sent them, so they match the
    // signature, the card's copy loads, and a new version of the page needs
    // only its changed keys.
    uint16_t *live[15] = {};
    // Keys whose text is too long for them, slid along by the deck (SLIDE)
    // over their live picture, and going with it.
    slide::Text *texts[15] = {};
};
// A key's live picture goes, and the sliding text over it with it.
void drop_live(CachedPage &page, int cell) {
    free(page.live[cell]);
    page.live[cell] = nullptr;
    slide::release(page.texts[cell]);
    page.texts[cell] = nullptr;
}
void drop_lives(CachedPage &page) {
    for (int cell = 0; cell < 15; ++cell) drop_live(page, cell);
}
CachedPage cache[STORAGE_SLOTS];
CachedPage *active = nullptr;
CachedPage *pending = nullptr;
int current_page = 0;
uint16_t current_state = 0;
int pressed_cell = -1;
int pressed_page = 0;
// Keys the desktop asked with DRAG to hear finger movement on (its wheels),
// and the last height sent for the finger on one.
uint16_t drag_mask = 0;
int drag_sent_y = 0;
uint32_t drag_sent_ms = 0;
bool contact_down = false;
bool transitioning = false;
bool initialized = false;
bool host_online = false;
bool warming = false;
bool showing_status = false;
bool pending_activate = true;
uint32_t last_host_ms = 0;
// While Decky on the PC updates itself (UPDATING), the deck says so instead of
// Disconnected, until the new version says HELLO or this passes.
uint32_t updating_until = 0;
constexpr uint32_t UPDATING_HOLD_MS = 180000;
int warm_total = 15;
int warm_done = 0;
constexpr uint32_t HOST_TIMEOUT_MS = 12000;
uint32_t last_press_ms = 0;
uint32_t pending_at = 0;
uint32_t vsync_ref_us = 0;
uint32_t vsync_at = 0;
uint32_t write_estimate_us = 2000;
constexpr uint32_t WRITE_ESTIMATE_FLOOR_US = 1000;
uint32_t page_draw_us = 0;  // the last full page redraw, for DISPLAY_STATE
int image_w = 0;
int image_h = 0;
size_t cell_pixels = 0;
constexpr size_t PSRAM_FLOOR = 768 * 1024;
size_t page_bytes() { return cell_pixels * keygrid::COUNT * sizeof(uint16_t); }
// A key as it shows when not switched on: its live picture, else its own.
uint16_t *shown_off(CachedPage &page, int cell) {
    return page.live[cell] ? page.live[cell] : page.pixels + cell_pixels * cell;
}
// Room for one more live picture that still leaves the floor free and a whole
// page in one piece: live pictures must never be why a page cannot be built.
bool live_room() {
    const size_t key = cell_pixels * sizeof(uint16_t);
    return heap_caps_get_free_size(MALLOC_CAP_SPIRAM) >= key + page_bytes() + PSRAM_FLOOR &&
           heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM) >= key + page_bytes();
}
uint16_t *new_live(CachedPage &page, int cell) {
    if (!live_room()) return nullptr;
    page.live[cell] = static_cast<uint16_t*>(heap_caps_malloc(cell_pixels * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    return page.live[cell];
}

void resync_beam() {
    if (millis() - vsync_at < 200 && vsync_at) return;
    if (panel::wait_vsync()) { vsync_ref_us = micros(); vsync_at = millis(); }
}
// Whether a region can be written now without tearing: the beam is far enough
// above it for the write to finish first, or already past it with enough of the
// frame left before it comes round again.
bool cell_clear(const keygrid::Rect &rect) {
    resync_beam();
    const uint32_t period = panel::frame_period_us();
    const uint32_t phase = (micros() - vsync_ref_us) % period;
    const int beam = static_cast<int>(static_cast<float>(phase) / period * panel::V_TOTAL) - panel::VSYNC_PULSE_WIDTH - panel::VSYNC_BACK_PORCH;
    const int advance = static_cast<int>(static_cast<float>(write_estimate_us) / period * panel::V_TOTAL);
    return beam + advance < rect.y || (beam > rect.y + rect.h && panel::V_TOTAL - beam + rect.y > advance);
}
void wait_for_cell(const keygrid::Rect &rect) {
    const uint32_t deadline = micros() + panel::frame_period_us() * 2;
    while (!cell_clear(rect) && static_cast<int32_t>(deadline - micros()) > 0) {}
}
// A key's sliding text as it is now, over the key's picture (`source`), onto
// the screen: only the rows and columns the text covers.
void write_text(int cell, const uint16_t *source) {
    slide::Text *text = active->texts[cell];
    const slide::Box box = slide::box(text);
    slide::frame(text, millis());
    const keygrid::Rect rect = keygrid::cell(cell);
    uint16_t *frame = panel::framebuffer();
    static uint16_t line[panel::WIDTH];
    int composed = -1;
    for (int y = 0; y < rect.h; ++y) {
        const int sy = y * image_h / rect.h;
        if (sy < box.y || sy >= box.y + box.h) continue;
        if (sy != composed) { slide::row(text, sy, source + sy * image_w, line); composed = sy; }
        uint16_t *target = frame + (rect.y + y) * panel::WIDTH + rect.x;
        if (rect.w == image_w) memcpy(target + box.x, line, box.w * sizeof(uint16_t));
        else for (int x = 0; x < rect.w; ++x) {
            const int sx = x * image_w / rect.w;
            if (sx >= box.x && sx < box.x + box.w) target[x] = line[sx - box.x];
        }
    }
}
// Writes a key into the framebuffer at once; callers wait for the beam first.
void write_key(int cell, bool pressed) {
    const keygrid::Rect rect = keygrid::cell(cell);
    const uint32_t start = micros();
    if (active && active->complete) {
        // The protocol's uniform image size comes from cell 0. Actual openings may
        // differ by one pixel after rounding; nearest-neighbour mapping covers them.
        const bool alternate = (current_state & (1 << cell)) && active->alternates[cell];
        // A wheel draws its own picture, composed beforehand, and no outline.
        const bool turning = wheel::armed(cell, active->id, active->signature) && wheel::frame(cell);
        if (turning) pressed = false;
        const uint16_t *source = turning ? wheel::frame(cell) : alternate ? active->alternates[cell] : shown_off(*active, cell);
        uint16_t *frame = panel::framebuffer();
        // The divisions stay out of the pixel loop: the column map once per key,
        // the source line once per row. A key as wide as the image - nearly all
        // of them - copies each row with one memcpy. A division per pixel took
        // a key 3 ms; the whole page redraw, 83 ms.
        static uint16_t columns[panel::WIDTH];
        const bool same_width = rect.w == image_w;
        if (!same_width) for (int x = 0; x < rect.w; ++x) columns[x] = x * image_w / rect.w;
        for (int y = 0; y < rect.h; ++y) {
            const uint16_t *line = source + (y * image_h / rect.h) * image_w;
            uint16_t *target = frame + (rect.y + y) * panel::WIDTH + rect.x;
            if (same_width) memcpy(target, line, rect.w * sizeof(uint16_t));
            else for (int x = 0; x < rect.w; ++x) target[x] = line[columns[x]];
        }
        if (!turning && active->texts[cell]) write_text(cell, source);
        if (pressed && ((alternate ? active->alternate_lit : active->lit_mask) & (1 << cell))) panel::display.drawRoundRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 9, 0xFFFF);
    } else {
        // An unconfigured device is pitch black, with no numbered placeholders.
        panel::display.fillRect(rect.x, rect.y, rect.w, rect.h, 0x0000);
    }
    const uint32_t elapsed = micros() - start;
    // Pessimistic, as tear-free writes need: twice the write, up at once after
    // a slow one. It eases back down, or one slow write under PSRAM contention
    // would narrow every later window for good.
    const uint32_t sample = elapsed * 2;
    if (sample > write_estimate_us) write_estimate_us = sample;
    else write_estimate_us = max<uint32_t>(WRITE_ESTIMATE_FLOOR_US, write_estimate_us - (write_estimate_us - sample) / 16);
}
void draw_key(int cell, bool pressed) {
    wait_for_cell(keygrid::cell(cell));
    write_key(cell, pressed);
}
// Each key goes out the moment its row is clear of the scanout, in whatever
// order that happens, rather than all fifteen waiting their turn in index order
// (61 ms a page). Some row is always clear, so the copies - about 2 ms a key,
// PSRAM to PSRAM beside the scanout - run nearly back to back. Past the
// deadline the rest are written regardless, so a redraw can never hang.
void draw_page() {
    const uint32_t started = micros();
    uint32_t remaining = (1u << keygrid::COUNT) - 1;
    const uint32_t deadline = micros() + panel::frame_period_us() * 8;
    while (remaining) {
        const bool late = static_cast<int32_t>(deadline - micros()) <= 0;
        for (int cell = 0; cell < keygrid::COUNT; ++cell) {
            if (!(remaining & (1u << cell))) continue;
            if (!late && !cell_clear(keygrid::cell(cell))) continue;
            write_key(cell, false);
            remaining &= ~(1u << cell);
        }
    }
    page_draw_us = micros() - started;
}
// The center key's status: the logo, then a label, a progress bar, or both.
// A label alone is a state ("Disconnected"); a bar alone is loading progress;
// percent < 0 means no bar.
void show_status(int percent, const char *label = nullptr) {
    if(!showing_status) {
        for(int i=0;i<keygrid::COUNT;++i){const auto r=keygrid::cell(i);wait_for_cell(r);panel::display.fillRect(r.x,r.y,r.w,r.h,0);}
        showing_status=true;
    }
    const auto rect=keygrid::cell(keygrid::COUNT/2);
    wait_for_cell(rect);panel::display.fillRect(rect.x,rect.y,rect.w,rect.h,0);
    const int left=rect.x+(rect.w-DECKY_LOGO_SIZE)/2, top=rect.y+8;
    uint16_t *frame=panel::framebuffer();
    for(int y=0;y<DECKY_LOGO_SIZE;++y)for(int x=0;x<DECKY_LOGO_SIZE;++x){const uint8_t a=pgm_read_byte(DECKY_LOGO_ALPHA+y*DECKY_LOGO_SIZE+x);frame[(top+y)*panel::WIDTH+left+x]=panel::display.color565(a,a,a);}
    const bool bar=percent>=0;
    if(label){panel::display.setFont(&fonts::Font0);panel::display.setTextSize(1);panel::display.setTextColor(0xBDF7);panel::display.setTextDatum(textdatum_t::middle_center);panel::display.drawString(label,rect.x+rect.w/2,rect.y+rect.h-(bar?29:15));}
    // LovyanGFX stores these colours byte-swapped against the framebuffer's order
    // (the order the desktop's key images use), so the dark grey 0x2945 track is
    // passed as 0x4529; passed plainly it showed green.
    if(bar){const int width=rect.w-28;panel::display.fillRoundRect(rect.x+14,rect.y+rect.h-18,width,5,2,0x4529);const int fill=width*constrain(percent,0,100)/100;if(fill>0)panel::display.fillRoundRect(rect.x+14,rect.y+rect.h-18,fill,5,2,0xFFFF);}
}
void warm_progress() {
    if(!warming)return;
    const int cells=pending?__builtin_popcount(pending->mask):0;
    show_status(15+(85*(warm_done+cells))/max(1,warm_total));
}
// Bytes an upload over USB goes in, each acknowledged. 128 unless the desktop
// asks for more with BLOCK - a released app expects 128 - and back to it on
// HELLO and when the desktop goes: a round trip a block, 128 bytes spent more
// time waiting than sending.
constexpr size_t SERIAL_BLOCK_MAX = 4096;
size_t serial_block = BLOCK_BYTES;
void disconnected() {
    host_online=false;warming=false;transitioning=false;pending=nullptr;pressed_cell=-1;drag_mask=0;serial_block=BLOCK_BYTES;wheel::disarm_all();
    // Sliding text and live pictures are the session's: the next desktop
    // sends what it wants, over the pages' own pictures.
    for(auto &page:cache)drop_lives(page);
    show_status(-1,"Disconnected");
}
// Why the deck last started: a crash (panic), a watchdog, the supply dipping
// (brownout), or plain power-on and flashing. A crash also leaves a core dump
// in the coredump partition, which outlives a power cycle.
const char *reset_reason() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "poweron";
        case ESP_RST_EXT: return "ext";
        case ESP_RST_SW: return "sw";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "intwdt";
        case ESP_RST_TASK_WDT: return "taskwdt";
        case ESP_RST_WDT: return "wdt";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_USB: return "usb";
        case ESP_RST_JTAG: return "jtag";
        default: return "unknown";
    }
}
void identify() {
    uint8_t mac[6] = {0}; esp_read_mac(mac, ESP_MAC_WIFI_STA);
    wireless::reply().printf("OK id decky %d %02x%02x%02x%02x%02x%02x cells=%d cols=%d rows=%d w=%d h=%d pages=%d cache=%d storage=%d fw=%s live=1 drag=1 wheel=1 dial=1 warm=1 block=%u slide=1 reset=%s\n", DECKY_PROTOCOL, mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],keygrid::COUNT,keygrid::COLS,keygrid::ROWS,image_w,image_h,MAX_PAGES,CACHE_SLOTS,artwork_store::available()?1:0,DECKY_FW_VERSION,static_cast<unsigned>(SERIAL_BLOCK_MAX),reset_reason());
}
uint32_t crc32(const uint8_t *data, size_t length) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; ++bit) crc = (crc & 1) ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
    }
    return crc ^ 0xFFFFFFFF;
}
void begin_page(int id, uint32_t signature, bool cache_only = false) {
    host_online=true;last_host_ms=millis();
    if (id < 0 || id >= MAX_PAGES) { wireless::reply().println("ERR invalid page"); return; }
    for (auto &page : cache) {
        if (page.id == id && page.signature == signature && page.complete) {
            page.used=millis();pending=nullptr;
            if(cache_only){if(warming){warm_done+=keygrid::COUNT;warm_progress();}}
            else {active=&page;current_page=id;current_state=0;warming=false;showing_status=false;transitioning=true;draw_page();transitioning=false;}
            wireless::reply().printf("OK page %d cached=1\n",id); return;
        }
    }
    CachedPage *base=nullptr;
    for(auto &page:cache)if(page.complete&&page.id==id&&(!base||page.used>=base->used))base=&page;
    CachedPage *slot = nullptr;
    for (auto &page : cache) if (&page != active && &page != base && (!slot || page.id == -1 || page.used < slot->used)) { slot = &page; if(page.id == -1) break; }
    if (!slot) { wireless::reply().println("ERR page cache full"); return; }
    // A slot keeps its buffer once it has one (commit_page never frees it),
    // so freeing and reallocating pages can't break memory into pieces too
    // small for the next page.
    if (!slot->pixels) {
        const size_t bytes = page_bytes();
        if (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) < bytes + PSRAM_FLOOR || heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM) < bytes) { wireless::reply().println("ERR insufficient PSRAM"); return; }
        slot->pixels = static_cast<uint16_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!slot->pixels) { wireless::reply().println("ERR page allocation failed"); return; }
    }
    for(int i=0;i<keygrid::COUNT;++i){free(slot->alternates[i]);slot->alternates[i]=nullptr;slot->alternate_crc[i]=0;}
    drop_lives(*slot);
    slot->alternate_lit=0;slot->artwork_dirty=0;
    slot->id = id; slot->signature = signature; slot->complete = false; slot->mask = 0; slot->used = millis();
    if(artwork_store::load(id,-1,signature,slot->pixels,cell_pixels*2,keygrid::COUNT,slot->lit_mask)){
        slot->complete=true;slot->mask=0x7FFF;pending=nullptr;last_host_ms=millis();
        if(cache_only){if(warming){warm_done+=keygrid::COUNT;warm_progress();}}
        else{active=slot;current_page=id;current_state=0;warming=false;showing_status=false;draw_page();transitioning=false;}
        wireless::reply().printf("OK page %d cached=1 storage=sd\n",id);return;
    }
    const bool copy_active = base != nullptr;
    // Widget keys carry their current pictures, and the text sliding over
    // them, into the new version; `live` names those that did, so the desktop
    // knows what the copy shows.
    uint16_t carried = 0;
    if (copy_active) {
        memcpy(slot->pixels,base->pixels,page_bytes());
        slot->mask = 0x7FFF;
        slot->lit_mask = base->lit_mask;
        for (int cell = 0; cell < keygrid::COUNT; ++cell) {
            if (!base->live[cell] || !new_live(*slot, cell)) continue;
            memcpy(slot->live[cell], base->live[cell], cell_pixels * sizeof(uint16_t));
            if (base->texts[cell] && !(slot->texts[cell] = slide::clone(base->texts[cell]))) { drop_live(*slot, cell); continue; }
            carried |= 1 << cell;
        }
    } else slot->lit_mask = 0;
    pending = slot; pending_activate = !cache_only; transitioning = !cache_only || warming; pending_at = millis();
    wireless::reply().printf("OK page %d cached=0 copied=%d base=%u live=%u\n", id, copy_active ? 1 : 0, copy_active ? base->signature : 0, carried);
}
void poll_touch();
// Keys whose wheel has a new picture composed, waiting for the beam.
uint16_t wheel_composed = 0;
// Wheels turning on the page shown: a picture for each whose numbers moved,
// copied only when the beam is clear of the key, so this never waits. It runs
// from the main loop and between transfer blocks alike, so a wheel keeps
// turning while other keys are being sent.
void wheel_frames() {
    if (!active || !active->complete || showing_status || transitioning) return;
    const uint16_t due = wheel::tick(millis());
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const uint16_t bit = 1 << cell;
        const int index = wheel::settled(cell);
        if (index >= 0) wireless::events().printf("EV %d %d WHEEL %d\n", current_page, cell, index);
        const int value = wheel::value(cell, millis());
        if (value != INT_MIN) wireless::events().printf("EV %d %d VALUE %d\n", current_page, cell, value);
        if (!wheel::armed(cell, active->id, active->signature)) { wheel_composed &= ~bit; continue; }
        if ((due & bit) && !(wheel_composed & bit)) { wheel::compose(cell); wheel_composed |= bit; }
        if ((wheel_composed & bit) && cell_clear(keygrid::cell(cell))) { write_key(cell, false); wheel_composed &= ~bit; }
    }
}
// Sliding text on the page shown: the rows it covers, again each time it has
// moved a pixel, once the beam is clear of them - so this never waits either.
void text_frames() {
    if (!active || !active->complete || showing_status || transitioning) return;
    const uint32_t now = millis();
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        slide::Text *text = active->texts[cell];
        if (!text || wheel::armed(cell, active->id, active->signature) || !slide::due(text, now)) continue;
        const slide::Box box = slide::box(text);
        const keygrid::Rect key = keygrid::cell(cell);
        const keygrid::Rect rows{key.x, key.y + box.y * key.h / image_h, key.w, (box.h * key.h + image_h - 1) / image_h + 1};
        if (!cell_clear(rows)) continue;
        const bool alternate = (current_state & (1 << cell)) && active->alternates[cell];
        write_text(cell, alternate ? active->alternates[cell] : shown_off(*active, cell));
    }
}
// Touch is read between transfer blocks too. Widgets keep transfers going in
// normal use, and a tap that began and ended inside one would never be seen;
// every 15 ms keeps the touch reads from slowing the transfer itself.
uint32_t touch_polled_ms = 0;
void poll_touch_during_transfer() {
    if (millis() - touch_polled_ms < 15) return;
    touch_polled_ms = millis();
    poll_touch();
    wheel_frames();
    text_frames();
}
bool read_pixels(uint8_t *target, size_t bytes, uint32_t expected_crc) {
    const bool network=wireless::network_transfer();
    const size_t block_bytes=network?4096:serial_block;
    if(block_bytes!=BLOCK_BYTES)wireless::reply().printf("READY %u\n",static_cast<unsigned>(block_bytes));else wireless::reply().println("READY");
    size_t received = 0;
    while (received < bytes) {
        const size_t count = min(block_bytes, bytes - received);
        const uint32_t deadline = millis() + 5000;
        size_t block = 0;
        while (block < count && static_cast<int32_t>(deadline - millis()) > 0) {
            if (wireless::reply().available()) {
                if(network){const int got=wireless::read_network(target+received+block,count-block);if(got>0)block+=got;}
                else target[received + block++] = static_cast<uint8_t>(wireless::reply().read());
            }
            else { poll_touch_during_transfer(); vTaskDelay(1); }
        }
        if (block != count) { wireless::reply().printf("ERR transfer timeout %u/%u\n", static_cast<unsigned>(block), static_cast<unsigned>(count)); return false; }
        received += count;
        last_host_ms = millis();
        wireless::reply().write(reinterpret_cast<const uint8_t*>("A\n"),2);
        poll_touch_during_transfer();
    }
    if (crc32(target, bytes) != expected_crc) { wireless::reply().println("ERR checksum mismatch"); return false; }
    return true;
}
// A key of the page being built has its own picture now: what it showed live
// was for the old one.
void image_arrived(int cell) {
    const uint16_t *pixels = pending->pixels + cell * cell_pixels;
    drop_live(*pending, cell);
    pending_at = millis();
    pending->mask |= 1 << cell;
    bool lit = false;
    for(size_t i = 0; i < cell_pixels; ++i) if(pixels[i]) { lit = true; break; }
    if(lit) pending->lit_mask |= 1 << cell; else pending->lit_mask &= ~(1 << cell);
    warm_progress();
    wireless::reply().println("OK image");
}
void push_cell(int cell, size_t bytes, uint32_t expected_crc) {
    if (!pending || cell < 0 || cell >= keygrid::COUNT || bytes != cell_pixels * 2) { wireless::reply().println("ERR invalid image payload"); return; }
    uint8_t *target = reinterpret_cast<uint8_t*>(pending->pixels + cell * cell_pixels);
    if(!read_pixels(target,bytes,expected_crc)){pending=nullptr;transitioning=false;return;}
    image_arrived(cell);
}
void commit_page(uint32_t signature) {
    if (!pending || pending->signature != signature || pending->mask != 0x7FFF) { wireless::reply().println("ERR incomplete page"); return; }
    pending->complete=true;pending->used=millis();const int committed=pending->id;
    const bool stored=artwork_store::save(committed,-1,signature,pending->pixels,cell_pixels*2,keygrid::COUNT,pending->lit_mask);
    last_host_ms=millis();
    if(pending_activate){active=pending;current_page=active->id;current_state=0;pending=nullptr;warming=false;showing_status=false;draw_page();}
    else {pending=nullptr;if(warming){warm_done+=keygrid::COUNT;warm_progress();}}
    // The page's other copies go - but their buffers stay with their slots
    // (see begin_page).
    for(auto &page:cache)if(page.id==committed && page.signature!=signature && &page!=active){
        page.id=-1;page.complete=false;
        for(int i=0;i<keygrid::COUNT;++i){free(page.alternates[i]);page.alternates[i]=nullptr;}
        drop_lives(page);
    }
    transitioning=warming;
    wireless::reply().printf("OK committed %d stored=%d\n",committed,stored?1:0);
}
CachedPage *find_page(int id,uint32_t signature){
    for(auto &page:cache)if(page.id==id&&page.signature==signature&&page.complete)return &page;
    return nullptr;
}
void alternate_image(int id,uint32_t signature,int cell,size_t bytes,uint32_t checksum){
    CachedPage *page=find_page(id,signature);
    if(!page||cell<0||cell>=keygrid::COUNT||bytes!=cell_pixels*2){wireless::reply().println("ERR invalid alternate image");return;}
    if(page->alternates[cell]&&page->alternate_crc[cell]==checksum){if(warming){++warm_done;warm_progress();}wireless::reply().println("OK alternate cached=1");return;}
    if(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)<bytes+768*1024){wireless::reply().println("ERR insufficient PSRAM for toggle artwork");return;}
    auto *pixels=static_cast<uint16_t*>(heap_caps_malloc(bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
    if(!pixels){wireless::reply().println("ERR toggle allocation failed");return;}
    uint16_t loaded_lit=0;
    const bool loaded=artwork_store::load(id,cell,checksum,pixels,bytes,1,loaded_lit);
    if(!loaded&&!read_pixels(reinterpret_cast<uint8_t*>(pixels),bytes,checksum)){free(pixels);return;}
    free(page->alternates[cell]);page->alternates[cell]=pixels;page->alternate_crc[cell]=checksum;
    if(page==active&&(current_state&(1<<cell)))page->artwork_dirty|=1<<cell;
    page->alternate_lit&=~(1<<cell);
    for(size_t i=0;i<cell_pixels;++i)if(pixels[i]){page->alternate_lit|=1<<cell;break;}
    const bool stored=loaded||artwork_store::save(id,cell,checksum,pixels,bytes,1,(page->alternate_lit&(1<<cell))?1:0);
    last_host_ms=millis();
    if(warming){++warm_done;warm_progress();}
    wireless::reply().printf("OK alternate cached=%d stored=%d\n",loaded?1:0,stored?1:0);
}
void select_state(int id,uint32_t signature,unsigned int mask){
    CachedPage *page=find_page(id,signature);
    if(!page||mask>0x7FFF){wireless::reply().println("ERR invalid page state");return;}
    for(int i=0;i<keygrid::COUNT;++i)if((mask&(1<<i))&&!page->alternates[i]){wireless::reply().println("ERR toggle artwork not cached");return;}
    const bool full=active!=page||showing_status;
    const uint16_t changed=(current_state^mask)|page->artwork_dirty;
    page->artwork_dirty=0;
    active=page;current_page=id;current_state=mask;page->used=millis();
    host_online=true;warming=false;showing_status=false;transitioning=false;
    if(full)draw_page();else for(int cell=0;cell<keygrid::COUNT;++cell)if(changed&(1<<cell))draw_key(cell,cell==pressed_cell);
    wireless::reply().printf("OK state %d mask=%u cells=%d\n",id,mask,full?keygrid::COUNT:__builtin_popcount(changed));
}
constexpr size_t LIVE_MAX_BYTES = 64 * 1024;
// A widget key's new picture, as a patch to the picture the page's copy shows
// for it now: its live picture, or its own until it has one. The page is named
// with its signature, and the picture it applies to by its CRC, so a patch
// meant for a page just left - or for a copy that has drifted - is refused and
// the desktop sends the whole key (base 0 skips the check). The patch goes into
// the key's live picture; the page's own stays as it was sent. 0 bytes drops
// the live picture, and the key shows its own again.
void live_patch(int id, uint32_t signature, int cell, uint32_t base, size_t bytes, uint32_t checksum) {
    CachedPage *page = find_page(id, signature);
    if (!page || cell < 0 || cell >= keygrid::COUNT || bytes > LIVE_MAX_BYTES) { wireless::reply().println("ERR invalid live patch"); return; }
    if (!bytes) {
        drop_live(*page, cell);
        page->used = millis(); last_host_ms = millis();
        if (page == active && !showing_status && !transitioning) draw_key(cell, cell == pressed_cell);
        wireless::reply().println("OK live");
        return;
    }
    const uint16_t *shown = shown_off(*page, cell);
    if (base && crc32(reinterpret_cast<const uint8_t*>(shown), cell_pixels * 2) != base) { wireless::reply().println("ERR live base"); return; }
    // A key's first live picture starts as its own. Without room for one the
    // patch is refused, never written into the page's own picture: that must
    // stay what the signature says.
    const bool fresh = !page->live[cell];
    if (fresh && !new_live(*page, cell)) { wireless::reply().println("ERR live memory"); return; }
    uint16_t *image = page->live[cell];
    if (fresh) memcpy(image, shown, cell_pixels * sizeof(uint16_t));
    auto *payload = static_cast<uint8_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!payload) { if (fresh) drop_live(*page, cell); wireless::reply().println("ERR live allocation failed"); return; }
    const bool received = read_pixels(payload, bytes, checksum);
    const bool valid = received && apply_patch(image, image_w, image_h, payload, bytes, false);
    if (valid) apply_patch(image, image_w, image_h, payload, bytes, true);
    free(payload);
    if (!valid && fresh) drop_live(*page, cell);
    if (!received) return;
    if (!valid) { wireless::reply().println("ERR live payload"); return; }
    // A picture for a key of the page shown ends its wheel: the countdown is
    // running. A hidden page's keys have none - while loading, the desktop
    // brings every page's widgets up to date, and that is loading too.
    if (page == active) wheel::disarm(cell);
    if (warming) { ++warm_done; warm_progress(); }
    page->used = millis(); last_host_ms = millis();
    if (page == active && !showing_status && !transitioning) draw_key(cell, cell == pressed_cell);
    wireless::reply().println("OK live");
}
// A key of the page being built, as a patch (the LIVE format) to what the key
// holds: the copy the version started from, or - in a fresh one - nothing
// known, so then the patch covers the whole key. Most keys are mostly one
// colour: a whole key goes in a few KB instead of 29.
void patch_cell(int cell, size_t bytes, uint32_t checksum) {
    if (!pending || cell < 0 || cell >= keygrid::COUNT || !bytes || bytes > LIVE_MAX_BYTES) { wireless::reply().println("ERR invalid image patch"); return; }
    auto *payload = static_cast<uint8_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!payload) { wireless::reply().println("ERR image allocation failed"); return; }
    uint16_t *image = pending->pixels + cell * cell_pixels;
    if (!read_pixels(payload, bytes, checksum)) { free(payload); pending = nullptr; transitioning = false; return; }
    const bool valid = apply_patch(image, image_w, image_h, payload, bytes, false);
    if (valid) apply_patch(image, image_w, image_h, payload, bytes, true);
    free(payload);
    if (!valid) { wireless::reply().println("ERR image patch"); return; }
    image_arrived(cell);
}
// A wheel's look for a key of the page shown, and the label it starts on. The
// look is kept by its CRC, so arming the same one again (WHEELAT) sends none.
// Cell -1 only keeps the look, for a page not shown yet: loading sends every
// page's ahead, so a page opens with its wheels at once.
void wheel_upload(int id, uint32_t signature, int cell, int index, size_t bytes, uint32_t checksum) {
    const bool ahead = cell == -1;
    CachedPage *page = find_page(id, signature);
    if (!page || (!ahead && (page != active || cell < 0 || cell >= keygrid::COUNT)) || !bytes || bytes > wheel::MAX_BYTES) { wireless::reply().println("ERR invalid wheel"); return; }
    if (ahead && wheel::known(checksum)) {
        if (warming) { ++warm_done; warm_progress(); }
        wireless::reply().println("OK wheel cached=1");
        return;
    }
    auto *payload = static_cast<uint8_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!payload) { wireless::reply().println("ERR wheel allocation failed"); return; }
    if (!read_pixels(payload, bytes, checksum)) { free(payload); return; }
    last_host_ms = millis();
    if (!wheel::load(payload, bytes, checksum)) { wireless::reply().println("ERR wheel payload"); return; }
    if (ahead) {
        if (warming) { ++warm_done; warm_progress(); }
        wireless::reply().println("OK wheel");
        return;
    }
    if (!wheel::arm(cell, id, signature, checksum, index)) { wireless::reply().println("ERR wheel index"); return; }
    if (!showing_status && !transitioning) draw_key(cell, false);
    wireless::reply().println("OK wheel");
}
// Arm a key with a look the deck already keeps, or move it to a label; index
// -1 takes the wheel away and the key shows its page picture again.
void wheel_at(int id, uint32_t signature, int cell, int index, uint32_t checksum) {
    CachedPage *page = find_page(id, signature);
    if (!page || page != active || cell < 0 || cell >= keygrid::COUNT) { wireless::reply().println("ERR invalid wheel"); return; }
    if (index < 0) wheel::disarm(cell);
    else if (!wheel::known(checksum)) { wireless::reply().println("ERR wheel unknown"); return; }
    else if (!wheel::arm(cell, id, signature, checksum, index)) { wireless::reply().println("ERR wheel index"); return; }
    if (!showing_status && !transitioning) draw_key(cell, false);
    wireless::reply().println("OK wheel");
}
// A key's text that is too long for it, for the deck to slide along - on any
// page it holds; 0 bytes takes it away. It belongs to that copy of the page:
// a new version of the page starts without it.
void slide_text(int id, uint32_t signature, int cell, size_t bytes, uint32_t checksum) {
    CachedPage *page = find_page(id, signature);
    if (!page || cell < 0 || cell >= keygrid::COUNT || bytes > slide::MAX_BYTES) { wireless::reply().println("ERR invalid slide"); return; }
    slide::Text *text = nullptr;
    if (bytes) {
        auto *payload = static_cast<uint8_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!payload) { wireless::reply().println("ERR slide allocation failed"); return; }
        if (!read_pixels(payload, bytes, checksum)) { free(payload); return; }
        text = slide::load(payload, bytes, image_w, image_h, millis());
        if (!text) { wireless::reply().println("ERR slide payload"); return; }
    }
    slide::release(page->texts[cell]);
    page->texts[cell] = text;
    page->used = millis(); last_host_ms = millis();
    if (page == active && !showing_status && !transitioning) draw_key(cell, cell == pressed_cell);
    wireless::reply().println("OK slide");
}
void command(const char *line) {
    int page = 0, cell = 0, units = 0, index = 0; unsigned int signature = 0, checksum = 0, bytes = 0, mask=0, base=0; char extra = 0;
    if(wireless::handle(line))return;
    if(strcmp(line,"ID")!=0&&strcmp(line,"SCREEN")!=0)wireless::claim();
    last_host_ms=millis();
    if (strcmp(line,"ID") == 0) identify();
    else if(strcmp(line,"SDINFO")==0)wireless::reply().printf("OK storage card=%d bytes=%llu\n",artwork_store::available()?1:0,static_cast<unsigned long long>(artwork_store::capacity()));
    else if(strcmp(line,"DISPLAY_RESYNC")==0)wireless::reply().println(panel::recover_scanout()?"OK display realigned":"ERR display recovery failed");
    // Scanout health: the bounce position at the last frame end (76800 when
    // right), EOFs per frame since the last ask (10 when right), slipped
    // pictures averted since boot, the last page redraw and the last wheel
    // picture composed, in microseconds.
    else if(strcmp(line,"DISPLAY_STATE")==0){int32_t pos=0;uint32_t low=0,high=0,fixed=0;if(panel::scanout_state(pos,low,high,fixed))wireless::reply().printf("OK display pos=%ld eofs=%lu..%lu corrected=%lu draw=%lu wheel=%lu frames=%lu die=%lu/%lu/%lu/%lu\n",static_cast<long>(pos),static_cast<unsigned long>(low),static_cast<unsigned long>(high),static_cast<unsigned long>(fixed),static_cast<unsigned long>(page_draw_us),static_cast<unsigned long>(wheel::compose_us()),static_cast<unsigned long>(wheel::frames()),static_cast<unsigned long>(wheel::die_us()[0]),static_cast<unsigned long>(wheel::die_us()[1]),static_cast<unsigned long>(wheel::die_us()[2]),static_cast<unsigned long>(wheel::die_us()[3]));else wireless::reply().println("ERR display state unavailable");}
    else if(strcmp(line,"PING")==0) wireless::reply().printf("OK ping online=%d\n",host_online?1:0);    else if(strcmp(line,"BYE")==0){disconnected();wireless::reply().println("OK disconnected");}
    else if(strncmp(line,"UPDATING ",9)==0){
        // Decky on the PC is updating itself: the percent follows its download, and
        // the screen stays while Decky closes for the installer. END means it
        // stopped - cancelled or failed - and the deck goes back to its page.
        if(strcmp(line+9,"END")==0){updating_until=0;if(active&&active->complete){showing_status=false;draw_page();}else disconnected();wireless::reply().println("OK updating end");}
        else if(sscanf(line+9,"%d %c",&page,&extra)==1&&page>=0&&page<=100){host_online=true;transitioning=false;updating_until=millis()+UPDATING_HOLD_MS;if(!updating_until)updating_until=1;show_status(page,"Updating Decky");wireless::reply().println("OK updating");}
        else wireless::reply().println("ERR invalid update progress");
    }
    // Loading: <units> counts every key, ON picture, widget picture and look to come.
    else if(strncmp(line,"HELLO ",6)==0){const int count=sscanf(line,"HELLO %d %d %c",&page,&units,&extra);if((count!=1&&count!=2)||page<1||page>CACHE_SLOTS||(count==2&&(units<page*keygrid::COUNT||units>page*keygrid::COUNT*3))){wireless::reply().println("ERR cache capacity exceeded");return;}host_online=true;updating_until=0;drag_mask=0;serial_block=BLOCK_BYTES;wheel::disarm_all();for(auto &cached:cache)drop_lives(cached);warming=true;transitioning=true;warm_total=count==2?units:page*keygrid::COUNT;warm_done=0;pending=nullptr;show_status(15);wireless::reply().println("OK warming");}
    // Uploads over USB in blocks of <n> bytes from here, until HELLO or the desktop goes.
    else if(sscanf(line,"BLOCK %u %c",&bytes,&extra)==1){if(bytes<BLOCK_BYTES||bytes>SERIAL_BLOCK_MAX){wireless::reply().println("ERR invalid block");return;}serial_block=bytes;wireless::reply().printf("OK block %u\n",bytes);}
    else if(sscanf(line,"ALT %d %u %d %u %u %c",&page,&signature,&cell,&bytes,&checksum,&extra)==5)alternate_image(page,signature,cell,bytes,checksum);
    else if(sscanf(line,"LIVE %d %u %d %u %u %u %c",&page,&signature,&cell,&base,&bytes,&checksum,&extra)==6)live_patch(page,signature,cell,base,bytes,checksum);
    else if(sscanf(line,"STATE %d %u %u %c",&page,&signature,&mask,&extra)==3)select_state(page,signature,mask);
    // The keys to report finger movement on: 15 bits, one per key; 0 for none.
    else if(sscanf(line,"DRAG %u %c",&mask,&extra)==1){drag_mask=mask&0x7FFF;wireless::reply().println("OK drag");}
    else if(sscanf(line,"WHEEL %d %u %d %d %u %u %c",&page,&signature,&cell,&index,&bytes,&checksum,&extra)==6)wheel_upload(page,signature,cell,index,bytes,checksum);
    else if(sscanf(line,"WHEELAT %d %u %d %d %u %c",&page,&signature,&cell,&index,&checksum,&extra)==5)wheel_at(page,signature,cell,index,checksum);
    else if(sscanf(line,"SLIDE %d %u %d %u %u %c",&page,&signature,&cell,&bytes,&checksum,&extra)==5)slide_text(page,signature,cell,bytes,checksum);
    // Diagnostics: set a wheel coasting at <tenths of labels a second>, as a flick would.
    else if(sscanf(line,"WHEELSPIN %d %d %c",&cell,&units,&extra)==2){wheel::spin(cell,units/10.f,millis());wireless::reply().println("OK spin");}
    // Spin a drum on the page shown to a label and land on it: a dice roll.
    else if(sscanf(line,"WHEELROLL %d %u %d %d %c",&page,&signature,&cell,&index,&extra)==4){
        if(!active||active->id!=page||active->signature!=signature||!wheel::armed(cell,page,signature)){wireless::reply().println("ERR invalid wheel");return;}
        wheel::roll(cell,index,millis());wireless::reply().println("OK roll");
    }
    else if(sscanf(line,"CACHE %d %u %c",&page,&signature,&extra)==2)begin_page(page,signature,true);
    else if (sscanf(line,"PAGE %d %u %c",&page,&signature,&extra) == 2) begin_page(page,signature);
    else if (sscanf(line,"BLANK %d %c",&cell,&extra) == 1) {
        if (!pending || cell < 0 || cell >= keygrid::COUNT) { wireless::reply().println("ERR invalid cell"); return; }
        memset(pending->pixels + cell * cell_pixels,0,cell_pixels * 2);
        drop_live(*pending, cell);
        pending->mask |= 1 << cell; pending->lit_mask &= ~(1 << cell); pending_at = millis();
        warm_progress();
        wireless::reply().println("OK blank");
    }
    else if (sscanf(line,"PUSH %d %u %u %c",&cell,&bytes,&checksum,&extra) == 3) push_cell(cell,bytes,checksum);
    // A key of the page being built as a patch to what it holds (live=1).
    else if (sscanf(line,"PATCH %d %u %u %c",&cell,&bytes,&checksum,&extra) == 3) patch_cell(cell,bytes,checksum);
    else if (sscanf(line,"COMMIT %u %c",&signature,&extra) == 1) commit_page(signature);
    else if (strcmp(line,"SCREEN") == 0) {
        wireless::reply().printf("OK screen %d %d %d\n", panel::WIDTH, panel::HEIGHT, panel::WIDTH * panel::HEIGHT * 2);
        wireless::reply().write(reinterpret_cast<const uint8_t*>(panel::framebuffer()), panel::WIDTH * panel::HEIGHT * 2);
        wireless::reply().println("OK screen complete");
        last_host_ms=millis();
    }
    else if (strcmp(line,"ABORT") == 0) { pending = nullptr; transitioning = false; wireless::reply().println("OK aborted"); }
    else wireless::reply().println("ERR unknown command");
}
void poll_serial() {
    wireless::poll(command);
    if (pending && millis() - pending_at > 15000) { pending = nullptr; transitioning = false; }
}
// The finger's height inside a key the desktop asked about with DRAG: at once
// when it lands, then each time it has moved 2 px, at most every 20 ms. Only
// those keys, so a desktop that never sent DRAG never sees a MOVE line.
void report_drag(int y, uint32_t now, bool first) {
    const int inside = y - keygrid::cell(pressed_cell).y;
    if (!first && (abs(inside - drag_sent_y) < 2 || now - drag_sent_ms < 20)) return;
    drag_sent_y = inside; drag_sent_ms = now;
    wireless::events().printf("EV %d %d MOVE %d\n",pressed_page,pressed_cell,inside);
}
void poll_touch() {
    int x = 0, y = 0; const bool down = panel::touch_point(x,y); const uint32_t now = millis();
    if (down && !contact_down) {
        contact_down = true;
        if (!host_online || showing_status || transitioning || now - last_press_ms < PRESS_GAP_MS) return;
        const int cell = keygrid::hit(x,y); if (cell < 0) return;
        last_press_ms = now; pressed_cell = cell; pressed_page = current_page;
        // A wheel takes the finger itself: no outline, it turns instead.
        const bool turning = active && wheel::armed(cell, active->id, active->signature);
        if (!turning) draw_key(cell,true);
        wireless::events().printf("EV %d %d DOWN\n",pressed_page,cell);
        if (drag_mask & (1 << cell)) report_drag(y, now, true);
        if (turning) wheel::touch(cell, y - keygrid::cell(cell).y, now, true);
    } else if (down && pressed_cell >= 0) {
        if (drag_mask & (1 << pressed_cell)) report_drag(y, now, false);
        if (active && wheel::armed(pressed_cell, active->id, active->signature)) wheel::touch(pressed_cell, y - keygrid::cell(pressed_cell).y, now, false);
    } else if (!down && contact_down) {
        contact_down = false;
        if (pressed_cell >= 0) {
            wireless::events().printf("EV %d %d UP\n",pressed_page,pressed_cell);
            if (active && wheel::armed(pressed_cell, active->id, active->signature)) wheel::release(pressed_cell, now);
            else if (!transitioning && current_page == pressed_page) draw_key(pressed_cell,false);
        }
        pressed_cell = -1;
    }
}
}
void setup() {
    // Room for a whole BLOCK: its bytes wait here while the loop draws.
    Serial.setRxBufferSize(SERIAL_BLOCK_MAX * 2);
    Serial.begin(460800);
    // Bytes are passed on from the UART once 32 are in rather than 120, so a
    // block is taken in sooner: 128-byte uploads went 25% faster.
    Serial.setRxFIFOFull(32);
    delay(200); wireless::reply().printf("\nDecky v6 - connect the desktop to load your workspace (reset %s)\n", reset_reason());
    panel::touch_bus_scan(); if (!panel::begin()) return;
    const keygrid::Rect first = keygrid::cell(0); image_w = first.w; image_h = first.h; cell_pixels = image_w * image_h;
    wheel::begin(image_w, image_h);
    // Until a desktop says HELLO there is nothing to load: the deck starts out
    // Disconnected, and the progress bar only appears once the desktop connects.
    panel::display.fillScreen(0); panel::present(); disconnected(); panel::backlight(true); initialized = true; artwork_store::begin(); wireless::reply().printf("BOOT decky %d\n", DECKY_PROTOCOL); wireless::begin();
}
void loop() { if (!initialized) { vTaskDelay(100); return; } poll_serial(); resync_beam(); const bool updating=updating_until&&static_cast<int32_t>(updating_until-millis())>0;if(host_online&&!updating&&millis()-last_host_ms>HOST_TIMEOUT_MS)disconnected(); poll_touch(); wheel_frames(); text_frames(); vTaskDelay(1); }
