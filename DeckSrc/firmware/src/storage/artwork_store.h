#pragma once
#include <Arduino.h>

// Pages and ON pictures on the microSD card, under /decky-cache/, so a deck
// that restarts shows its pages without a whole upload. A copy is only used
// when its pictures still have the CRC it was saved under; anything torn or
// stale is fetched from the desktop again. Files outside /decky-cache/ are
// never touched, and the card is never formatted.
namespace artwork_store {
// Mount the card (the panel's separate TF slot).
void begin();
bool available();
uint64_t capacity();
// Page `page`'s keys (cell -1) or one ON picture (cell >= 0) at `signature`,
// into `pixels`; false when the card has no good copy.
bool load(int page, int cell, uint32_t signature, uint16_t *pixels, size_t cell_bytes, int cells, uint16_t &lit_mask);
// Saved through a temporary file and a backup, so a torn write loses nothing.
bool save(int page, int cell, uint32_t signature, const uint16_t *pixels, size_t cell_bytes, int cells,
          uint16_t lit_mask);
}  // namespace artwork_store
