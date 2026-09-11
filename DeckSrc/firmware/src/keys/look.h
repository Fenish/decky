#pragma once
#include <stddef.h>
#include <stdint.h>
#include "common/byte_reader.h"

namespace keys {
class KeyAnimation;
enum class Kind : uint8_t { Drum = 1, Dial = 2, Die = 3 };

// How a key the deck animates by itself looks (the WHEEL command), as
// src/shared/wheel-spec.ts writes it: all the deck needs to draw and move it.
// A look holds nothing about what is showing - that comes with WHEEL and
// WHEELAT - so looks are kept by CRC and arming one again costs a line.
//
// Each kind is a subclass: DrumLook, DialLook, DieLook. A new kind of key is
// a new subclass, with its KeyAnimation, and a version byte in parse().
class Look {
public:
    // The look in `data` (a PSRAM buffer, taken: freed with the look, or here
    // when it is malformed). Null if it is malformed.
    static Look *parse(uint8_t *data, size_t length);
    virtual ~Look();
    Look(const Look &) = delete;
    Look &operator=(const Look &) = delete;

    virtual Kind kind() const = 0;
    // Whether a key can be armed with it at `index`: a drum's label, a dial's
    // value, a die's pose.
    virtual bool accepts(int index) const = 0;
    // A key animated with it, resting at `index`, drawing into `frame`.
    virtual KeyAnimation *animate(int index, uint16_t *frame) const = 0;
    // The key under what moves; a dial at its lowest.
    const uint16_t *backdrop() const { return backdrop_; }

    uint32_t crc = 0;
    uint32_t used = 0;  // when it was last armed: the least used goes first

protected:
    Look() = default;
    // The look's fields, after its version byte.
    virtual bool read(ByteReader &r) = 0;
    // A LIVE patch from the look, applied to `into` once checked in full.
    static bool picture(ByteReader &r, uint16_t *into);

    uint8_t *data_ = nullptr;       // as sent: glyph coverage points into it
    uint16_t *backdrop_ = nullptr;
};
}  // namespace keys
