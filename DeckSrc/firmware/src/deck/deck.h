#pragma once
#include <stdint.h>
#include "deck/session.h"
#include "deck/session_commands.h"
#include "deck/status_screen.h"
#include "display/key_view.h"
#include "game/snake.h"
#include "display/screen.h"
#include "input/drag.h"
#include "input/touch.h"
#include "keys/animated_keys.h"
#include "keys/key_commands.h"
#include "pages/page_cache.h"
#include "pages/page_commands.h"
#include "protocol/command_router.h"
#include "protocol/transfer.h"

// The deck: it draws the pages the desktop sends, animates the keys it can
// animate by itself, and reports touches as key presses - over USB, or over
// encrypted Wi-Fi. One Deck owns every part; main.cpp makes it and runs it.
//
//   pages/     the copies of pages it holds, and their commands
//   keys/      keys it animates itself (drums, dials, dice, sliding text)
//   display/   drawing keys onto the screen without tearing
//   input/     the finger: presses, holds, drags
//   game/      snake, when someone finds it
//   protocol/  commands in, uploads, the identity reply
//   deck/      this, the session, the status screen and session commands
class Deck : public KeyListener, public TransferIdle {
public:
    Deck();
    // Serial, the panel, the card and Wi-Fi; then the deck waits, Disconnected,
    // for a desktop.
    void begin();
    // One pass: the desktop's commands, the desktop's silence, the finger, and
    // animation frames as they fall due.
    void loop();
    // One line from the desktop.
    void command(const char *line);

    // The parts, for the command sets.
    Session &session() { return session_; }
    PageCache &pages() { return pages_; }
    keys::AnimatedKeys &animations() { return animations_; }
    KeyView &view() { return view_; }
    StatusScreen &status() { return status_; }
    Transfer &transfer() { return transfer_; }
    Touch &touch() { return touch_; }
    game::Snake &game() { return game_; }
    DragReport &drag() { return drag_; }

    // Show `page` from now on, its toggles off, loading over (drawing is the
    // caller's).
    void activate(Page &page);
    // Loading progress on the status screen, while loading.
    void warm_progress();
    // The desktop went (BYE, or silent for HOST_TIMEOUT_MS): what it sent for
    // the session goes, and the deck says Disconnected.
    void disconnected();

    /** The easter egg takes the panel; the page comes back when it ends. */
    void start_game();

    // Whether a key drawn now would be seen: nothing else has the panel. A
    // command that arrives while something does (loading, a page change, the
    // game) still takes what it was sent - it just draws nothing, and the page
    // is drawn whole when the panel comes back.
    bool panel_free() const {
        return !status_.shown() && !session_.transitioning && !game_.running();
    }

    // KeyListener
    bool accepting_presses() override;
    void touched(int x, int y, bool down, uint32_t now) override;
    void pressed(int cell, int y, uint32_t now) override;
    void moved(int cell, int y, uint32_t now) override;
    void released(int cell, uint32_t now) override;
    // TransferIdle: touch and animations go on between an upload's blocks.
    void between_blocks() override;

private:
    // Animations on the page shown: what they came to rest on goes to the
    // desktop, and a picture for each whose frame is due, copied only once the
    // beam is clear of the key, so this never waits. It runs from the loop and
    // between transfer blocks alike, so a drum keeps turning while other keys
    // are sent.
    void animation_frames();

    bool initialized_ = false;
    Session session_;
    Screen screen_;
    StatusScreen status_;
    PageCache pages_;
    keys::AnimatedKeys animations_;
    KeyView view_;
    game::Snake game_{screen_};
    int game_score_ = 0;
    Touch touch_;
    DragReport drag_;
    Transfer transfer_;
    CommandRouter router_;
    SessionCommands session_commands_;
    PageCommands page_commands_;
    KeyCommands key_commands_;
    int pressed_page_ = 0;
    uint16_t composed_ = 0;  // keys whose animation frame waits for the beam
    uint32_t touch_polled_ms_ = 0;
};
