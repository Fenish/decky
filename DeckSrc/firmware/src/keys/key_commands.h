#pragma once
#include "protocol/command_router.h"

class Deck;

// The desktop's commands for keys the deck animates by itself:
//   WHEEL <index> <CRC32> <cell> <label> <bytes> <look CRC>  a look, and a key armed with it
//   WHEELAT <index> <CRC32> <cell> <label> <look CRC>        arm a key with a look it keeps
//   WHEELROLL <index> <CRC32> <cell> <label>                 spin a drum to a label, throw a die
//   WHEELSPIN <cell> <tenths of labels a second>             diagnostics: a flick
class KeyCommands : public CommandTable<KeyCommands> {
public:
    explicit KeyCommands(Deck &deck) : deck_(deck) {}
    bool run(const char *name, const char *line) override;

private:
    // Each command's line: false if it does not read as that command.
    bool upload(const char *line);
    bool arm(const char *line);
    bool roll(const char *line);
    bool spin(const char *line);

    Deck &deck_;
};
