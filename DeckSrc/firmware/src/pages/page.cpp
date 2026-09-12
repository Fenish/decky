#include "pages/page.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "common/memory.h"

namespace {
// Room for one more live picture. A page must never fail to build for want of
// memory a live picture took, so a whole page is kept free in one piece - but
// only while a slot has yet to take its buffer. Slots keep theirs once they
// have them (PageCache), so after that a page needs no memory at all, and
// holding back half a megabyte for it costs the widget keys their pictures.
bool live_room(bool whole_page) {
    return memory::spare(KeyImage::bytes(), whole_page ? KeyImage::bytes() * Page::KEYS : 0);
}
}  // namespace

uint16_t *Page::own(int cell) const { return pixels + KeyImage::pixels() * cell; }

uint16_t *Page::shown_off(int cell) const { return live[cell] ? live[cell] : own(cell); }

uint16_t *Page::new_live(int cell, bool whole_page) {
    if (!live_room(whole_page)) return nullptr;
    live[cell] = memory::pixels(KeyImage::pixels());
    return live[cell];
}

void Page::drop_live(int cell) {
    free(live[cell]);
    live[cell] = nullptr;
    for (int kind = 0; kind < KeyOverlay::KINDS; ++kind) set_overlay(cell, static_cast<KeyOverlay::Kind>(kind), nullptr);
}

void Page::set_overlay(int cell, KeyOverlay::Kind kind, KeyOverlay *overlay) {
    delete overlays[cell][kind];
    overlays[cell][kind] = overlay;
}

bool Page::has_overlays(int cell) const {
    for (const KeyOverlay *overlay : overlays[cell])
        if (overlay) return true;
    return false;
}

void Page::drop_lives() {
    for (int cell = 0; cell < KEYS; ++cell) drop_live(cell);
}

void Page::drop_alternates() {
    for (int cell = 0; cell < KEYS; ++cell) {
        free(alternates[cell]);
        alternates[cell] = nullptr;
        alternate_crc[cell] = 0;
    }
}
