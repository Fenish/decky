#pragma once
#include <limits.h>
#include <stdint.h>
#include "keys/look.h"

namespace keys {
// A picture no more often than this, however fast the loop comes round.
constexpr uint32_t FRAME_MS = 8;

// A key the deck animates by itself, armed with a look on one copy of a page.
// It moves on its own or under the finger, and draws itself into its own
// frame, which the screen copies once the beam is clear of the key. Only what
// it comes to rest on goes back to the desktop.
class KeyAnimation {
public:
    KeyAnimation(const Look &look, uint16_t *frame) : look_(&look), frame_(frame) {}
    virtual ~KeyAnimation() = default;
    KeyAnimation(const KeyAnimation &) = delete;
    KeyAnimation &operator=(const KeyAnimation &) = delete;

    const Look &look() const { return *look_; }
    // Another look of the same kind, taking over while it moves (a volume dial
    // unmuted by the very swipe turning it): the motion goes on.
    void relook(const Look &look) { look_ = &look; }
    // Under a finger, coasting, rolling: not at rest.
    virtual bool moving() const = 0;
    // Move on to `now`; true when a new picture is due.
    virtual bool tick(uint32_t now) = 0;
    // Draw it as it is now into its frame.
    virtual void compose() = 0;
    // A finger on it (y: its height inside the key), and the finger lifting.
    virtual void touch(int y, uint32_t now, bool landed) {}
    virtual void release(uint32_t now) {}
    // Sent to a label (a drum), or thrown (a die, which ignores the label).
    virtual void roll(int target, uint32_t now) {}
    // Set coasting as a flick at `rows_per_s` would (diagnostics; drums).
    virtual void spin(float rows_per_s, uint32_t now) {}
    // What it came to rest on, once, if the desktop does not know it yet: a
    // drum's label, or how a die lies. Otherwise -1.
    virtual int settled() { return -1; }
    // A dial's value while a finger turns it - at most every 40 ms, and at
    // once when the finger lifts. Otherwise INT_MIN.
    virtual int value(uint32_t now) { return INT_MIN; }

    // The copy of the page it is on, and when it was last drawn.
    int page = -1;
    uint32_t signature = 0;
    uint32_t composed_ms = 0;

protected:
    const Look *look_;
    uint16_t *frame_;
};
}  // namespace keys
