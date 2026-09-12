#include "pages/page_commands.h"
#include <Arduino.h>
#include <string.h>
#include "common/crc32.h"
#include "common/key_image.h"
#include "common/memory.h"
#include "deck/deck.h"
#include "keygrid.h"
#include "keys/sweep/sweep.h"
#include "keys/text/sliding_text.h"
#include "network/wireless.h"
#include "pages/patch.h"
#include "storage/artwork_store.h"

namespace {
constexpr size_t LIVE_MAX_BYTES = 64 * 1024;
Stream &reply() { return wireless::reply(); }

// Each kind of overlay as its command brings it: the name its replies give,
// the most it takes, and how it is read (the desktop's clock for those that
// move with it).
struct OverlayKind {
    const char *name;
    size_t max_bytes;
    KeyOverlay *(*load)(uint8_t *data, size_t length, uint32_t now_ms, int64_t clock);
};
const OverlayKind OVERLAY_KINDS[KeyOverlay::KINDS] = {
    {"slide", SlidingText::MAX_BYTES,
     [](uint8_t *data, size_t length, uint32_t now_ms, int64_t) -> KeyOverlay * {
         return SlidingText::load(data, length, now_ms);
     }},
    {"sweep", Sweep::BYTES,
     [](uint8_t *data, size_t length, uint32_t now_ms, int64_t clock) -> KeyOverlay * {
         return Sweep::load(data, length, now_ms, clock);
     }},
};
}  // namespace

bool PageCommands::run(const char *name, const char *line) {
    static const Command COMMANDS[] = {
        {"CACHE", &PageCommands::cache},
        {"PAGE", &PageCommands::page},
        {"BLANK", &PageCommands::blank},
        {"PUSH", &PageCommands::push},
        // A key of the page being built as a patch to what it holds (live=1).
        {"PATCH", &PageCommands::patch},
        {"COMMIT", &PageCommands::commit},
        {"ABORT", &PageCommands::abort},
        {"ALT", &PageCommands::alternate},
        {"STATE", &PageCommands::state},
        {"LIVE", &PageCommands::live},
        {"SLIDE", &PageCommands::slide},
        // A ring's arc, moved by the deck (sweep=1).
        {"SWEEP", &PageCommands::sweep},
    };
    return run_from(COMMANDS, name, line);
}

bool PageCommands::cache(const char *line) {
    int page = 0;
    unsigned int signature = 0;
    char extra = 0;
    if (sscanf(line, "CACHE %d %u %c", &page, &signature, &extra) != 2) return false;
    begin(page, signature, true);
    return true;
}

bool PageCommands::page(const char *line) {
    int page = 0;
    unsigned int signature = 0;
    char extra = 0;
    if (sscanf(line, "PAGE %d %u %c", &page, &signature, &extra) != 2) return false;
    begin(page, signature, false);
    return true;
}

bool PageCommands::abort(const char *line) {
    if (strcmp(line, "ABORT") != 0) return false;
    deck_.pages().pending = nullptr;
    deck_.session().transitioning = false;
    reply().println("OK aborted");
    return true;
}

