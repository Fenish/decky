#include "pages/page.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "common/memory.h"

namespace {
// Room for one more live picture that still leaves the floor free and a whole
// page in one piece: live pictures must never be why a page cannot be built.
bool live_room() { return memory::spare(KeyImage::bytes(), KeyImage::bytes() * Page::KEYS); }
}  // namespace

uint16_t *Page::own(int cell) const { return pixels + KeyImage::pixels() * cell; }

uint16_t *Page::shown_off(int cell) const { return live[cell] ? live[cell] : own(cell); }

uint16_t *Page::new_live(int cell) {
    if (!live_room()) return nullptr;
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
