#pragma once
#include "keys/glyphs.h"
#include "keys/key_animation.h"
#include "keys/look.h"

namespace keys {
// A dial (the volume, as an arc or a bar): the key at its lowest and at its
// highest, and where each pixel fills. It follows the finger, and its value
// goes back as it turns. Look version 2:
//   u16 min, u16 max, u16 finger pixels a step (x10), u16 the number's middle
//   (y), u16 its colour (RGB565), u8 1 if it writes its number, the key at its
//   lowest (a LIVE patch of the whole key), the key at its highest (a patch
//   over the lowest), the fill map as runs of (u8 count 1-255, u8 share), and
//   if it writes its number, one font size holding 0-9.
class DialLook : public Look {
public:
    ~DialLook() override;
    Kind kind() const override { return Kind::Dial; }
    bool accepts(int index) const override { return index >= min && index <= max; }
    KeyAnimation *animate(int index, uint16_t *frame) const override;

    int min = 0, max = 0, text_y = 0;
    bool number = true;
    float unit_px = 1;  // finger pixels a step
    uint16_t color = 0;
    uint16_t *fill = nullptr;  // the key at its highest
    uint8_t *map = nullptr;    // per pixel, the share (1-254) from which it fills; 255 never
    GlyphSet digits;

protected:
    bool read(ByteReader &r) override;
};

class Dial : public KeyAnimation {
public:
    Dial(const DialLook &look, int index, uint16_t *frame);
    bool moving() const override { return mode_ != REST; }
    bool tick(uint32_t now) override;
    void compose() override;
    void touch(int y, uint32_t now, bool landed) override;
    void release(uint32_t now) override;
    int value(uint32_t now) override;

private:
    enum Mode : uint8_t { REST, DRAG };
    const DialLook &dial() const { return static_cast<const DialLook &>(*look_); }

    Mode mode_ = REST;
    float pos_ = 0;        // its value
    float drawn_ = -1e9f;  // pos when last drawn
    int index_ = 0;        // the value the desktop knows
    bool report_ = false;
    uint32_t reported_ms_ = 0;
    int grab_y_ = 0;
    float grab_pos_ = 0;
};
}  // namespace keys
