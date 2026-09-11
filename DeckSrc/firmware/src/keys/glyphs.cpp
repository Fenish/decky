// Drawn into animation frames 60 times a second: speed over size, as the rest
// of keys/ (see animated_keys.cpp).
#pragma GCC optimize("O2", "fast-math")
#include "keys/glyphs.h"
#include <Arduino.h>
#include <math.h>
#include "common/color.h"
#include "common/key_image.h"

namespace keys {
bool GlyphSet::read(ByteReader &r) {
    height = r.u8();
    count = r.u8();
    if (!r.ok || height < 1 || height > 64 || count < 1 || count > MAX_GLYPHS) return false;
    for (int g = 0; g < count; ++g) {
        chars[g] = r.u8();
        widths[g] = r.u8();
        if (!widths[g] || widths[g] > 64) return false;
    }
    for (int g = 0; g < count; ++g) alpha[g] = r.take(widths[g] * height);
    return r.ok;
}

int GlyphSet::index_of(uint8_t c) const {
    for (int g = 0; g < count; ++g)
        if (chars[g] == c) return g;
    return -1;
}

void draw_text(uint16_t *out, const GlyphSet &size, const uint8_t *glyph_ids, int length, int width, float y_mid,
               float squash, int strength, uint16_t color, int top_limit, int bottom_limit) {
    const int W = KeyImage::width(), H = KeyImage::height();
    const float height = size.height * squash;
    const float top = y_mid - height / 2;
    const int y0 = max(max(static_cast<int>(ceilf(top)), top_limit), 0);
    const int y1 = min(min(static_cast<int>(ceilf(top + height)), bottom_limit), H);
    const int x0 = (W - width) / 2;
    for (int y = y0; y < y1; ++y) {
        const int sy = constrain(static_cast<int>((y - top) / squash), 0, size.height - 1);
        uint16_t *line = out + y * W;
        int x = x0;
        for (int c = 0; c < length; ++c) {
            const int glyph = glyph_ids[c], w = size.widths[glyph];
            const uint8_t *alpha = size.alpha[glyph] + sy * w;
            for (int gx = 0; gx < w; ++gx) {
                const int px = x + gx;
                if (px < 0 || px >= W || !alpha[gx]) continue;
                line[px] = blend(line[px], color, (alpha[gx] * strength) >> 8);
            }
            x += w;
        }
    }
}
}  // namespace keys