void PageCommands::begin(int id, uint32_t signature, bool cache_only) {
    Session &session = deck_.session();
    PageCache &pages = deck_.pages();
    session.online = true;
    session.heard(millis());
    if (id < 0 || id >= PageCache::MAX_PAGES) {
        reply().println("ERR invalid page");
        return;
    }
    if (Page *page = pages.find(id, signature)) {
        page->used = millis();
        pages.pending = nullptr;
        if (cache_only) {
            if (session.warming) {
                session.warm_done += keygrid::COUNT;
                deck_.warm_progress();
            }
        } else {
            deck_.activate(*page);
            session.transitioning = true;
            deck_.view().draw_page();
            session.transitioning = false;
        }
        reply().printf("OK page %d cached=1\n", id);
        return;
    }
    const PageCache::Started started = pages.start(id, signature);
    switch (started.result) {
        case PageCache::Start::Full:
            reply().println("ERR page cache full");
            return;
        case PageCache::Start::NoMemory:
            reply().println("ERR insufficient PSRAM");
            return;
        case PageCache::Start::AllocationFailed:
            reply().println("ERR page allocation failed");
            return;
        case PageCache::Start::FromCard:
            pages.pending = nullptr;
            session.heard(millis());
            if (cache_only) {
                if (session.warming) {
                    session.warm_done += keygrid::COUNT;
                    deck_.warm_progress();
                }
            } else {
                deck_.activate(*started.page);
                deck_.view().draw_page();
                session.transitioning = false;
            }
            reply().printf("OK page %d cached=1 storage=sd\n", id);
            return;
        case PageCache::Start::Building:
            pages.pending = started.page;
            pages.pending_activate = !cache_only;
            session.transitioning = !cache_only || session.warming;
            pages.pending_at = millis();
            // `live` names the keys whose live pictures (and text) the new
            // version carried, so the desktop knows what the copy shows.
            reply().printf("OK page %d cached=0 copied=%d base=%u live=%u\n", id, started.base ? 1 : 0,
                           started.base ? started.base->signature : 0, started.carried);
            return;
    }
}

bool PageCommands::blank(const char *line) {
    int cell = 0;
    char extra = 0;
    if (sscanf(line, "BLANK %d %c", &cell, &extra) != 1) return false;
    PageCache &pages = deck_.pages();
    if (!pages.pending || cell < 0 || cell >= keygrid::COUNT) {
        reply().println("ERR invalid cell");
        return true;
    }
    memset(pages.pending->own(cell), 0, KeyImage::bytes());
    pages.pending->drop_live(cell);
    pages.pending->mask |= 1 << cell;
    pages.pending->lit_mask &= ~(1 << cell);
    pages.pending_at = millis();
    deck_.warm_progress();
    reply().println("OK blank");
    return true;
}

// Its live picture was for the old own picture.
void PageCommands::arrived(int cell) {
    PageCache &pages = deck_.pages();
    Page &page = *pages.pending;
    const uint16_t *pixels = page.own(cell);
    page.drop_live(cell);
    pages.pending_at = millis();
    page.mask |= 1 << cell;
    bool lit = false;
    for (size_t i = 0; i < KeyImage::pixels(); ++i)
        if (pixels[i]) {
            lit = true;
            break;
        }
    if (lit) page.lit_mask |= 1 << cell;
    else page.lit_mask &= ~(1 << cell);
    deck_.warm_progress();
    reply().println("OK image");
}

bool PageCommands::push(const char *line) {
    int cell = 0;
    unsigned int bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "PUSH %d %u %u %c", &cell, &bytes, &checksum, &extra) != 3) return false;
    PageCache &pages = deck_.pages();
    if (!pages.pending || cell < 0 || cell >= keygrid::COUNT || bytes != KeyImage::bytes()) {
        reply().println("ERR invalid image payload");
        return true;
    }
    uint8_t *target = reinterpret_cast<uint8_t *>(pages.pending->own(cell));
    if (!deck_.transfer().read(target, bytes, checksum)) {
        pages.pending = nullptr;
        deck_.session().transitioning = false;
        return true;
    }
    arrived(cell);
    return true;
}

// As a patch (the LIVE format) to what the key holds: the copy the version
// started from, or - in a fresh one - nothing known, so then the patch covers
// the whole key. Most keys are mostly one colour: a whole key goes in a few KB
// instead of 29.
bool PageCommands::patch(const char *line) {
    int cell = 0;
    unsigned int bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "PATCH %d %u %u %c", &cell, &bytes, &checksum, &extra) != 3) return false;
    PageCache &pages = deck_.pages();
    if (!pages.pending || cell < 0 || cell >= keygrid::COUNT || !bytes || bytes > LIVE_MAX_BYTES) {
        reply().println("ERR invalid image patch");
        return true;
    }
    auto *payload = static_cast<uint8_t *>(memory::psram(bytes));
    if (!payload) {
        reply().println("ERR image allocation failed");
        return true;
    }
    uint16_t *image = pages.pending->own(cell);
    if (!deck_.transfer().read(payload, bytes, checksum)) {
        free(payload);
        pages.pending = nullptr;
        deck_.session().transitioning = false;
        return true;
    }
    const int W = KeyImage::width(), H = KeyImage::height();
    const bool valid = apply_patch(image, W, H, payload, bytes, false);
    if (valid) apply_patch(image, W, H, payload, bytes, true);
    free(payload);
    if (!valid) {
        reply().println("ERR image patch");
        return true;
    }
    arrived(cell);
    return true;
}

