#pragma once
#include <stdint.h>
#include "pages/page.h"

// The copies of pages the deck holds: up to eight static pages in PSRAM, plus
// two staging slots, so every page the desktop advertised survives while one
// is replaced - including the page shown, which stays until the new version
// is complete. The desktop is the durable source; the SD card keeps copies
// across a restart, and PSRAM ones are gone after it.
class PageCache {
public:
    static constexpr int CACHE_SLOTS = 8;
    static constexpr int STORAGE_SLOTS = CACHE_SLOTS + 2;
    static constexpr int MAX_PAGES = 64;

    // How starting a copy of a page went (start()).
    enum class Start { FromCard, Building, Full, NoMemory, AllocationFailed };
    struct Started {
        Start result;
        Page *page;
        Page *base;        // the copy a new version was built from, if any
        uint16_t carried;  // keys whose live pictures (and text) it carried
    };

    // The complete copy of page `id` at `signature`, if the deck holds one.
    Page *find(int id, uint32_t signature);
    // A copy of page `id` at `signature` in a free (or the oldest) slot - never
    // the page shown, nor the newest copy of the same page, which a new version
    // is built from. Read from the card when it has that version; else begun
    // from that newest copy, own pictures, live pictures and their text: its
    // changed keys follow. The caller has looked for a complete copy first.
    Started start(int id, uint32_t signature);
    // A version just committed: the page's other copies go, but the one shown.
    // Their buffers stay with their slots, so freeing and reallocating pages
    // can't break memory into pieces too small for the next page.
    void retire_others(const Page &committed);
    // Every copy's live pictures and text go: they are the session's.
    void drop_lives();

    Page *active = nullptr;   // the copy shown
    Page *pending = nullptr;  // the version being built
    bool pending_activate = true;  // shown once committed (PAGE), not only kept (CACHE)
    uint32_t pending_at = 0;       // when the version being built last heard from the desktop

private:
    Page slots_[STORAGE_SLOTS];
};
