#pragma once
#include <stdint.h>
#include "keys/overlay.h"

// A copy of one of the desktop's pages, as the deck holds it in PSRAM - named
// by the page's index (id) and signature, the CRC-32 of its 15 keys' own
// pictures.
//
//  - Own pictures: exactly as the desktop sent them, so they always match the
//    signature and the SD card's copy. A new version of a page starts from
//    them and needs only its changed keys.
//  - ON pictures (alternates): a toggle key switched on, sent apart (ALT) and
//    chosen with STATE.
//  - Live pictures: widget keys' current pictures (LIVE), kept apart from the
//    own ones and shown over them.
//  - Overlays: what the deck moves over a key's live picture by itself -
//    sliding text (SLIDE), a ring's arc (SWEEP) - going with it.
class Page {
public:
    static constexpr int KEYS = 15;

    // The key's own picture.
    uint16_t *own(int cell) const;
    // The key as it shows when not switched on: its live picture, else its own.
    uint16_t *shown_off(int cell) const;
    // A live picture for the key, begun empty; null without room for one.
    // `whole_page` keeps a page's worth free besides, for a cache that has
    // slots still to allocate (PageCache::slots_ready).
    uint16_t *new_live(int cell, bool whole_page);
    // A key's live picture goes, and its overlays with it.
    void drop_live(int cell);
    void drop_lives();
    void drop_alternates();
    // A key's overlay of this kind, in place of any it had; null takes it away.
    void set_overlay(int cell, KeyOverlay::Kind kind, KeyOverlay *overlay);
    bool has_overlays(int cell) const;

    int id = -1;
    uint32_t signature = 0;
    uint32_t used = 0;       // when it was last shown or sent to: the oldest goes first
    uint16_t mask = 0;       // keys it has pictures for, while being built
    uint16_t lit_mask = 0;   // keys whose own picture is not all black
    uint16_t *pixels = nullptr;  // the own pictures, key after key; kept once allocated
    bool complete = false;
    uint16_t *alternates[KEYS] = {};
    uint32_t alternate_crc[KEYS] = {};
    uint16_t alternate_lit = 0;
    uint16_t artwork_dirty = 0;  // ON pictures replaced while showing
    uint16_t *live[KEYS] = {};
    KeyOverlay *overlays[KEYS][KeyOverlay::KINDS] = {};
};
