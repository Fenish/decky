#pragma once
#include <stddef.h>
#include <stdint.h>
#include "keys/key_animation.h"
#include "keys/look.h"

namespace keys {
// The keys the deck animates by itself, at the screen's pace, and the looks
// they are drawn with. The desktop sends a look once (WHEEL) and arms keys
// with it; the deck then moves them - under the finger, coasting, rolling,
// thrown - and reports only what they come to rest on.
//
// Kinds: a drum (keys/drum), a dial (keys/dial), a die (keys/die).
class AnimatedKeys {
public:
    static constexpr int KEYS = 15;
    // The last LOOKS looks are kept, by CRC.
    static constexpr int LOOKS = 4;
    static constexpr size_t MAX_BYTES = 48 * 1024;

    // Keep a look, taking the buffer (PSRAM, freed here). False if malformed.
    bool load(uint8_t *data, size_t length, uint32_t crc);
    bool known(uint32_t crc) const { return find(crc) != nullptr; }
    // Show a kept look on a key of the page (id, signature) at a label. A key
    // already moving with a look of the same kind keeps moving with this one
    // and ignores the index.
    bool arm(int cell, int page, uint32_t signature, uint32_t crc, int index);
    void disarm(int cell);
    void disarm_all();
    bool armed(int cell, int page, uint32_t signature) const;
    // Draw a key's animation as it is now into its own frame, which frame()
    // hands out. Composing is kept apart from copying to the screen so the
    // copy alone has to fit between the beam's passes.
    void compose(int cell);
    const uint16_t *frame(int cell) const { return cell >= 0 && cell < KEYS ? frames_[cell] : nullptr; }
    // A finger on an armed key: y is its height inside the key.
    void touch(int cell, int y, uint32_t now, bool landed);
    void release(int cell, uint32_t now);
    // Move animations on. Returns the keys whose picture is due.
    uint16_t tick(uint32_t now);
    // What a key came to rest on (a drum's label, how a die lies), once, if
    // it differs from what was last reported; else -1.
    int settled(int cell);
    // A dial's value while a finger turns it - at most every 40 ms, and at
    // once when the finger lifts - else INT_MIN.
    int value(int cell, uint32_t now);
    // Spin a drum to a label, as a flick would and landing on it; or throw a
    // die (target unused), which lands however it lands.
    void roll(int cell, int target, uint32_t now);
    // Start a drum coasting as if flicked at rows_per_s (diagnostics).
    void spin(int cell, float rows_per_s, uint32_t now);

    // For DISPLAY_STATE: the last frame composed (us), frames since boot, and
    // a die's last frame in parts.
    uint32_t compose_us() const { return last_compose_; }
    uint32_t frames() const { return composed_frames_; }

private:
    Look *find(uint32_t crc) const;
    // A look goes, and every key armed with it.
    void drop(int slot);
    KeyAnimation *at(int cell) const { return cell >= 0 && cell < KEYS ? keys_[cell] : nullptr; }

    Look *looks_[LOOKS] = {};
    KeyAnimation *keys_[KEYS] = {};
    uint16_t *frames_[KEYS] = {};  // kept while a key is armed, whatever its kind
    uint32_t used_counter_ = 0;
    uint32_t last_compose_ = 0;
    uint32_t composed_frames_ = 0;
};
}  // namespace keys
