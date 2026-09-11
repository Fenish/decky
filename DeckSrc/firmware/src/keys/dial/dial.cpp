#pragma GCC optimize("O2", "fast-math")
#include "keys/dial/dial.h"
#include <Arduino.h>
#include <math.h>
#include <new>
#include "common/key_image.h"
#include "common/memory.h"

namespace keys {
namespace {
// A dial's value goes to the desktop no more often than this while it turns.
constexpr uint32_t VALUE_MS = 40;
}  // namespace

DialLook::~DialLook() {
    free(fill);
    free(map);
}

bool DialLook::read(ByteReader &r) {
    const size_t pixels = KeyImage::pixels();
    min = r.u16();
    max = r.u16();
    unit_px = r.u16() / 10.f;
    text_y = r.u16();
    color = r.u16();
    const int writes = r.u8();
    number = writes == 1;
    if (!r.ok || max <= min || max > 1000 || unit_px <= 0 || text_y >= KeyImage::height() || writes > 1) return false;
    fill = memory::pixels(pixels);
    map = static_cast<uint8_t *>(memory::psram(pixels));
    if (!fill || !map) return false;
    memset(backdrop_, 0, KeyImage::bytes());
    if (!picture(r, backdrop_)) return false;
    memcpy(fill, backdrop_, KeyImage::bytes());
    if (!picture(r, fill)) return false;
    // The map, as runs: a count (1-255) and the share its pixels fill at.
    const uint32_t bytes = r.u32();
    const uint8_t *runs = r.take(bytes);
    if (!r.ok || bytes % 2) return false;
    size_t at = 0;
    for (uint32_t i = 0; i < bytes; i += 2) {
        if (!runs[i] || at + runs[i] > pixels) return false;
        memset(map + at, runs[i + 1], runs[i]);
        at += runs[i];
    }
    if (at != pixels) return false;
    // Digits only for a dial that writes its number (the arc; the bar none).
    if (number) {
        if (!digits.read(r)) return false;
        for (char c = '0'; c <= '9'; ++c)
            if (digits.index_of(c) < 0) return false;
    }
    return r.at == r.length;
}

KeyAnimation *DialLook::animate(int index, uint16_t *frame) const {
    return new (std::nothrow) Dial(*this, index, frame);
}

Dial::Dial(const DialLook &look, int index, uint16_t *frame) : KeyAnimation(look, frame), pos_(index), index_(index) {}

bool Dial::tick(uint32_t now) {
    // A new picture once it moved a fifth of a step.
    return fabsf(pos_ - drawn_) >= 0.2f && now - composed_ms >= FRAME_MS;
}

// Each pixel from its highest or its lowest picture by the map, and its value
// written in the middle.
void Dial::compose() {
    const DialLook &look = dial();
    const float share = (pos_ - look.min) / static_cast<float>(look.max - look.min);
    const uint8_t level = static_cast<uint8_t>(constrain(lroundf(share * 254.f), 0L, 254L));
    const int pixels = KeyImage::pixels();
    for (int i = 0; i < pixels; ++i) frame_[i] = look.map[i] <= level ? look.fill[i] : look.backdrop()[i];
    if (look.number) {
        char digits[8];
        const int length = snprintf(digits, sizeof digits, "%d", static_cast<int>(lroundf(pos_)));
        uint8_t ids[8];
        int width = 0;
        for (int c = 0; c < length; ++c) {
            ids[c] = look.digits.index_of(digits[c]);
            width += look.digits.widths[ids[c]];
        }
        draw_text(frame_, look.digits, ids, length, width, look.text_y, 1.f, 256, look.color, 0, KeyImage::height());
    }
    drawn_ = pos_;
}

void Dial::touch(int y, uint32_t now, bool landed) {
    const DialLook &look = dial();
    if (landed) {
        mode_ = DRAG;
        grab_y_ = y;
        grab_pos_ = pos_;
    }
    if (mode_ != DRAG) return;
    // Up is more, a step every unit_px of finger; no further than the ends.
    pos_ = constrain(grab_pos_ + (grab_y_ - y) / look.unit_px, static_cast<float>(look.min),
                     static_cast<float>(look.max));
    const int value = lroundf(pos_);
    if (value != index_) {
        index_ = value;
        report_ = true;
    }
}

void Dial::release(uint32_t now) {
    if (mode_ != DRAG) return;
    // The last value goes at once, however soon after the one before.
    mode_ = REST;
    reported_ms_ = 0;
}

int Dial::value(uint32_t now) {
    if (!report_) return INT_MIN;
    if (mode_ == DRAG && now - reported_ms_ < VALUE_MS) return INT_MIN;
    report_ = false;
    reported_ms_ = now;
    return index_;
}
}  // namespace keys
