#include "pages/page_cache.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "common/memory.h"
#include "storage/artwork_store.h"

Page *PageCache::find(int id, uint32_t signature) {
    for (auto &page : slots_)
        if (page.id == id && page.signature == signature && page.complete) return &page;
    return nullptr;
}

PageCache::Started PageCache::start(int id, uint32_t signature) {
    // A save under way reads from a page this may reuse.
    artwork_store::finish();
    const size_t key_bytes = KeyImage::bytes(), page_bytes = key_bytes * Page::KEYS;
    Page *base = nullptr;
    for (auto &page : slots_)
        if (page.complete && page.id == id && (!base || page.used >= base->used)) base = &page;
    Page *slot = nullptr;
    for (auto &page : slots_)
        if (&page != active && &page != base && (!slot || page.id == -1 || page.used < slot->used)) {
            slot = &page;
            if (page.id == -1) break;
        }
    if (!slot) return {Start::Full, nullptr, base, 0};
    if (!slot->pixels) {
        if (memory::free_bytes() < page_bytes + memory::FLOOR || memory::largest_block() < page_bytes)
            return {Start::NoMemory, nullptr, base, 0};
        slot->pixels = memory::pixels(KeyImage::pixels() * Page::KEYS);
        if (!slot->pixels) return {Start::AllocationFailed, nullptr, base, 0};
    }
    slot->drop_alternates();
    slot->drop_lives();
    slot->alternate_lit = 0;
    slot->artwork_dirty = 0;
    slot->id = id;
    slot->signature = signature;
    slot->complete = false;
    slot->mask = 0;
    slot->used = millis();
    if (artwork_store::load(id, -1, signature, slot->pixels, key_bytes, Page::KEYS, slot->lit_mask)) {
        slot->complete = true;
        slot->mask = 0x7FFF;
        return {Start::FromCard, slot, base, 0};
    }
    uint16_t carried = 0;
    if (base) {
        memcpy(slot->pixels, base->pixels, page_bytes);
        slot->mask = 0x7FFF;
        slot->lit_mask = base->lit_mask;
        for (int cell = 0; cell < Page::KEYS; ++cell) {
            if (!base->live[cell] || !slot->new_live(cell)) continue;
            memcpy(slot->live[cell], base->live[cell], key_bytes);
            // Its overlays go with it, or none of it does.
            bool whole = true;
            for (int kind = 0; kind < KeyOverlay::KINDS && whole; ++kind)
                if (const KeyOverlay *overlay = base->overlays[cell][kind])
                    whole = (slot->overlays[cell][kind] = overlay->clone()) != nullptr;
            if (!whole) {
                slot->drop_live(cell);
                continue;
            }
            carried |= 1 << cell;
        }
    } else slot->lit_mask = 0;
    return {Start::Building, slot, base, carried};
}

void PageCache::retire_others(const Page &committed) {
    for (auto &page : slots_)
        if (page.id == committed.id && page.signature != committed.signature && &page != active) {
            page.id = -1;
            page.complete = false;
            page.drop_alternates();
            page.drop_lives();
        }
}

void PageCache::drop_lives() {
    for (auto &page : slots_) page.drop_lives();
}

bool PageCache::free_lives(const Page *keep) {
    Page *oldest = nullptr;
    for (auto &page : slots_) {
        if (&page == active || &page == pending || &page == keep) continue;
        bool holds = false;
        for (uint16_t *live : page.live) holds = holds || live;
        if (holds && (!oldest || page.used < oldest->used)) oldest = &page;
    }
    if (!oldest) return false;
    oldest->drop_lives();
    return true;
}
