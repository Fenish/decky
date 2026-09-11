#include "keys/text/sliding_text.h"
#include <Arduino.h>
#include <new>
#include "common/color.h"
#include "common/key_image.h"
#include "common/memory.h"

namespace {
uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
}  // namespace

int SlidingText::offset_at(const Line &line, uint32_t now_ms) const {
    const uint32_t lap = line.strip + gap_;
    const uint32_t sliding = lap * 1000 / speed_;
    const uint32_t t = (now_ms - start_) % (pause_ + sliding);
    if (t < static_cast<uint32_t>(pause_)) return 0;
    return static_cast<int>(min<uint32_t>(lap - 1, (t - pause_) * speed_ / 1000));
}

// Laid out, little-endian: u8 1, u8 lines (1-2), u16 rest (ms), u16 speed
// (px/s), u16 gap (px), u8 fade (px), u8 0; per line u16 x, y, w, h (its
// window), u16 the text's width, u16 colour (RGB565), then its coverage.
SlidingText *SlidingText::load(uint8_t *data, size_t length, uint32_t now_ms) {
    SlidingText *text = new (std::nothrow) SlidingText;
    if (!text) {
        free(data);
        return nullptr;
    }
    text->data_ = data;
    text->length_ = length;
    text->start_ = now_ms;
    const auto bad = [&]() {
        delete text;
        return nullptr;
    };
    if (length < 10 || data[0] != 1 || data[1] < 1 || data[1] > MAX_LINES || data[9] != 0) return bad();
    text->count_ = data[1];
    text->pause_ = u16(data + 2);
    text->speed_ = u16(data + 4);
    text->gap_ = u16(data + 6);
    text->fade_ = data[8];
    if (text->speed_ < 1 || text->speed_ > 1000 || text->gap_ > 1000 || text->fade_ > 32) return bad();
    const int image_w = KeyImage::width(), image_h = KeyImage::height();
    size_t at = 10;
    int left = image_w, top = image_h, right = 0, bottom = 0;
    for (int i = 0; i < text->count_; ++i) {
        if (length - at < 12) return bad();
        Line &line = text->lines_[i];
        const uint8_t *p = data + at;
        line.x = u16(p);
        line.y = u16(p + 2);
        line.w = u16(p + 4);
        line.h = u16(p + 6);
        line.strip = u16(p + 8);
        line.color = u16(p + 10);
        at += 12;
        // Clear of the key's edges, where a pressed key's outline runs.
        if (line.w < 8 || line.h < 1 || line.h > 48 || line.x < 2 || line.x + line.w > image_w - 2 ||
            line.y + line.h > image_h || line.strip <= line.w || line.strip > 4096 || text->fade_ * 2 >= line.w)
            return bad();
        const size_t bytes = static_cast<size_t>(line.strip) * line.h;
        if (length - at < bytes) return bad();
        line.alpha = data + at;
        at += bytes;
        left = min(left, line.x);
        top = min(top, line.y);
        right = max(right, line.x + line.w);
        bottom = max(bottom, line.y + line.h);
    }
    if (at != length) return bad();
    text->box_ = {left, top, right - left, bottom - top};
    return text;
}

SlidingText *SlidingText::clone() const {
    auto *data = static_cast<uint8_t *>(memory::psram(length_));
    if (!data) return nullptr;
    SlidingText *copy = new (std::nothrow) SlidingText;
    if (!copy) {
        free(data);
        return nullptr;
    }
    memcpy(data, data_, length_);
    copy->data_ = data;
    copy->length_ = length_;
    copy->start_ = start_;
    copy->pause_ = pause_;
    copy->speed_ = speed_;
    copy->gap_ = gap_;
    copy->fade_ = fade_;
    copy->count_ = count_;
    copy->box_ = box_;
    // The lines point into the data: into the copy's now.
    for (int i = 0; i < count_; ++i) {
        copy->lines_[i] = lines_[i];
        copy->lines_[i].alpha = data + (lines_[i].alpha - data_);
    }
    return copy;
}

SlidingText::~SlidingText() { free(data_); }

bool SlidingText::due(uint32_t now_ms) const {
    for (int i = 0; i < count_; ++i)
        if (offset_at(lines_[i], now_ms) != lines_[i].shown) return true;
    return false;
}

void SlidingText::frame(uint32_t now_ms) {
    for (int i = 0; i < count_; ++i) {
        Line &line = lines_[i];
        line.offset = line.shown = offset_at(line, now_ms);
    }
}

void SlidingText::paint(int y, uint16_t *row) const {
    for (int i = 0; i < count_; ++i) {
        const Line &line = lines_[i];
        if (y < line.y || y >= line.y + line.h) continue;
        const uint8_t *alpha = line.alpha + (y - line.y) * line.strip;
        const int lap = line.strip + gap_;
        // The right edge fades always - there is more to come - and the left
        // one only as the text moves, so a line at rest shows its first letter
        // whole and neither edge jumps as a lap begins or ends.
        const int fade_left = min(fade_, min(line.offset, lap - line.offset));
        const int fade_right = fade_;
        uint16_t *target = row + line.x;
        for (int c = 0; c < line.w; ++c) {
            int s = c + line.offset;
            if (s >= lap) s -= lap;
            if (s >= line.strip) continue;
            int a = alpha[s];
            if (!a) continue;
            if (c < fade_left) a = a * (c + 1) / (fade_left + 1);
            const int from_right = line.w - 1 - c;
            if (from_right < fade_right) a = a * (from_right + 1) / (fade_right + 1);
            target[c] = blend(target[c], line.color, a);
        }
    }
}
