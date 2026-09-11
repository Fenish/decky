#pragma once
#include <stdint.h>

// What the deck knows of the desktop it serves, and of what it shows.
struct Session {
    // No command for this long and the desktop is taken to be gone.
    static constexpr uint32_t HOST_TIMEOUT_MS = 12000;
    // While Decky on the PC updates itself (UPDATING), the deck says so instead
    // of Disconnected, until the new version says HELLO or this passes.
    static constexpr uint32_t UPDATING_HOLD_MS = 180000;

    bool online = false;          // a desktop is connected
    bool warming = false;         // loading: pages and widgets come before one shows
    bool transitioning = false;   // a page is being replaced: no presses, no frames
    uint32_t last_heard_ms = 0;   // the desktop's last command
    uint32_t updating_until = 0;  // 0 unless Decky on the PC is updating itself
    // Loading progress, in the units HELLO announced: keys, ON pictures, widget
    // pictures and looks.
    int warm_total = 15;
    int warm_done = 0;
    int current_page = 0;         // the page shown (its index)
    uint16_t current_state = 0;   // its toggle keys switched on

    void heard(uint32_t now_ms) { last_heard_ms = now_ms; }
};