bool PageCommands::commit(const char *line) {
    unsigned int signature = 0;
    char extra = 0;
    if (sscanf(line, "COMMIT %u %c", &signature, &extra) != 1) return false;
    Session &session = deck_.session();
    PageCache &pages = deck_.pages();
    if (!pages.pending || pages.pending->signature != signature || pages.pending->mask != 0x7FFF) {
        reply().println("ERR incomplete page");
        return true;
    }
    Page &page = *pages.pending;
    page.complete = true;
    page.used = millis();
    session.heard(millis());
    if (pages.pending_activate) {
        pages.pending = nullptr;
        deck_.activate(page);
        deck_.view().draw_page();
    } else {
        pages.pending = nullptr;
        if (session.warming) {
            session.warm_done += keygrid::COUNT;
            deck_.warm_progress();
        }
    }
    pages.retire_others(page);
    session.transitioning = session.warming;
    // Shown first, then saved to the card by the main loop, a slice at a time.
    const bool stored = artwork_store::save_in_steps(page.id, -1, signature, page.pixels, KeyImage::bytes(),
                                                     keygrid::COUNT, page.lit_mask);
    reply().printf("OK committed %d stored=%d\n", page.id, stored ? 1 : 0);
    return true;
}

bool PageCommands::alternate(const char *line) {
    int id = 0, cell = 0;
    unsigned int signature = 0, bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "ALT %d %u %d %u %u %c", &id, &signature, &cell, &bytes, &checksum, &extra) != 5) return false;
    Session &session = deck_.session();
    Page *page = deck_.pages().find(id, signature);
    if (!page || cell < 0 || cell >= keygrid::COUNT || bytes != KeyImage::bytes()) {
        reply().println("ERR invalid alternate image");
        return true;
    }
    if (page->alternates[cell] && page->alternate_crc[cell] == checksum) {
        if (session.warming) {
            ++session.warm_done;
            deck_.warm_progress();
        }
        reply().println("OK alternate cached=1");
        return true;
    }
    if (memory::free_bytes() < bytes + memory::FLOOR) {
        reply().println("ERR insufficient PSRAM for toggle artwork");
        return true;
    }
    auto *pixels = static_cast<uint16_t *>(memory::psram(bytes));
    if (!pixels) {
        reply().println("ERR toggle allocation failed");
        return true;
    }
    uint16_t loaded_lit = 0;
    const bool loaded = artwork_store::load(id, cell, checksum, pixels, bytes, 1, loaded_lit);
    if (!loaded && !deck_.transfer().read(reinterpret_cast<uint8_t *>(pixels), bytes, checksum)) {
        free(pixels);
        return true;
    }
    free(page->alternates[cell]);
    page->alternates[cell] = pixels;
    page->alternate_crc[cell] = checksum;
    if (page == deck_.pages().active && (session.current_state & (1 << cell))) page->artwork_dirty |= 1 << cell;
    page->alternate_lit &= ~(1 << cell);
    for (size_t i = 0; i < KeyImage::pixels(); ++i)
        if (pixels[i]) {
            page->alternate_lit |= 1 << cell;
            break;
        }
    const bool stored =
        loaded || artwork_store::save(id, cell, checksum, pixels, bytes, 1, (page->alternate_lit & (1 << cell)) ? 1 : 0);
    session.heard(millis());
    if (session.warming) {
        ++session.warm_done;
        deck_.warm_progress();
    }
    reply().printf("OK alternate cached=%d stored=%d\n", loaded ? 1 : 0, stored ? 1 : 0);
    return true;
}

