#pragma once
#include <stdint.h>
#include "keygrid.h"

// Writes to the panel only where the scanout is not. The picture is scanned
// out of PSRAM continuously, from one framebuffer; a region is written when
// the beam is far enough above it for the write to finish first, or already
// past it with enough of the frame left before it comes round again.
class Screen {
public:
    // Where the beam is, against the panel's VSYNC, checked every 200 ms.
    void resync();
    // Whether `rect` can be written now without tearing.
    bool clear(const keygrid::Rect &rect);
    // Wait until it can - two frames at most.
    void wait(const keygrid::Rect &rect);
    // A key was written in `elapsed_us`: the estimate `clear` plans with.
    void wrote(uint32_t elapsed_us);

private:
    uint32_t vsync_ref_us_ = 0;
    uint32_t vsync_at_ = 0;
    uint32_t write_estimate_us_ = 2000;
};
