#include "input/touch.h"
#include <Arduino.h>
#include "keygrid.h"
#include "panel.h"

void Touch::poll(KeyListener &listener) {
    int x = 0, y = 0;
    const bool down = panel::touch_point(x, y);
    const uint32_t now = millis();
    listener.touched(x, y, down, now);
    if (down && !contact_down_) {
        contact_down_ = true;
        if (!listener.accepting_presses() || now - last_press_ms_ < PRESS_GAP_MS) return;
        const int cell = keygrid::hit(x, y);
        if (cell < 0) return;
        last_press_ms_ = now;
        pressed_cell_ = cell;
        listener.pressed(cell, y, now);
    } else if (down && pressed_cell_ >= 0) {
        listener.moved(pressed_cell_, y, now);
    } else if (!down && contact_down_) {
        contact_down_ = false;
        if (pressed_cell_ >= 0) listener.released(pressed_cell_, now);
        pressed_cell_ = -1;
    }
}
