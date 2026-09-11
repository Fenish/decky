#include "deck/status_screen.h"
#include <Arduino.h>
#include "deck/decky_logo.h"
#include "keygrid.h"
#include "panel.h"

void StatusScreen::show(int percent, const char *label) {
    if (!shown_) {
        for (int i = 0; i < keygrid::COUNT; ++i) {
            const auto r = keygrid::cell(i);
            screen_.wait(r);
            panel::display.fillRect(r.x, r.y, r.w, r.h, 0);
        }
        shown_ = true;
    }
    const auto rect = keygrid::cell(keygrid::COUNT / 2);
    screen_.wait(rect);
    panel::display.fillRect(rect.x, rect.y, rect.w, rect.h, 0);
    const int left = rect.x + (rect.w - DECKY_LOGO_SIZE) / 2, top = rect.y + 8;
    uint16_t *frame = panel::framebuffer();
    for (int y = 0; y < DECKY_LOGO_SIZE; ++y)
        for (int x = 0; x < DECKY_LOGO_SIZE; ++x) {
            const uint8_t a = pgm_read_byte(DECKY_LOGO_ALPHA + y * DECKY_LOGO_SIZE + x);
            frame[(top + y) * panel::WIDTH + left + x] = panel::display.color565(a, a, a);
        }
    const bool bar = percent >= 0;
    if (label) {
        panel::display.setFont(&fonts::Font0);
        panel::display.setTextSize(1);
        panel::display.setTextColor(0xBDF7);
        panel::display.setTextDatum(textdatum_t::middle_center);
        panel::display.drawString(label, rect.x + rect.w / 2, rect.y + rect.h - (bar ? 29 : 15));
    }
    // LovyanGFX stores these colours byte-swapped against the framebuffer's
    // order (the order the desktop's key images use), so the dark grey 0x2945
    // track is passed as 0x4529; passed plainly it showed green.
    if (bar) {
        const int width = rect.w - 28;
        panel::display.fillRoundRect(rect.x + 14, rect.y + rect.h - 18, width, 5, 2, 0x4529);
        const int fill = width * constrain(percent, 0, 100) / 100;
        if (fill > 0) panel::display.fillRoundRect(rect.x + 14, rect.y + rect.h - 18, fill, 5, 2, 0xFFFF);
    }
}
