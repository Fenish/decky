#pragma once
#include <stdint.h>

// Something the deck draws over a key's picture by itself, moving at the
// panel's pace while LIVE pictures change underneath: sliding text (SLIDE) and
// a ring's sweeping arc (SWEEP). It belongs to the deck's copy of a page and
// goes with the key's live picture; a new version of the page carries a clone.
class KeyOverlay {
public:
    // The kinds a key can have one of each of, drawn in this order.
    enum Kind { TEXT, SWEEP, KINDS };
    // The part of the key an overlay covers, in key pixels.
    struct Box {
        int x, y, w, h;
    };

    virtual ~KeyOverlay() = default;
    // The same overlay for another copy of the page, going on from where it
    // is. Null without memory for it.
    virtual KeyOverlay *clone() const = 0;
    const Box &box() const { return box_; }
    // Whether it moved since it was last drawn.
    virtual bool due(uint32_t now_ms) const = 0;
    // Fix where it is for the frame about to be drawn.
    virtual void frame(uint32_t now_ms) = 0;
    // Lay it over one row of the key (y, in key pixels), in place: `row` is
    // the key's whole row, as the frame shows it so far.
    virtual void paint(int y, uint16_t *row) const = 0;

    KeyOverlay(const KeyOverlay &) = delete;
    KeyOverlay &operator=(const KeyOverlay &) = delete;

protected:
    KeyOverlay() = default;
    Box box_{};
};