bool PageCommands::state(const char *line) {
    int id = 0;
    unsigned int signature = 0, mask = 0;
    char extra = 0;
    if (sscanf(line, "STATE %d %u %u %c", &id, &signature, &mask, &extra) != 3) return false;
    Session &session = deck_.session();
    PageCache &pages = deck_.pages();
    Page *page = pages.find(id, signature);
    if (!page || mask > 0x7FFF) {
        reply().println("ERR invalid page state");
        return true;
    }
    for (int i = 0; i < keygrid::COUNT; ++i)
        if ((mask & (1 << i)) && !page->alternates[i]) {
            reply().println("ERR toggle artwork not cached");
            return true;
        }
    const bool full = pages.active != page || deck_.status().shown();
    const uint16_t changed = (session.current_state ^ mask) | page->artwork_dirty;
    page->artwork_dirty = 0;
    pages.active = page;
    session.current_page = id;
    session.current_state = mask;
    page->used = millis();
    session.online = true;
    session.warming = false;
    deck_.status().hide();
    session.transitioning = false;
    // Nothing is drawn while something else has the panel (the game): the
    // state is kept, and the page is drawn whole when it comes back.
    if (deck_.panel_free()) {
        if (full) deck_.view().draw_page();
        else
            for (int cell = 0; cell < keygrid::COUNT; ++cell)
                if (changed & (1 << cell))
                    deck_.view().draw_key(cell, cell == deck_.touch().pressed_cell());
    }
    reply().printf("OK state %d mask=%u cells=%d\n", id, mask, full ? keygrid::COUNT : __builtin_popcount(changed));
    return true;
}

// A widget key's new picture, as a patch to the picture the page's copy shows
// for it now: its live picture, or its own until it has one. The page is named
// with its signature, and the picture it applies to by its CRC, so a patch
// meant for a page just left - or for a copy that has drifted - is refused and
// the desktop sends the whole key (base 0 skips the check). The patch goes into
// the key's live picture; the page's own stays as it was sent. 0 bytes drops
// the live picture, and the key shows its own again.
bool PageCommands::live(const char *line) {
    int id = 0, cell = 0;
    unsigned int signature = 0, base = 0, bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "LIVE %d %u %d %u %u %u %c", &id, &signature, &cell, &base, &bytes, &checksum, &extra) != 6)
        return false;
    Session &session = deck_.session();
    PageCache &pages = deck_.pages();
    Page *page = pages.find(id, signature);
    if (!page || cell < 0 || cell >= keygrid::COUNT || bytes > LIVE_MAX_BYTES) {
        reply().println("ERR invalid live patch");
        return true;
    }
    const bool shown = page == pages.active && deck_.panel_free();
    if (!bytes) {
        page->drop_live(cell);
        page->used = millis();
        session.heard(millis());
        if (shown) deck_.view().draw_key(cell, cell == deck_.touch().pressed_cell());
        reply().println("OK live");
        return true;
    }
    const uint16_t *showing = page->shown_off(cell);
    if (base && crc32(reinterpret_cast<const uint8_t *>(showing), KeyImage::bytes()) != base) {
        reply().println("ERR live base");
        return true;
    }
    // A key's first live picture starts as its own. Without room for one the
    // patch is refused, never written into the page's own picture: that must
    // stay what the signature says.
    const bool fresh = !page->live[cell];
    const bool whole_page = !pages.slots_ready();
    if (fresh && !page->new_live(cell, whole_page)) {
        // No room for another. The pages that are not on screen give theirs up,
        // oldest first, and this key tries again: what you are looking at is
        // worth more than what you are not.
        while (!page->live[cell] && pages.free_lives(page)) page->new_live(cell, whole_page);
        if (!page->live[cell]) {
            // What was left, so the desktop's log says how tight it really was.
            reply().printf("ERR live memory free=%u largest=%u\n",
                           static_cast<unsigned>(memory::free_bytes()),
                           static_cast<unsigned>(memory::largest_block()));
            return true;
        }
    }
    uint16_t *image = page->live[cell];
    if (fresh) memcpy(image, showing, KeyImage::bytes());
    auto *payload = static_cast<uint8_t *>(memory::psram(bytes));
    if (!payload) {
        if (fresh) page->drop_live(cell);
        reply().println("ERR live allocation failed");
        return true;
    }
    const int W = KeyImage::width(), H = KeyImage::height();
    const bool received = deck_.transfer().read(payload, bytes, checksum);
    const bool valid = received && apply_patch(image, W, H, payload, bytes, false);
    if (valid) apply_patch(image, W, H, payload, bytes, true);
    free(payload);
    if (!valid && fresh) page->drop_live(cell);
    if (!received) return true;
    if (!valid) {
        reply().println("ERR live payload");
        return true;
    }
    // A picture for a key of the page shown ends its animation: the countdown
    // is running. A hidden page's keys have none - while loading, the desktop
    // brings every page's widgets up to date, and that is loading too.
    if (page == pages.active) deck_.animations().disarm(cell);
    if (session.warming) {
        ++session.warm_done;
        deck_.warm_progress();
    }
    page->used = millis();
    session.heard(millis());
    if (page == pages.active && deck_.panel_free())
        deck_.view().draw_key(cell, cell == deck_.touch().pressed_cell());
    reply().println("OK live");
    return true;
}

