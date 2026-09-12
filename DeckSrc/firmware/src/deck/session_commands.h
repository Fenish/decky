#pragma once
#include "protocol/command_router.h"

class Deck;

// The desktop's commands for the connection itself:
//   ID                        who the deck is, and what it can do (flags)
//   HELLO <pages> [<units>]   a desktop starts loading: progress in the centre key
//   PING / BYE                heartbeat, and goodbye
//   UPDATING <percent>|END    Decky on the PC is updating itself
//   BLOCK <bytes>             uploads over USB in blocks this big
//   DRAG <mask>               keys to report finger movement on
//   GAME snake|off            the easter egg takes the panel, or gives it back
//   SDINFO, SCREEN, DISPLAY_STATE, DISPLAY_RESYNC   card, screen and scanout diagnostics
class SessionCommands : public CommandTable<SessionCommands> {
public:
    explicit SessionCommands(Deck &deck) : deck_(deck) {}
    bool run(const char *name, const char *line) override;

private:
    // Each command's line: false if it does not read as that command.
    bool identify(const char *line);
    bool hello(const char *line);
    bool ping(const char *line);
    bool bye(const char *line);
    bool updating(const char *line);
    bool block(const char *line);
    bool drag(const char *line);
    bool game(const char *line);
    bool storage(const char *line);
    bool screen(const char *line);
    bool display_state(const char *line);
    bool display_resync(const char *line);

    Deck &deck_;
};
