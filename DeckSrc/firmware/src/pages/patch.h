#pragma once
#include <stddef.h>
#include <stdint.h>
// A LIVE patch: boxes of x, y, w, h (a byte each), then the box's pixels run-
// length encoded - a control byte c < 128 before c+1 literal pixels, c >= 128
// before one pixel repeated c-127 times, pixels 2 bytes little-endian. The
// desktop's src/shared/live-patch.ts writes them. Check a patch in full first
// (write=false) so a malformed one changes nothing.
bool apply_patch(uint16_t *image, int width, int height, const uint8_t *data, size_t length, bool write);
