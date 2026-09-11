#include "slide.h"
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <new>

namespace slide {
namespace {
constexpr int MAX_LINES = 2;
struct Line {
    int x = 0, y = 0, w = 0, h = 0;  // its window, in key pixels
    int strip = 0;                   // the text's width: more than the window's
    uint16_t color = 0;              // RGB565
    const uint8_t *alpha = nullptr;  // coverage, strip x h, row by row
    int offset = 0;                  // how far it has slid, this frame
    int shown = -1;                  // and the last frame drawn
};
uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
inline uint16_t blend(uint16_t under, uint16_t over, int a) {
    a += a >> 7;
    const int ur = under >> 11, ug = (under >> 5) & 63, ub = under & 31;
    const int orr = over >> 11, og = (over >> 5) & 63, ob = over & 31;
    return ((ur + (((orr - ur) * a) >> 8)) << 11) | ((ug + (((og - ug) * a) >> 8)) << 5) | (ub + (((ob - ub) * a) >> 8));
}
}  // namespace

struct Text {
    uint8_t *data = nullptr;
    size_t length = 0;
    uint32_t start = 0;
    int pause = 0, speed = 1, gap = 0, fade = 0;
    int count = 0;
    Line lines[MAX_LINES];
    Box box{};
};

namespace {
// Pixels a line has slid at `now`: none while it rests, then steadily on to
// one lap (its width and the gap), where it looks as it did at rest.
int offset_at(const Text &text, const Line &line, uint32_t now_ms) {
    const uint32_t lap = line.strip + text.gap;
    const uint32_t sliding = lap * 1000 / text.speed;
    const uint32_t t = (now_ms - text.start) % (text.pause + sliding);
    if (t < static_cast<uint32_t>(text.pause)) return 0;
    return static_cast<int>(min<uint32_t>(lap - 1, (t - text.pause) * text.speed / 1000));
}
}  // namespace

// Laid out, little-endian: u8 1, u8 lines (1-2), u16 rest (ms), u16 speed
// (px/s), u16 gap (px), u8 fade (px), u8 0; per line u16 x, y, w, h (its
// window), u16 the text's width, u16 colour (RGB565), then its coverage.
Text *load(uint8_t *data, size_t length, int image_w, int image_h, uint32_t now_ms) {
    Text *text = new (std::nothrow) Text;
    if (!text) { free(data); return nullptr; }
    text->data = data;
    text->length = length;
    text->start = now_ms;
    const auto bad = [&]() { release(text); return nullptr; };
    if (length < 10 || data[0] != 1 || data[1] < 1 || data[1] > MAX_LINES || data[9] != 0) return bad();
    text->count = data[1];
    text->pause = u16(data + 2);
    text->speed = u16(data + 4);
    text->gap = u16(data + 6);
    text->fade = data[8];
    if (text->speed < 1 || text->speed > 1000 || text->gap > 1000 || text->fade > 32) return bad();
    size_t at = 10;
    int left = image_w, top = image_h, right = 0, bottom = 0;
    for (int i = 0; i < text->count; ++i) {
        if (length - at < 12) return bad();
        Line &line = text->lines[i];
        const uint8_t *p = data + at;
        line.x = u16(p); line.y = u16(p + 2); line.w = u16(p + 4); line.h = u16(p + 6);
        line.strip = u16(p + 8); line.color = u16(p + 10);
        at += 12;
        // Clear of the key's edges, where a pressed key's outline runs.
        if (line.w < 8 || line.h < 1 || line.h > 48 || line.x < 2 || line.x + line.w > image_w - 2 ||
            line.y + line.h > image_h || line.strip <= line.w || line.strip > 4096 || text->fade * 2 >= line.w)
            return bad();
        const size_t bytes = static_cast<size_t>(line.strip) * line.h;
        if (length - at < bytes) return bad();
        line.alpha = data + at;
        at += bytes;
        left = min(left, line.x); top = min(top, line.y);
        right = max(right, line.x + line.w); bottom = max(bottom, line.y + line.h);
    }
    if (at != length) return bad();
    text->box = {left, top, right - left, bottom - top};
    return text;
}

Text *clone(const Text *text) {
    auto *data = static_cast<uint8_t*>(heap_caps_malloc(text->length, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!data) return nullptr;
    Text *copy = new (std::nothrow) Text(*text);
    if (!copy) { free(data); return nullptr; }
    memcpy(data, text->data, text->length);
    // The lines point into the data: into the copy's now.
    for (int i = 0; i < copy->count; ++i) copy->lines[i].alpha = data + (text->lines[i].alpha - text->data);
    copy->data = data;
    return copy;
}

void release(Text *text) {
    if (!text) return;
    free(text->data);
    delete text;
}

Box box(const Text *text) { return text->box; }

bool due(const Text *text, uint32_t now_ms) {
    for (int i = 0; i < text->count; ++i)
        if (offset_at(*text, text->lines[i], now_ms) != text->lines[i].shown) return true;
    return false;
}

void frame(Text *text, uint32_t now_ms) {
    for (int i = 0; i < text->count; ++i) {
        Line &line = text->lines[i];
        line.offset = line.shown = offset_at(*text, line, now_ms);
    }
}

void row(const Text *text, int y, const uint16_t *key_row, uint16_t *out) {
    const Box &box = text->box;
    memcpy(out, key_row + box.x, box.w * sizeof(uint16_t));
    for (int i = 0; i < text->count; ++i) {
        const Line &line = text->lines[i];
        if (y < line.y || y >= line.y + line.h) continue;
        const uint8_t *alpha = line.alpha + (y - line.y) * line.strip;
        const int lap = line.strip + text->gap;
        // The right edge fades always - there is more to come - and the left
        // one only as the text moves, so a line at rest shows its first letter
        // whole and neither edge jumps as a lap begins or ends.
        const int fade_left = min(text->fade, min(line.offset, lap - line.offset));
        const int fade_right = text->fade;
        uint16_t *target = out + (line.x - box.x);
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
}  // namespace slide
