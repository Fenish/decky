#pragma once
#include <stdint.h>

// What a finger does to keys, for whoever owns the keys (the Deck).
class KeyListener {
public:
    virtual ~KeyListener() = default;
    // Whether a finger landing now presses a key at all.
    virtual bool accepting_presses() = 0;
    // Where the finger is on the panel, whatever it is over, before any of
    // this is read as a key. Only something that has taken the whole screen
    // (a game) wants it; everything else leaves it alone.
    virtual void touched(int x, int y, bool down, uint32_t now) { (void)x, (void)y, (void)down, (void)now; }
    // A finger landed on `cell`, moved while on it, or lifted. `y` is its
    // height on the screen.
    virtual void pressed(int cell, int y, uint32_t now) = 0;
    virtual void moved(int cell, int y, uint32_t now) = 0;
    virtual void released(int cell, uint32_t now) = 0;
};

// The GT911 read into key presses: one finger, one key. A key is pressed when
// a finger lands on it, and stays pressed until the finger lifts, wherever it
// moves meanwhile; presses closer together than PRESS_GAP_MS are one bounce.
class Touch {
public:
    static constexpr uint32_t PRESS_GAP_MS = 120;
    void poll(KeyListener &listener);
    // The key a finger holds down, or -1.
    int pressed_cell() const { return pressed_cell_; }
    // The desktop went: whatever was pressed is forgotten.
    void forget() { pressed_cell_ = -1; }

private:
    bool contact_down_ = false;
    int pressed_cell_ = -1;
    uint32_t last_press_ms_ = 0;
};
