// Decky v5: independent OFF/ON images eliminate whole-page toggle uploads.
// Static page images are cached in PSRAM. No changes to the measured RGB timing or touch bus.
#include <Arduino.h>
#include <esp_mac.h>
#include <esp_heap_caps.h>
#include "keygrid.h"
#include "panel.h"
#include "decky_logo.h"
#include "decky_version.h"
#include "wireless.h"
#include "artwork_store.h"

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
};
CachedPage cache[STORAGE_SLOTS];
CachedPage *active = nullptr;
CachedPage *pending = nullptr;
int current_page = 0;
uint16_t current_state = 0;
int pressed_cell = -1;
int pressed_page = 0;
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
// Writes a key into the framebuffer at once; callers wait for the beam first.
void write_key(int cell, bool pressed) {
    const keygrid::Rect rect = keygrid::cell(cell);
    const uint32_t start = micros();
    if (active && active->complete) {
        // The protocol's uniform image size comes from cell 0. Actual openings may
        // differ by one pixel after rounding; nearest-neighbour mapping covers them.
        const bool alternate = (current_state & (1 << cell)) && active->alternates[cell];
        const uint16_t *source = alternate ? active->alternates[cell] : active->pixels + cell_pixels * cell;
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
void disconnected() {
    host_online=false;warming=false;transitioning=false;pending=nullptr;pressed_cell=-1;
    show_status(-1,"Disconnected");
}
void identify() {
    uint8_t mac[6] = {0}; esp_read_mac(mac, ESP_MAC_WIFI_STA);
    wireless::reply().printf("OK id decky %d %02x%02x%02x%02x%02x%02x cells=%d cols=%d rows=%d w=%d h=%d pages=%d cache=%d storage=%d fw=%s\n", DECKY_PROTOCOL, mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],keygrid::COUNT,keygrid::COLS,keygrid::ROWS,image_w,image_h,MAX_PAGES,CACHE_SLOTS,artwork_store::available()?1:0,DECKY_FW_VERSION);
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
    if (!slot->pixels) {
        const size_t bytes = cell_pixels * keygrid::COUNT * sizeof(uint16_t);
        if (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) < bytes + 768 * 1024) { wireless::reply().println("ERR insufficient PSRAM"); return; }
        slot->pixels = static_cast<uint16_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!slot->pixels) { wireless::reply().println("ERR page allocation failed"); return; }
    }
    for(int i=0;i<keygrid::COUNT;++i){free(slot->alternates[i]);slot->alternates[i]=nullptr;slot->alternate_crc[i]=0;}
    slot->alternate_lit=0;slot->artwork_dirty=0;
    slot->id = id; slot->signature = signature; slot->complete = false; slot->mask = 0; slot->used = millis();
    if(artwork_store::load(id,-1,signature,slot->pixels,cell_pixels*2,keygrid::COUNT,slot->lit_mask)){
        slot->complete=true;slot->mask=0x7FFF;pending=nullptr;last_host_ms=millis();
        if(cache_only){if(warming){warm_done+=keygrid::COUNT;warm_progress();}}
        else{active=slot;current_page=id;current_state=0;warming=false;showing_status=false;draw_page();transitioning=false;}
        wireless::reply().printf("OK page %d cached=1 storage=sd\n",id);return;
    }
    const bool copy_active = base != nullptr;
    if (copy_active) {
        memcpy(slot->pixels,base->pixels,cell_pixels * keygrid::COUNT * 2);
        slot->mask = 0x7FFF;
        slot->lit_mask = base->lit_mask;
    } else slot->lit_mask = 0;
    pending = slot; pending_activate = !cache_only; transitioning = !cache_only || warming; pending_at = millis();
    wireless::reply().printf("OK page %d cached=0 copied=%d base=%u\n", id, copy_active ? 1 : 0, copy_active ? base->signature : 0);
}
bool read_pixels(uint8_t *target, size_t bytes, uint32_t expected_crc) {
    const bool network=wireless::network_transfer();
    const size_t block_bytes=network?4096:BLOCK_BYTES;
    if(network)wireless::reply().printf("READY %u\n",static_cast<unsigned>(block_bytes));else wireless::reply().println("READY");
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
            else vTaskDelay(1);
        }
        if (block != count) { wireless::reply().println("ERR transfer timeout"); return false; }
        received += count;
        last_host_ms = millis();
        wireless::reply().write(reinterpret_cast<const uint8_t*>("A\n"),2);
    }
    if (crc32(target, bytes) != expected_crc) { wireless::reply().println("ERR checksum mismatch"); return false; }
    return true;
}
void push_cell(int cell, size_t bytes, uint32_t expected_crc) {
    if (!pending || cell < 0 || cell >= keygrid::COUNT || bytes != cell_pixels * 2) { wireless::reply().println("ERR invalid image payload"); return; }
    uint8_t *target = reinterpret_cast<uint8_t*>(pending->pixels + cell * cell_pixels);
    if(!read_pixels(target,bytes,expected_crc)){pending=nullptr;transitioning=false;return;}
    pending_at = millis();
    pending->mask |= 1 << cell;
    bool lit = false;
    for(size_t i = 0; i < bytes; ++i) if(target[i]) { lit = true; break; }
    if(lit) pending->lit_mask |= 1 << cell; else pending->lit_mask &= ~(1 << cell);
    warm_progress();
    wireless::reply().println("OK image");
}
void commit_page(uint32_t signature) {
    if (!pending || pending->signature != signature || pending->mask != 0x7FFF) { wireless::reply().println("ERR incomplete page"); return; }
    pending->complete=true;pending->used=millis();const int committed=pending->id;
    const bool stored=artwork_store::save(committed,-1,signature,pending->pixels,cell_pixels*2,keygrid::COUNT,pending->lit_mask);
    last_host_ms=millis();
    if(pending_activate){active=pending;current_page=active->id;current_state=0;pending=nullptr;warming=false;showing_status=false;draw_page();}
    else {pending=nullptr;if(warming){warm_done+=keygrid::COUNT;warm_progress();}}
    for(auto &page:cache)if(page.id==committed && page.signature!=signature && &page!=active){
        page.id=-1;page.complete=false;
        for(int i=0;i<keygrid::COUNT;++i){free(page.alternates[i]);page.alternates[i]=nullptr;}
        free(page.pixels);page.pixels=nullptr;
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
void command(const char *line) {
    int page = 0, cell = 0, units = 0; unsigned int signature = 0, checksum = 0, bytes = 0, mask=0; char extra = 0;
    if(wireless::handle(line))return;
    if(strcmp(line,"ID")!=0&&strcmp(line,"SCREEN")!=0)wireless::claim();
    last_host_ms=millis();
    if (strcmp(line,"ID") == 0) identify();
    else if(strcmp(line,"SDINFO")==0)wireless::reply().printf("OK storage card=%d bytes=%llu\n",artwork_store::available()?1:0,static_cast<unsigned long long>(artwork_store::capacity()));
    else if(strcmp(line,"DISPLAY_RESYNC")==0)wireless::reply().println(panel::recover_scanout()?"OK display realigned":"ERR display recovery failed");
    // Scanout health: the bounce position at the last frame end (76800 when
    // right), EOFs per frame since the last ask (10 when right), slipped
    // pictures averted since boot, and the last page redraw in microseconds.
    else if(strcmp(line,"DISPLAY_STATE")==0){int32_t pos=0;uint32_t low=0,high=0,fixed=0;if(panel::scanout_state(pos,low,high,fixed))wireless::reply().printf("OK display pos=%ld eofs=%lu..%lu corrected=%lu draw=%lu\n",static_cast<long>(pos),static_cast<unsigned long>(low),static_cast<unsigned long>(high),static_cast<unsigned long>(fixed),static_cast<unsigned long>(page_draw_us));else wireless::reply().println("ERR display state unavailable");}
    else if(strcmp(line,"PING")==0) wireless::reply().printf("OK ping online=%d\n",host_online?1:0);
    else if(strcmp(line,"BYE")==0){disconnected();wireless::reply().println("OK disconnected");}
    else if(strncmp(line,"UPDATING ",9)==0){
        // Decky on the PC is updating itself: the percent follows its download, and
        // the screen stays while Decky closes for the installer. END means it
        // stopped - cancelled or failed - and the deck goes back to its page.
        if(strcmp(line+9,"END")==0){updating_until=0;if(active&&active->complete){showing_status=false;draw_page();}else disconnected();wireless::reply().println("OK updating end");}
        else if(sscanf(line+9,"%d %c",&page,&extra)==1&&page>=0&&page<=100){host_online=true;transitioning=false;updating_until=millis()+UPDATING_HOLD_MS;if(!updating_until)updating_until=1;show_status(page,"Updating Decky");wireless::reply().println("OK updating");}
        else wireless::reply().println("ERR invalid update progress");
    }
    else if(strncmp(line,"HELLO ",6)==0){const int count=sscanf(line,"HELLO %d %d %c",&page,&units,&extra);if((count!=1&&count!=2)||page<1||page>CACHE_SLOTS||(count==2&&(units<page*keygrid::COUNT||units>page*keygrid::COUNT*2))){wireless::reply().println("ERR cache capacity exceeded");return;}host_online=true;updating_until=0;warming=true;transitioning=true;warm_total=count==2?units:page*keygrid::COUNT;warm_done=0;pending=nullptr;show_status(15);wireless::reply().println("OK warming");}
    else if(sscanf(line,"ALT %d %u %d %u %u %c",&page,&signature,&cell,&bytes,&checksum,&extra)==5)alternate_image(page,signature,cell,bytes,checksum);
    else if(sscanf(line,"STATE %d %u %u %c",&page,&signature,&mask,&extra)==3)select_state(page,signature,mask);
    else if(sscanf(line,"CACHE %d %u %c",&page,&signature,&extra)==2)begin_page(page,signature,true);
    else if (sscanf(line,"PAGE %d %u %c",&page,&signature,&extra) == 2) begin_page(page,signature);
    else if (sscanf(line,"BLANK %d %c",&cell,&extra) == 1) {
        if (!pending || cell < 0 || cell >= keygrid::COUNT) { wireless::reply().println("ERR invalid cell"); return; }
        memset(pending->pixels + cell * cell_pixels,0,cell_pixels * 2);
        pending->mask |= 1 << cell; pending->lit_mask &= ~(1 << cell); pending_at = millis();
        warm_progress();
        wireless::reply().println("OK blank");
    }
    else if (sscanf(line,"PUSH %d %u %u %c",&cell,&bytes,&checksum,&extra) == 3) push_cell(cell,bytes,checksum);
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
void poll_touch() {
    int x = 0, y = 0; const bool down = panel::touch_point(x,y); const uint32_t now = millis();
    if (down && !contact_down) {
        contact_down = true;
        if (!host_online || showing_status || transitioning || now - last_press_ms < PRESS_GAP_MS) return;
        const int cell = keygrid::hit(x,y); if (cell < 0) return;
        last_press_ms = now; pressed_cell = cell; pressed_page = current_page;
        draw_key(cell,true); wireless::events().printf("EV %d %d DOWN\n",pressed_page,cell);
    } else if (!down && contact_down) {
        contact_down = false;
        if (pressed_cell >= 0) {
            wireless::events().printf("EV %d %d UP\n",pressed_page,pressed_cell);
            if (!transitioning && current_page == pressed_page) draw_key(pressed_cell,false);
        }
        pressed_cell = -1;
    }
}
}
void setup() {
    Serial.begin(460800); delay(200); wireless::reply().println("\nDecky v6 - connect the desktop to load your workspace");
    panel::touch_bus_scan(); if (!panel::begin()) return;
    const keygrid::Rect first = keygrid::cell(0); image_w = first.w; image_h = first.h; cell_pixels = image_w * image_h;
    // Until a desktop says HELLO there is nothing to load: the deck starts out
    // Disconnected, and the progress bar only appears once the desktop connects.
    panel::display.fillScreen(0); panel::present(); disconnected(); panel::backlight(true); initialized = true; artwork_store::begin(); wireless::reply().printf("BOOT decky %d\n", DECKY_PROTOCOL); wireless::begin();
}
void loop() { if (!initialized) { vTaskDelay(100); return; } poll_serial(); resync_beam(); const bool updating=updating_until&&static_cast<int32_t>(updating_until-millis())>0;if(host_online&&!updating&&millis()-last_host_ms>HOST_TIMEOUT_MS)disconnected(); poll_touch(); vTaskDelay(1); }
