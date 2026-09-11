#pragma once
#include <stdint.h>

// Colours are RGB565, as the framebuffer and the desktop's pictures hold them.

// `over` laid on `under` by a (0-255).
inline uint16_t blend(uint16_t under, uint16_t over, int a) {
    a += a >> 7;
    const int ur = under >> 11, ug = (under >> 5) & 63, ub = under & 31;
    const int orr = over >> 11, og = (over >> 5) & 63, ob = over & 31;
    return ((ur + (((orr - ur) * a) >> 8)) << 11) | ((ug + (((og - ug) * a) >> 8)) << 5) | (ub + (((ob - ub) * a) >> 8));
}
