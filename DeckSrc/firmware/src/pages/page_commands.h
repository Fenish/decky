#pragma once
#include <stddef.h>
#include <stdint.h>
#include "keys/overlay.h"
#include "protocol/command_router.h"

class Deck;

// The desktop's commands for pages and what they show:
//   CACHE/PAGE <index> <CRC32>      start a copy of a page (kept, or shown once committed)
//   PUSH/PATCH <cell> <bytes> <CRC> a key of the page being built, whole or as a patch
//   BLANK <cell>                    a black key of the page being built
//   COMMIT <CRC32>                  the page being built is complete
//   ABORT                           it is not
//   ALT <index> <CRC32> <cell> ...  a toggle key's ON picture
//   STATE <index> <CRC32> <mask>    show a page with these toggle keys on
//   LIVE <index> <CRC32> <cell> ... a widget key's live picture, as a patch
//   SLIDE <index> <CRC32> <cell> ...text too long for its key, to slide
//   SWEEP <index> <CRC32> <cell> ...a ring's arc, for the deck to move
// The desktop's README describes each in full.
class PageCommands : public CommandTable<PageCommands> {
public:
    explicit PageCommands(Deck &deck) : deck_(deck) {}
    bool run(const char *name, const char *line) override;

private:
    // Each command's line: false if it does not read as that command.
    bool cache(const char *line);
    bool page(const char *line);
    bool blank(const char *line);
    bool push(const char *line);
    bool patch(const char *line);
    bool commit(const char *line);
    bool abort(const char *line);
    bool alternate(const char *line);
    bool state(const char *line);
    bool live(const char *line);
    bool slide(const char *line);
    bool sweep(const char *line);

    // SLIDE and SWEEP once read: a key's overlay of that kind given, or taken away.
    void overlay(KeyOverlay::Kind kind, int id, uint32_t signature, int cell, size_t bytes, uint32_t checksum,
                 int64_t clock);
    void begin(int id, uint32_t signature, bool cache_only);
    // A key of the page being built has its own picture now.
    void arrived(int cell);

    Deck &deck_;
};
