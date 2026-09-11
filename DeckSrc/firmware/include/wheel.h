#pragma once
#include <stddef.h>
#include <stdint.h>
// Keys the deck turns by itself, at the screen's pace. The desktop sends a
// look once and the deck does the rest:
//  - a drum (a picker wheel): the key picture under the numbers, the
//    characters in the desktop's font, the labels, and how it should feel.
//    It follows the finger 1:1, lets a flick coast and springs onto a label;
//    only the label it rests on goes back.
//  - a dial (a volume arc or bar): the key at its lowest and at its highest,
//    and where each pixel fills. It follows the finger, and its value goes
//    back as it turns.
//  - a die: a cube drawn here in 3D, thrown by a roll. It tumbles, hops and
//    bounces off the key's edges, slows, and lies flat wherever it stops; its
//    "label" is where and how it lies (face, place, turn), packed in one int.
//
// The look (WHEEL command) is laid out as src/shared/wheel-spec.ts writes it.
namespace wheel {
constexpr size_t MAX_BYTES = 48 * 1024;
void begin(int image_w, int image_h);
// Check and keep a look, taking the buffer (PSRAM, freed here). The last four
// are kept, by CRC. False if it is malformed.
bool load(uint8_t *data, size_t length, uint32_t crc);
bool known(uint32_t crc);
// Show a kept look on a key of the page (id, signature) at a label. A key
// already turning with that look keeps turning and ignores the index.
bool arm(int cell, int page, uint32_t signature, uint32_t crc, int index);
void disarm(int cell);
void disarm_all();
bool armed(int cell, int page, uint32_t signature);
// Draw the key's wheel as it is now into its own frame (image_w x image_h
// RGB565), which frame() hands out. Composing is kept apart from copying to
// the screen so the copy alone has to fit between the beam's passes.
void compose(int cell);
const uint16_t *frame(int cell);
// A finger on an armed key: y is its height inside the key.
void touch(int cell, int y, uint32_t now_ms, bool landed);
void release(int cell, uint32_t now_ms);
// Move animations on. Returns the keys whose picture changed.
uint16_t tick(uint32_t now_ms);
// The label a drum came to rest on, or how a die lies once it stopped, once,
// if it differs from the last reported.
int settled(int cell);
// A dial's value while a finger turns it - at most every 40 ms, and at once
// when the finger lifts - else INT_MIN.
int value(int cell, uint32_t now_ms);
// Spin a drum to a label, as a flick would and landing on it; or throw a die
// (target unused), which lands however it lands.
void roll(int cell, int target, uint32_t now_ms);
// Start a drum coasting as if flicked at rows_per_s (diagnostics).
void spin(int cell, float rows_per_s, uint32_t now_ms);
uint32_t compose_us();
// A die's last frame in parts (us): putting back, shadow, faces, pips.
const uint32_t *die_us();
// Pictures composed since boot: over a timed spin, the frame rate.
uint32_t frames();
}
