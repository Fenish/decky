#pragma once
#include <math.h>
#include <stdint.h>
#include "keys/die/rotation.h"

// What the die is and how it is seen - shared by its physics (die.cpp) and
// its drawing (die_render.cpp). The desktop draws a die at rest with the same
// numbers (src/shared/die.ts).
namespace keys::die_shape {
// Seen leaning VIEW_TILT from straight down, toward the key's bottom edge, so
// a sliver of its front shows; light comes from the upper left.
constexpr float VIEW_TILT = 0.30f;
constexpr float LIGHT[3] = {-0.40f, 0.50f, 0.77f};
constexpr float AMBIENT = 0.36f, DIFFUSE = 0.70f, GLOSS = 0.08f, BEVEL_PX = 2.5f;
// Its faces' corners, and where its pips sit and how big, in half-edges.
constexpr float CORNER = 0.24f, PIP_AT = 0.52f, PIP_R = 0.18f;
// How much bigger a pixel of height makes it.
constexpr float HOP_SCALE = 110.f;

// The faces 1-6: outward normal, and the axes their pips are laid out on.
struct Face {
    int8_t n[3], u[3], v[3];
};
constexpr Face FACES[6] = {
    {{0, 0, 1}, {1, 0, 0}, {0, 1, 0}},   {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}},
    {{0, 1, 0}, {0, 0, 1}, {1, 0, 0}},   {{0, -1, 0}, {0, 0, 1}, {-1, 0, 0}},
    {{-1, 0, 0}, {0, 1, 0}, {0, 0, -1}}, {{0, 0, -1}, {1, 0, 0}, {0, -1, 0}},
};
// Pips on a 3 x 3 grid, (u, v) each -1, 0 or 1 times PIP_AT.
constexpr int8_t PIPS[6][6][2] = {
    {{0, 0}},
    {{-1, -1}, {1, 1}},
    {{-1, -1}, {0, 0}, {1, 1}},
    {{-1, -1}, {1, -1}, {-1, 1}, {1, 1}},
    {{-1, -1}, {1, -1}, {0, 0}, {-1, 1}, {1, 1}},
    {{-1, -1}, {-1, 0}, {-1, 1}, {1, -1}, {1, 0}, {1, 1}},
};

// The die as the eye sees it: its turn, leaned by the view.
inline void viewed(const float *rot, float *out) {
    const float c = cosf(VIEW_TILT), s = sinf(VIEW_TILT);
    const float view[9] = {1, 0, 0, 0, c, s, 0, -s, c};
    rotation::multiply(view, rot, out);
}
}  // namespace keys::die_shape
