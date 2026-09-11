// An arc's frames are drawn beside the panel's scanout, a pixel loop each
// time its end moves: speed over size, as in the rest of keys/.
#pragma GCC optimize("O2", "fast-math")
#include "keys/sweep/sweep.h"
#include <Arduino.h>
#include <math.h>
#include <new>
#include "common/color.h"
#include "common/key_image.h"
#include "common/memory.h"
#include "keygrid.h"

namespace {
uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
uint32_t u32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24); }
float clamp01(float v) { return v < 0.f ? 0.f : v > 1.f ? 1.f : v; }
float squared(float v) { return v * v; }
// A day: longer turns are a mistake.
constexpr int32_t LONGEST_TURN_MS = 86400000;
}  // namespace

uint8_t Sweep::cover(float distance) const {
    const float stroke = clamp01(half_ + 0.5f - distance);
    float glow = 0.f;
    if (glow_ && reach_ > 0.f) {
        const float t = distance <= half_ ? 0.f : (distance - half_) / reach_;
        if (t < 1.f) glow = glow_ / 255.f * squared(1.f - t);
    }
    return static_cast<uint8_t>(fmaxf(stroke, glow) * 255.f + 0.5f);
}

// Laid out, little-endian: u8 1, u8 motion (0 still, 1 once, 2 round), u16 x,
// y, radius, width (1/16 px: the ring's middle line and stroke), u16 colour
// (RGB565), u8 its opacity, u8 glow (0-255, at the stroke's edge), u8 the
// glow's reach (px), u8 0, u16 the share held still (of 65535), u16 0, i64
// when the share was none (ms, the desktop's clock), i32 ms a turn takes
// (below 0, it runs back).
Sweep *Sweep::load(uint8_t *data, size_t length, uint32_t now_ms, int64_t clock) {
    const bool shaped =
        length == BYTES && data[0] == 1 && data[1] <= ROUND && data[15] == 0 && data[18] == 0 && data[19] == 0;
    Sweep *sweep = shaped ? new (std::nothrow) Sweep : nullptr;
    if (!sweep) {
        free(data);
        return nullptr;
    }
    const int x16 = u16(data + 2), y16 = u16(data + 4), r16 = u16(data + 6), w16 = u16(data + 8);
    const int reach = data[14];
    sweep->color_ = u16(data + 10);
    sweep->alpha_ = data[12];
    sweep->glow_ = data[13];
    sweep->motion_ = static_cast<Motion>(data[1]);
    sweep->still_ = static_cast<uint32_t>(u16(data + 16)) * TURN / 65535;
    sweep->zero_ = static_cast<int64_t>((static_cast<uint64_t>(u32(data + 24)) << 32) | u32(data + 20));
    sweep->turn_ = static_cast<int32_t>(u32(data + 28));
    free(data);
    // Where it reaches, in 1/16 px: the stroke, its glow and a pixel for the
    // antialiasing. It stays 2 px inside the key, clear of a pressed outline.
    const int extent16 = r16 + w16 / 2 + reach * 16 + 16;
    const int left16 = x16 - extent16, top16 = y16 - extent16;
    const int right16 = x16 + extent16, bottom16 = y16 + extent16;
    const bool moving = sweep->motion_ != STILL;
    if (r16 < 16 || w16 < 8 || w16 > r16 || reach > 32 ||
        (moving && (sweep->turn_ == 0 || abs(sweep->turn_) > LONGEST_TURN_MS)) || left16 < 32 || top16 < 32 ||
        right16 > (KeyImage::width() - 2) * 16 || bottom16 > (KeyImage::height() - 2) * 16) {
        delete sweep;
        return nullptr;
    }
    sweep->cx_ = x16 / 16.f;
    sweep->cy_ = y16 / 16.f;
    sweep->r_ = r16 / 16.f;
    sweep->half_ = w16 / 32.f;
    sweep->reach_ = static_cast<float>(reach);
    sweep->clock_ = clock;
    sweep->at_ms_ = now_ms;
    sweep->step_ = max<uint32_t>(1, static_cast<uint32_t>(TURN * 0.25f / (2.f * PI * sweep->r_)));
    sweep->box_ = {left16 >> 4, top16 >> 4, ((right16 + 15) >> 4) - (left16 >> 4),
                   ((bottom16 + 15) >> 4) - (top16 >> 4)};
    // Its maps take memory only as live pictures do: never a page's room.
    sweep->pixels_ = static_cast<size_t>(sweep->box_.w) * sweep->box_.h;
    const size_t bytes = sweep->pixels_ * 3;
    if (!memory::spare(bytes, KeyImage::bytes() * keygrid::COUNT) ||
        !(sweep->maps_ = static_cast<uint8_t *>(memory::psram(bytes)))) {
        delete sweep;
        return nullptr;
    }
    auto *angles = reinterpret_cast<uint16_t *>(sweep->maps_);
    uint8_t *covers = sweep->maps_ + sweep->pixels_ * 2;
    size_t k = 0;
    for (int j = 0; j < sweep->box_.h; ++j)
        for (int i = 0; i < sweep->box_.w; ++i, ++k) {
            const float dx = sweep->box_.x + i + 0.5f - sweep->cx_, dy = sweep->box_.y + j + 0.5f - sweep->cy_;
            float turns = atan2f(dx, -dy) / (2.f * PI);
            if (turns < 0.f) turns += 1.f;
            angles[k] = static_cast<uint16_t>(min<uint32_t>(TURN - 1, static_cast<uint32_t>(turns * TURN)));
            covers[k] = sweep->cover(fabsf(sqrtf(dx * dx + dy * dy) - sweep->r_));
        }
    return sweep;
}