bool PageCommands::slide(const char *line) {
    int id = 0, cell = 0;
    unsigned int signature = 0, bytes = 0, checksum = 0;
    char extra = 0;
    if (sscanf(line, "SLIDE %d %u %d %u %u %c", &id, &signature, &cell, &bytes, &checksum, &extra) != 5)
        return false;
    overlay(KeyOverlay::TEXT, id, signature, cell, bytes, checksum, 0);
    return true;
}

// Its line ends with the desktop's clock as it was sent (ms since 1970): the
// arc's motion is in that clock.
bool PageCommands::sweep(const char *line) {
    int id = 0, cell = 0;
    unsigned int signature = 0, bytes = 0, checksum = 0;
    long long clock = 0;
    char extra = 0;
    if (sscanf(line, "SWEEP %d %u %d %u %u %lld %c", &id, &signature, &cell, &bytes, &checksum, &clock, &extra) != 6)
        return false;
    overlay(KeyOverlay::SWEEP, id, signature, cell, bytes, checksum, clock);
    return true;
}

// On any page the deck holds; 0 bytes takes it away. It goes over the key's
// live picture, and with it.
void PageCommands::overlay(KeyOverlay::Kind kind, int id, uint32_t signature, int cell, size_t bytes,
                           uint32_t checksum, int64_t clock) {
    // Taken now, before its bytes arrive: the desktop's clock was read as the
    // line was sent.
    const uint32_t heard = millis();
    const OverlayKind &type = OVERLAY_KINDS[kind];
    // Replies as println ends them.
    const auto answer = [&](const char *format) {
        reply().printf(format, type.name);
        reply().print("\r\n");
    };
    Session &session = deck_.session();
    PageCache &pages = deck_.pages();
    Page *page = pages.find(id, signature);
    if (!page || cell < 0 || cell >= keygrid::COUNT || bytes > type.max_bytes) {
        answer("ERR invalid %s");
        return;
    }
    KeyOverlay *overlay = nullptr;
    if (bytes) {
        auto *payload = static_cast<uint8_t *>(memory::psram(bytes));
        if (!payload) {
            answer("ERR %s allocation failed");
            return;
        }
        if (!deck_.transfer().read(payload, bytes, checksum)) {
            free(payload);
            return;
        }
        overlay = type.load(payload, bytes, heard, clock);
        if (!overlay) {
            answer("ERR %s payload");
            return;
        }
    }
    page->set_overlay(cell, kind, overlay);
    page->used = millis();
    session.heard(millis());
    if (page == pages.active && deck_.panel_free())
        deck_.view().draw_key(cell, cell == deck_.touch().pressed_cell());
    answer("OK %s");
}
