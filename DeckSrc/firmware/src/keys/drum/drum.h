#pragma once
#include "keys/glyphs.h"
#include "keys/key_animation.h"
#include "keys/look.h"

namespace keys {
// A drum (a picker wheel: an adjustable countdown's times, a list, a coin's
// sides): labels on a drum turning about the key's width. It follows the
// finger 1:1, lets a flick coast, and springs onto a label; a roll spins it
// to a label the desktop picked. Look version 1:
//   u8 font sizes, u16 labels, u16 row, u16 center, u16 clip top,
//   u16 clip bottom (pixels in the key), u16 colour (RGB565), u16 angle
//   (mrad a label), u8 fade (%), u8 rubber (%), u16 fling (ms), u16 snap
//   (1/100 per s), u16 max speed (1/10 labels a s), the backdrop (a LIVE
//   patch of the whole key), each font size's glyphs, then per label u8 font
//   size, u8 length and its characters.
class DrumLook : public Look {
public:
    static constexpr int MAX_LABELS = 200, MAX_SIZES = 2, MAX_TEXT = 16;
    struct Label {
        uint8_t size = 0, length = 0;
        uint8_t glyphs[MAX_TEXT] = {};
        uint16_t width = 0;
    };

    Kind kind() const override { return Kind::Drum; }
    bool accepts(int index) const override { return index >= 0 && index <= count - 1; }
    KeyAnimation *animate(int index, uint16_t *frame) const override;

    int sizes = 0;
    GlyphSet size[MAX_SIZES];
    // Its labels, their spacing (row) and where the band's middle is (center),
    // the rows it draws on, and its colour.
    int count = 0, row = 0, center = 0, clip_top = 0, clip_bottom = 0;
    uint16_t color = 0;
    // How it moves: radians between labels, how much a label one away fades,
    // how far past its ends it follows a finger (0-1), seconds for a flick's
    // speed to fall to 1/e, the spring onto a label (per second), and labels a
    // second at most.
    float angle = 0, fade = 0, rubber = 0, fling = 0, snap = 0, max_speed = 0;
    Label labels[MAX_LABELS];

protected:
    bool read(ByteReader &r) override;
};

class Drum : public KeyAnimation {
public:
    Drum(const DrumLook &look, int index, uint16_t *frame);
    bool moving() const override { return mode_ != REST; }
    bool tick(uint32_t now) override;
    void compose() override;
    void touch(int y, uint32_t now, bool landed) override;
    void release(uint32_t now) override;
    void roll(int target, uint32_t now) override;
    void spin(float rows_per_s, uint32_t now) override;
    int settled() override;

private:
    enum Mode : uint8_t { REST, DRAG, GLIDE, SPRING };
    static constexpr int SAMPLES = 8;
    const DrumLook &drum() const { return static_cast<const DrumLook &>(*look_); }
    // Onto a label: near where a spring let go at `speed` would carry it, or
    // where a roll was sent.
    void spring(float speed, uint32_t now);
    // Gliding on at `speed`, or springing onto a label when that is slow.
    void coast(float speed, uint32_t now);

    Mode mode_ = REST;
    float pos_ = 0;      // the label at the band
    float drawn_ = -1e9f;  // pos when last drawn
    int index_ = 0;      // the label the desktop knows
    bool report_ = false;
    int grab_y_ = 0;
    float grab_pos_ = 0;
    uint32_t sample_t_[SAMPLES] = {};
    float sample_p_[SAMPLES] = {};
    int samples_ = 0;
    // GLIDE: pos = x0 + v0 * fling * (1 - e^(-t / fling)).
    // SPRING: pos = target + (a + b t) e^(-snap t), critically damped.
    uint32_t since_ = 0;
    float x0_ = 0, v0_ = 0, a_ = 0, b_ = 0;
    int target_ = 0;
    int forced_ = -1;  // a roll's label, which the spring lands on
};
}  // namespace keys
