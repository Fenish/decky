#pragma once
#include "display/screen.h"

// The deck's own screen, between pages: every key black, and in the centre
// key the white Decky logo with a label ("Disconnected", "Updating Decky"), a
// progress bar (loading), or both.
class StatusScreen {
public:
    explicit StatusScreen(Screen &screen) : screen_(screen) {}
    // percent < 0: no bar. The keys go black the first time.
    void show(int percent, const char *label = nullptr);
    bool shown() const { return shown_; }
    // A page is drawn over it.
    void hide() { shown_ = false; }

private:
    Screen &screen_;
    bool shown_ = false;
};