Sweep *Sweep::clone() const {
    const size_t bytes = pixels_ * 3;
    if (!memory::spare(bytes, KeyImage::bytes() * keygrid::COUNT)) return nullptr;
    auto *maps = static_cast<uint8_t *>(memory::psram(bytes));
    if (!maps) return nullptr;
    Sweep *copy = new (std::nothrow) Sweep;
    if (!copy) {
        free(maps);
        return nullptr;
    }
    memcpy(maps, maps_, bytes);
    copy->box_ = box_;
    copy->cx_ = cx_, copy->cy_ = cy_, copy->r_ = r_, copy->half_ = half_, copy->reach_ = reach_;
    copy->color_ = color_;
    copy->alpha_ = alpha_;
    copy->glow_ = glow_;
    copy->motion_ = motion_;
    copy->still_ = still_;
    copy->zero_ = zero_;
    copy->turn_ = turn_;
    copy->clock_ = clock_;
    copy->at_ms_ = at_ms_;
    copy->step_ = step_;
    copy->maps_ = maps;
    copy->pixels_ = pixels_;
    return copy;
}

Sweep::~Sweep() { free(maps_); }

uint32_t Sweep::share_at(uint32_t now_ms) const {
    if (motion_ == STILL) return still_;
    const int64_t at = clock_ + static_cast<uint32_t>(now_ms - at_ms_);
    const double turns = static_cast<double>(at - zero_) / turn_;
    if (motion_ == ROUND) return min<uint32_t>(TURN - 1, static_cast<uint32_t>((turns - floor(turns)) * TURN));
    return turns <= 0 ? 0 : turns >= 1 ? TURN : static_cast<uint32_t>(turns * TURN + 0.5);
}

bool Sweep::due(uint32_t now_ms) const {
    const uint32_t share = share_at(now_ms);
    if (share == shown_) return false;
    // The first frame, and either end, always; else once the end has moved a
    // quarter of a pixel either way - round the top too, going round.
    if (shown_ == NOT_SHOWN || share == 0 || share >= TURN) return true;
    const uint32_t moved = share > shown_ ? share - shown_ : shown_ - share;
    return min(moved, TURN - moved) >= step_;
}

void Sweep::frame(uint32_t now_ms) {
    // The desktop's clock follows the deck's from here: kept close, so the
    // difference never runs past what 32 bits hold.
    clock_ += static_cast<uint32_t>(now_ms - at_ms_);
    at_ms_ = now_ms;
    share_ = shown_ = share_at(now_ms);
    const float angle = share_ * (2.f * PI / TURN);
    ex_ = cx_ + r_ * sinf(angle);
    ey_ = cy_ - r_ * cosf(angle);
}

void Sweep::paint(int y, uint16_t *row) const {
    if (!share_ || y < box_.y || y >= box_.y + box_.h) return;
    const auto *angles = reinterpret_cast<const uint16_t *>(maps_);
    const uint8_t *covers = maps_ + pixels_ * 2;
    const size_t first = static_cast<size_t>(y - box_.y) * box_.w;
    const bool whole = share_ >= TURN;
    // The round ends: at the top, where it starts, and where it has got to.
    const float py = y + 0.5f, sx = cx_, sy = cy_ - r_;
    const float near = squared(half_ + reach_ + 1.f);
    for (int i = 0; i < box_.w; ++i) {
        const size_t k = first + i;
        if (!covers[k]) continue;
        int a = covers[k];
        if (!whole && angles[k] > share_) {
            const float px = box_.x + i + 0.5f;
            const float to_start = squared(px - sx) + squared(py - sy), to_end = squared(px - ex_) + squared(py - ey_);
            a = 0;
            if (to_start < near) a = cover(sqrtf(to_start));
            if (to_end < near) a = max<int>(a, cover(sqrtf(to_end)));
            if (!a) continue;
        }
        uint16_t &pixel = row[box_.x + i];
        pixel = blend(pixel, color_, (a * (alpha_ + 1)) >> 8);
    }
}
