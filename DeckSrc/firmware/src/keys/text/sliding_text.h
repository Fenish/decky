#pragma once
#include <stddef.h>
#include <stdint.h>
#include "keys/overlay.h"

// Text too long for its key, slid along by the deck: a song's title, say. The
// desktop draws each line once in its own font, as coverage, and the deck lays
// it in one colour over the key's picture, inside the line's window. A line
// rests at its start, slides left at a steady pace with its start following
// after a gap, and rests again: a loop. The picture under it can change (LIVE)
// without the text starting over; new text starts over.
//
// The text (SLIDE command) is laid out as src/shared/slide-spec.ts writes it.
class SlidingText : public KeyOverlay {
public:
    static constexpr size_t MAX_BYTES = 48 * 1024;

    // A key's text, taking the buffer (PSRAM; freed with the text, or here when
    // it is malformed). Null if it is malformed.
    static SlidingText *load(uint8_t *data, size_t length, uint32_t now_ms);
    SlidingText *clone() const override;
    ~SlidingText() override;

    bool due(uint32_t now_ms) const override;
    void frame(uint32_t now_ms) override;
    void paint(int y, uint16_t *row) const override;

private:
    static constexpr int MAX_LINES = 2;
    struct Line {
        int x = 0, y = 0, w = 0, h = 0;  // its window, in key pixels
        int strip = 0;                   // the text's width: more than the window's
        uint16_t color = 0;              // RGB565
        const uint8_t *alpha = nullptr;  // coverage, strip x h, row by row
        int offset = 0;                  // how far it has slid, this frame
        int shown = -1;                  // and the last frame drawn
    };
    SlidingText() = default;
    // Pixels a line has slid at `now`: none while it rests, then steadily on
    // to one lap (its width and the gap), where it looks as it did at rest.
    int offset_at(const Line &line, uint32_t now_ms) const;

    uint8_t *data_ = nullptr;
    size_t length_ = 0;
    uint32_t start_ = 0;
    int pause_ = 0, speed_ = 1, gap_ = 0, fade_ = 0;
    int count_ = 0;
    Line lines_[MAX_LINES];
};
