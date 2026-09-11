#pragma once
#include <stddef.h>
#include <stdint.h>
// Text too long for its key, slid along by the deck: a song's title, say. The
// desktop draws each line once in its own font, as coverage, and the deck lays
// it in one colour over the key's picture, inside the line's window. A line
// rests at its start, slides left at a steady pace with its start following
// after a gap, and rests again: a loop. The picture under it can change (LIVE)
// without the text starting over; new text starts over.
//
// The text (SLIDE command) is laid out as src/shared/slide-spec.ts writes it.
namespace slide {
constexpr size_t MAX_BYTES = 48 * 1024;
struct Text;
// The part of the key a text covers, in key pixels.
struct Box {
    int x, y, w, h;
};
// Check a key's text and keep it, taking the buffer (PSRAM; freed here, also
// when it is malformed). Null if it is malformed.
Text *load(uint8_t *data, size_t length, int image_w, int image_h, uint32_t now_ms);
// The same text for another copy of the page, going on from where it is.
// Null without memory for it.
Text *clone(const Text *text);
void release(Text *text);
Box box(const Text *text);
// Whether the text moved since it was last drawn.
bool due(const Text *text, uint32_t now_ms);
// Fix where the text is for the frame about to be drawn.
void frame(Text *text, uint32_t now_ms);
// One row of the key (y, in key pixels) as the frame shows it: `key_row` is
// the key's own picture there, and `out` takes the box's columns.
void row(const Text *text, int y, const uint16_t *key_row, uint16_t *out);
}
