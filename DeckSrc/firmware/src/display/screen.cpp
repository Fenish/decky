#include "display/screen.h"
#include <Arduino.h>
#include "panel.h"

namespace {
constexpr uint32_t WRITE_ESTIMATE_FLOOR_US = 1000;
}  // namespace

// The panel's interrupt stamps every vertical sync, so this never waits: it
// once waited for the next sync every 200 ms, holding the loop up to a frame
// five times a second - a hitch in anything moving. Before the first stamp it
// waits once.
void Screen::resync() {
    const uint32_t stamped = panel::last_vsync_us();
    if (stamped) {
        vsync_ref_us_ = stamped;
        vsync_at_ = millis();
        return;
    }
    if (millis() - vsync_at_ < 200 && vsync_at_) return;
    if (panel::wait_vsync()) {
        vsync_ref_us_ = micros();
        vsync_at_ = millis();
    }
}

bool Screen::clear(const keygrid::Rect &rect) {
    resync();
    const uint32_t period = panel::frame_period_us();
    const uint32_t phase = (micros() - vsync_ref_us_) % period;
    const int beam = static_cast<int>(static_cast<float>(phase) / period * panel::V_TOTAL) - panel::VSYNC_PULSE_WIDTH -
                     panel::VSYNC_BACK_PORCH;
    const int advance = static_cast<int>(static_cast<float>(write_estimate_us_) / period * panel::V_TOTAL);
    return beam + advance < rect.y || (beam > rect.y + rect.h && panel::V_TOTAL - beam + rect.y > advance);
}

void Screen::wait(const keygrid::Rect &rect) {
    const uint32_t deadline = micros() + panel::frame_period_us() * 2;
    while (!clear(rect) && static_cast<int32_t>(deadline - micros()) > 0) {
    }
}

// Pessimistic, as tear-free writes need: twice the write, up at once after a
// slow one. It eases back down, or one slow write under PSRAM contention would
// narrow every later window for good.
void Screen::wrote(uint32_t elapsed_us) {
    const uint32_t sample = elapsed_us * 2;
    if (sample > write_estimate_us_) write_estimate_us_ = sample;
    else
        write_estimate_us_ =
            max<uint32_t>(WRITE_ESTIMATE_FLOOR_US, write_estimate_us_ - (write_estimate_us_ - sample) / 16);
}
