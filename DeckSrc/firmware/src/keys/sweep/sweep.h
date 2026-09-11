#pragma once
#include <stddef.h>
#include <stdint.h>
#include "keys/overlay.h"

// A ring's arc the deck moves by itself: OBS's 5-second countdown, so far.
// The desktop draws the ring's track into the key's picture and
// sends the arc once - where the ring is, its colour and glow, and how its end
// moves with the clock - and the deck draws it at the panel's pace: from the
// top, clockwise, with round ends, as the desktop's canvas strokes it. The
// digits under it go on changing (LIVE) without it starting over.
//
// The arc (SWEEP command) is laid out as src/shared/sweep-spec.ts writes it.
// Its motion is in the desktop's clock, which SWEEP's line gives as it is sent.
class Sweep : public KeyOverlay {
public:
    static constexpr size_t BYTES = 32;

    // An arc from its payload, which it frees; `clock` is the desktop's time
    // (ms since 1970) as SWEEP was sent. Null if it is malformed, does not fit
    // inside the key, or there is no memory for it.
    static Sweep *load(uint8_t *data, size_t length, uint32_t now_ms, int64_t clock);
    Sweep *clone() const override;
    ~Sweep() override;

    bool due(uint32_t now_ms) const override;
    void frame(uint32_t now_ms) override;
    void paint(int y, uint16_t *row) const override;

private:
    // How its end moves: held still, running once to a whole turn (or back
    // to none) and stopping, or running round and round.
    enum Motion : uint8_t { STILL, ONCE, ROUND };
    // A whole turn, in the fixed-point shares its angles and frames use.
    static constexpr uint32_t TURN = 65536;
    static constexpr uint32_t NOT_SHOWN = UINT32_MAX;

    Sweep() = default;
    // Its end at `now`, as a share of a turn from the top: 0 to TURN.
    uint32_t share_at(uint32_t now_ms) const;
    // The colour a pixel takes (0-255) at `distance` px from the arc's middle
    // line: the stroke, antialiased, and its glow beyond.
    uint8_t cover(float distance) const;

    float cx_ = 0, cy_ = 0, r_ = 0, half_ = 0, reach_ = 0;
    uint16_t color_ = 0;
    uint8_t alpha_ = 255;  // the stroke's opacity, and its glow's
    uint8_t glow_ = 0;
    Motion motion_ = STILL;
    uint32_t still_ = 0;   // the share it is held at, STILL
    int64_t zero_ = 0;     // when the share was none, in the desktop's clock
    int32_t turn_ = 1;     // ms a turn takes; below 0 it runs back
    int64_t clock_ = 0;    // the desktop's clock at at_ms_
    uint32_t at_ms_ = 0;
    uint32_t step_ = 1;    // the share that moves its end a quarter of a pixel
    // Per pixel of the box, row by row: the angle from the top, clockwise (of
    // TURN), and the colour the whole ring would give it. One buffer, PSRAM.
    uint8_t *maps_ = nullptr;
    size_t pixels_ = 0;
    // This frame: the end's share, and its round end's middle.
    uint32_t share_ = 0;
    float ex_ = 0, ey_ = 0;
    uint32_t shown_ = NOT_SHOWN;
};
