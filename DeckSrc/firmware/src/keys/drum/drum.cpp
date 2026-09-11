#pragma GCC optimize("O2", "fast-math")
#include "keys/drum/drum.h"
#include <Arduino.h>
#include <math.h>
#include <new>
#include "common/key_image.h"

namespace keys {
namespace {
// Coasting slower than this, in labels a second, the wheel springs onto the
// nearest label instead of gliding on.
constexpr float SNAP_SPEED = 4.0f;
// At rest: within this many labels of one, moving slower than REST_SPEED.
constexpr float REST_OFFSET = 0.004f, REST_SPEED = 0.05f;
// The flick is the finger's last SAMPLE_MS; samples are taken SAMPLE_GAP_MS
// apart, and a finger still for LIFT_MS before it lifted did not flick.
constexpr uint32_t SAMPLE_MS = 80, SAMPLE_GAP_MS = 10, LIFT_MS = 50;
}  // namespace

bool DrumLook::read(ByteReader &r) {
    const int H = KeyImage::height();
    sizes = r.u8();
    count = r.u16();
    row = r.u16();
    center = r.u16();
    clip_top = r.u16();
    clip_bottom = r.u16();
    color = r.u16();
    angle = r.u16() / 1000.f;
    fade = r.u8() / 100.f;
    rubber = r.u8() / 100.f;
    fling = r.u16() / 1000.f;
    snap = r.u16() / 100.f;
    max_speed = r.u16() / 10.f;
    if (!r.ok || sizes < 1 || sizes > MAX_SIZES || count < 1 || count > MAX_LABELS || row < 4 || row > H ||
        center >= H || clip_top >= clip_bottom || clip_bottom > H || angle < 0.05f || angle > 1.2f || fade > 1.f ||
        rubber > 1.f || fling <= 0 || snap <= 0 || max_speed <= 0)
        return false;
    memset(backdrop_, 0, KeyImage::bytes());
    if (!picture(r, backdrop_)) return false;
    for (int s = 0; s < sizes; ++s)
        if (!size[s].read(r)) return false;
    for (int i = 0; i < count; ++i) {
        Label &label = labels[i];
        label.size = r.u8();
        label.length = r.u8();
        const uint8_t *text = r.take(label.length);
        if (!r.ok || label.size >= sizes || !label.length || label.length > MAX_TEXT) return false;
        label.width = 0;
        for (int c = 0; c < label.length; ++c) {
            const int glyph = size[label.size].index_of(text[c]);
            if (glyph < 0) return false;
            label.glyphs[c] = glyph;
            label.width += size[label.size].widths[glyph];
        }
    }
    return r.ok && r.at == r.length;
}

KeyAnimation *DrumLook::animate(int index, uint16_t *frame) const {
    return new (std::nothrow) Drum(*this, index, frame);
}

Drum::Drum(const DrumLook &look, int index, uint16_t *frame) : KeyAnimation(look, frame), pos_(index), index_(index) {}

void Drum::spring(float speed, uint32_t now) {
    const DrumLook &look = drum();
    int target = forced_ >= 0 ? forced_ : lroundf(pos_ + speed / look.snap);
    target = constrain(target, 0, look.count - 1);
    target_ = target;
    a_ = pos_ - target;
    b_ = speed + look.snap * a_;
    since_ = now;
    mode_ = SPRING;
}

void Drum::coast(float speed, uint32_t now) {
    const DrumLook &look = drum();
    speed = constrain(speed, -look.max_speed, look.max_speed);
    if (fabsf(speed) < SNAP_SPEED || pos_ < 0 || pos_ > look.count - 1) {
        spring(speed, now);
        return;
    }
    x0_ = pos_;
    v0_ = speed;
    since_ = now;
    mode_ = GLIDE;
}

bool Drum::tick(uint32_t now) {
    const DrumLook &look = drum();
    if (mode_ == GLIDE) {
        const float t = (now - since_) / 1000.f, decay = expf(-t / look.fling);
        pos_ = x0_ + v0_ * look.fling * (1.f - decay);
        const float speed = v0_ * decay;
        if (fabsf(speed) < SNAP_SPEED || pos_ < 0 || pos_ > look.count - 1) spring(speed, now);
    } else if (mode_ == SPRING) {
        const float t = (now - since_) / 1000.f, decay = expf(-look.snap * t);
        const float offset = (a_ + b_ * t) * decay;
        const float speed = (b_ - look.snap * (a_ + b_ * t)) * decay;
        if (fabsf(offset) < REST_OFFSET && fabsf(speed) < REST_SPEED) {
            pos_ = target_;
            mode_ = REST;
            forced_ = -1;
            if (target_ != index_) {
                index_ = target_;
                report_ = true;
            }
        } else pos_ = target_ + offset;
    }
    // A new picture once the numbers moved a quarter of a pixel.
    return fabsf(pos_ - drawn_) * look.row >= 0.25f && now - composed_ms >= FRAME_MS;
}

// Label i, d labels from the band, is angle * d round the drum - its middle at
// center + r sin, its height squashed by cos, and faded by cos squared and by
// how far from the band. The desktop's preview uses the same sums (drumRow in
// src/shared/wheel-spec.ts).
void Drum::compose() {
    const DrumLook &look = drum();
    memcpy(frame_, look.backdrop(), KeyImage::bytes());
    const float radius = look.row / look.angle;
    const int first = max(0, static_cast<int>(floorf(pos_)) - 3);
    const int last = min(look.count - 1, static_cast<int>(floorf(pos_)) + 4);
    for (int i = first; i <= last; ++i) {
        const float d = i - pos_, theta = d * look.angle;
        if (fabsf(theta) >= 1.45f) continue;
        const float squash = cosf(theta);
        const float fade = squash * squash * (1.f - look.fade * fminf(1.f, fabsf(d)));
        const int strength = static_cast<int>(fade * 256.f);
        if (strength <= 0) continue;
        const DrumLook::Label &label = look.labels[i];
        draw_text(frame_, look.size[label.size], label.glyphs, label.length, label.width,
                  look.center + radius * sinf(theta), squash, strength, look.color, look.clip_top, look.clip_bottom);
    }
    drawn_ = pos_;
}

void Drum::touch(int y, uint32_t now, bool landed) {
    const DrumLook &look = drum();
    if (landed) {
        mode_ = DRAG;
        grab_y_ = y;
        grab_pos_ = pos_;
        samples_ = 0;
        forced_ = -1;
    }
    if (mode_ != DRAG) return;
    // Up is more: the numbers follow the finger, one label per row of pixels.
    const float raw = grab_pos_ + static_cast<float>(grab_y_ - y) / look.row;
    const float last = look.count - 1;
    pos_ = raw < 0 ? raw * look.rubber : raw > last ? last + (raw - last) * look.rubber : raw;
    if (samples_ && now - sample_t_[0] < SAMPLE_GAP_MS) return;
    for (int i = SAMPLES - 1; i > 0; --i) {
        sample_t_[i] = sample_t_[i - 1];
        sample_p_[i] = sample_p_[i - 1];
    }
    sample_t_[0] = now;
    sample_p_[0] = pos_;
    if (samples_ < SAMPLES) ++samples_;
}

void Drum::release(uint32_t now) {
    if (mode_ != DRAG) return;
    float speed = 0;
    if (samples_ >= 2 && now - sample_t_[0] < LIFT_MS) {
        int oldest = 0;
        for (int i = 1; i < samples_; ++i)
            if (now - sample_t_[i] <= SAMPLE_MS) oldest = i;
        const uint32_t span = sample_t_[0] - sample_t_[oldest];
        if (span >= SAMPLE_GAP_MS) speed = (sample_p_[0] - sample_p_[oldest]) * 1000.f / span;
    }
    coast(speed, now);
}

void Drum::roll(int target, uint32_t now) {
    const DrumLook &look = drum();
    forced_ = constrain(target, 0, look.count - 1);
    // The glide alone would carry it fling * speed labels: aim it at the label,
    // and the spring lands it there.
    x0_ = pos_;
    v0_ = constrain((forced_ - pos_) / look.fling, -look.max_speed, look.max_speed);
    since_ = now;
    mode_ = fabsf(v0_) < SNAP_SPEED ? SPRING : GLIDE;
    if (mode_ == SPRING) spring(0, now);
}

void Drum::spin(float rows_per_s, uint32_t now) { coast(rows_per_s, now); }

int Drum::settled() {
    if (!report_) return -1;
    report_ = false;
    return index_;
}
}  // namespace keys
