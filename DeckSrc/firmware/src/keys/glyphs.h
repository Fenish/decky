#pragma once
#include <stdint.h>
#include "common/byte_reader.h"

namespace keys {
// Characters at one font size, drawn by the desktop as it draws text and sent
// as coverage (0-255): the deck puts numbers and labels together from these,
// so they look as they do in the app.
struct GlyphSet {
    static constexpr int MAX_GLYPHS = 64;
    uint8_t height = 0, count = 0;
    uint8_t chars[MAX_GLYPHS] = {};
    uint8_t widths[MAX_GLYPHS] = {};
    const uint8_t *alpha[MAX_GLYPHS] = {};  // into the look's data

    // One font size as a look carries it: u8 height, u8 glyphs, per glyph
    // (u8 character, u8 width), then each glyph's coverage, row by row.
    bool read(ByteReader &r);
    // The glyph for character `c`, or -1.
    int index_of(uint8_t c) const;
};

// Glyphs side by side, centred on the key, middle at y_mid, faded by strength
// (0-256) and squashed by squash; only rows between top and bottom.
void draw_text(uint16_t *out, const GlyphSet &size, const uint8_t *glyph_ids, int length, int width, float y_mid,
               float squash, int strength, uint16_t color, int top_limit, int bottom_limit);
}  // namespace keys
