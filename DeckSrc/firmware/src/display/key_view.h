#pragma once
#include <stdint.h>
#include "deck/session.h"
#include "deck/status_screen.h"
#include "display/screen.h"
#include "keys/animated_keys.h"
#include "pages/page_cache.h"

// The keys of the page shown, on the screen. A key shows, in order of
// precedence: the deck's own animation of it (a drum, dial or die), its ON
// picture when switched on, its live picture, its own picture; with its
// overlays over that (sliding text, a ring's arc), and a white outline while
// pressed.
class KeyView {
public:
    KeyView(Screen &screen, PageCache &pages, keys::AnimatedKeys &animations, const Session &session,
            const StatusScreen &status)
        : screen_(screen), pages_(pages), animations_(animations), session_(session), status_(status) {}

    // Write a key into the framebuffer at once; callers wait for the beam.
    void write_key(int cell, bool pressed);
    // Write a key once the beam is clear of it.
    void draw_key(int cell, bool pressed);
    // Every key, each the moment its rows are clear of the scanout.
    void draw_page();
    // Overlays that have moved: just the rows they cover, once the beam is
    // clear of them, so this never waits.
    void overlay_frames();
    // The last full page redraw (us), for DISPLAY_STATE.
    uint32_t page_draw_us() const { return page_draw_us_; }
    // Overlay frames drawn since start, and the last one's time (us), for DISPLAY_STATE.
    uint32_t overlays_drawn() const { return overlays_drawn_; }
    uint32_t overlay_us() const { return overlay_us_; }
    // The longest the deck went without looking at overlays (us) since last
    // asked: how long anything moving was held still. Asking starts it again.
    uint32_t take_longest_gap_us() {
        const uint32_t gap = longest_gap_us_;
        longest_gap_us_ = 0;
        return gap;
    }

private:
    // A key's overlays as they are now, over `source`, onto the screen.
    void write_overlays(int cell, const uint16_t *source);

    Screen &screen_;
    PageCache &pages_;
    keys::AnimatedKeys &animations_;
    const Session &session_;
    const StatusScreen &status_;
    uint32_t page_draw_us_ = 0;
    uint32_t overlays_drawn_ = 0, overlay_us_ = 0;
    uint32_t looked_us_ = 0, longest_gap_us_ = 0;
};
