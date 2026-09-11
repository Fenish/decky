// The die's picture, 60 times a second beside the panel's scanout: speed over
// size. With the defaults a frame took 10-15 ms; with these, about 5.
#pragma GCC optimize("O2", "fast-math")
#include <Arduino.h>
#include <limits.h>
#include <math.h>
#include "common/color.h"
#include "common/key_image.h"
#include "keys/die/die.h"
#include "keys/die/die_shape.h"
#include "keys/die/rotation.h"

namespace keys {
using namespace die_shape;

namespace {
// A colour lit by `light` (1 as it is), each channel held in range.
inline uint16_t lit(uint16_t color, float light) {
    const int r = min(31, static_cast<int>((color >> 11) * light));
    const int g = min(63, static_cast<int>(((color >> 5) & 63) * light));
    const int b = min(31, static_cast<int>((color & 31) * light));
    return (max(r, 0) << 11) | (max(g, 0) << 5) | max(b, 0);
}
// The part of the key a frame drew on, to put back from the backdrop next time.
struct Box {
    int x0 = INT_MAX, y0 = INT_MAX, x1 = -1, y1 = -1;
    void add(int ax0, int ay0, int ax1, int ay1) {
        x0 = min(x0, max(ax0, 0));
        y0 = min(y0, max(ay0, 0));
        x1 = max(x1, min(ax1, KeyImage::width() - 1));
        y1 = max(y1, min(ay1, KeyImage::height() - 1));
    }
};
// Narrow [lo, hi] to where |v0 + dv x| <= limit; false if that is nowhere.
inline bool span(float v0, float dv, float limit, float &lo, float &hi) {
    if (fabsf(dv) < 1e-6f) return fabsf(v0) <= limit;
    float a = (-limit - v0) / dv, b = (limit - v0) / dv;
    if (a > b) {
        const float t = a;
        a = b;
        b = t;
    }
    lo = fmaxf(lo, a);
    hi = fminf(hi, b);
    return lo <= hi;
}
// Its shadow on the table: the footprint, a rounded square turned `yaw`,
// seen leaning, darkened by `strength` and softened over `soft` pixels.
void shadow(uint16_t *out, float sx, float sy, float half, float yaw, float soft, float strength, Box &box) {
    const int W = KeyImage::width(), H = KeyImage::height();
    const float c = cosf(yaw), s = sinf(yaw), squash = cosf(VIEW_TILT), r = half * 0.35f, inner = half - r;
    const float reach = half * 1.42f + soft;
    const int x0 = max(0, static_cast<int>(sx - reach)), x1 = min(W - 1, static_cast<int>(sx + reach) + 1);
    const int y0 = max(0, static_cast<int>(sy - reach * squash)), y1 = min(H - 1, static_cast<int>(sy + reach * squash) + 1);
    const float edge = 1.f / (2.f * soft);
    const int full = static_cast<int>(strength * 255.f);
    const float outer = half + soft;
    for (int y = y0; y <= y1; ++y) {
        uint16_t *line = out + y * W;
        const float dy = (y + 0.5f - sy) / squash, dx0 = 0.5f - sx;
        // Just the row's part inside the turned square and its soft edge.
        float lo = x0, hi = x1;
        if (!span(dx0 * c - dy * s, c, outer, lo, hi) || !span(-dx0 * s - dy * c, -s, outer, lo, hi)) continue;
        const int xs = static_cast<int>(ceilf(lo)), xe = static_cast<int>(floorf(hi));
        float lu = (xs + dx0) * c - dy * s, lv = -(xs + dx0) * s - dy * c;
        for (int x = xs; x <= xe; ++x, lu += c, lv -= s) {
            // Black stays black however dark the shadow: most keys cost nothing.
            if (!line[x]) continue;
            const float qx = fabsf(lu) - inner, qy = fabsf(lv) - inner;
            const float sd = (qx > 0 && qy > 0 ? sqrtf(qx * qx + qy * qy) : fmaxf(qx, qy)) - r;
            const float t = 0.5f - sd * edge;
            if (t <= 0) continue;
            line[x] = blend(line[x], 0, t >= 1 ? full : static_cast<int>(t * t * (3.f - 2.f * t) * full));
        }
    }
    box.add(x0, y0, x1, y1);
}
}  // namespace

// Its shadow, then each face turned toward the eye, lit by how it faces the
// light, darker at its rounded edges, then its pips. Each face is walked row
// by row over just the pixels it can cover, with its shades worked out once;
// only the part the last frame drew on is put back first.
void Die::compose() {
    const DieLook &look = die();
    const int W = KeyImage::width(), H = KeyImage::height();
    uint32_t mark = micros(), faces_us = 0, pips_us = 0;
    const float tilt_s = sinf(VIEW_TILT);
    const float rest_half = look.size * 0.5f;
    const float half = rest_half * (1.f + h_ / HOP_SCALE);
    const float cx = x_, cy = y_ - tilt_s * h_;
    const float sx = x_ + 1.5f + h_ * 0.35f, sy = y_ + tilt_s * rest_half + 1.5f + h_ * 0.35f, soft = 1.5f + h_ * 0.2f;
    // Where this frame can draw - a cube seen any way stays within its
    // corners' reach, sqrt(3) half-edges - and the last frame's: those rows
    // are put back from the backdrop, then drawn on.
    Box area;
    const float reach = half * 1.7320508f + 2.f, shade_reach = rest_half * 1.42f + soft + 1.f;
    area.add(static_cast<int>(cx - reach), static_cast<int>(cy - reach), static_cast<int>(cx + reach) + 1,
             static_cast<int>(cy + reach) + 1);
    area.add(static_cast<int>(sx - shade_reach), static_cast<int>(sy - shade_reach), static_cast<int>(sx + shade_reach) + 1,
             static_cast<int>(sy + shade_reach) + 1);
    Box rows = area;
    if (fresh_) rows.add(0, 0, W - 1, H - 1);
    else if (box_[2] >= box_[0]) rows.add(box_[0], box_[1], box_[2], box_[3]);
    fresh_ = false;
    uint16_t *out = frame_;
    const int row_bytes = (rows.x1 - rows.x0 + 1) * 2;
    for (int y = rows.y0; y <= rows.y1; ++y) memcpy(out + y * W + rows.x0, look.backdrop() + y * W + rows.x0, row_bytes);
    parts_[0] = micros() - mark;
    mark = micros();
    Box box;
    // The shadow falls from the side most nearly level, toward the lower right.
    int level = 0;
    for (int j = 1; j < 3; ++j)
        if (fabsf(rot_[6 + j]) < fabsf(rot_[6 + level])) level = j;
    shadow(out, sx, sy, rest_half, atan2f(rot_[3 + level], rot_[level]), soft, fmaxf(0.25f, 0.5f - h_ / 120.f), box);
    parts_[1] = micros() - mark;
    float view[9];
    viewed(rot_, view);
    // Shades of the body from 0.72 to 1.12 of a face's light, for its rim and gloss.
    constexpr int SHADES = 32;
    constexpr float SHADE_LOW = 0.72f, SHADE_SPAN = 0.40f;
    for (int f = 0; f < 6; ++f) {
        float n[3], u[3], v[3], world[3];
        rotation::apply(view, FACES[f].n, n);
        if (n[2] <= 0.02f) continue;
        rotation::apply(view, FACES[f].u, u);
        rotation::apply(view, FACES[f].v, v);
        rotation::apply(rot_, FACES[f].n, world);
        const float light = AMBIENT + DIFFUSE * fmaxf(0.f, world[0] * LIGHT[0] + world[1] * LIGHT[1] + world[2] * LIGHT[2]);
        // On the key (y down): the face's middle and its half-axes.
        const float fx = cx + n[0] * half, fy = cy - n[1] * half;
        const float ax = u[0] * half, ay = -u[1] * half, bx = v[0] * half, by = -v[1] * half;
        const float det = ax * by - ay * bx;
        if (fabsf(det) < 0.5f) continue;
        const float la = sqrtf(ax * ax + ay * ay), lb = sqrtf(bx * bx + by * by);
        // Pixels a unit across each axis; a and b step by these along a row.
        const float ka = fabsf(det) / lb, kb = fabsf(det) / la, inv = 1.f / det;
        const float step_a = by * inv, step_b = -ay * inv, corner = CORNER * fminf(ka, kb);
        const float lim_a = 1.f + 0.75f / ka, lim_b = 1.f + 0.75f / kb;
        uint16_t shades[SHADES];
        for (int i = 0; i < SHADES; ++i) shades[i] = lit(look.color, light * (SHADE_LOW + i * (SHADE_SPAN / (SHADES - 1))));
        const float spread_y = fabsf(ay) + fabsf(by) + 1;
        const int y0 = max(0, static_cast<int>(floorf(fy - spread_y))), y1 = min(H - 1, static_cast<int>(ceilf(fy + spread_y)));
        const float px0 = 0.5f - fx, gloss_step = -GLOSS / half;
        mark = micros();
        for (int y = y0; y <= y1; ++y) {
            const float py = y + 0.5f - fy;
            const float a0 = (px0 * by - py * bx) * inv, b0 = (ax * py - ay * px0) * inv;
            float lo = 0, hi = W - 1;
            if (!span(a0, step_a, lim_a, lo, hi) || !span(b0, step_b, lim_b, lo, hi)) continue;
            const int xs = static_cast<int>(ceilf(lo)), xe = static_cast<int>(floorf(hi));
            if (xs > xe) continue;
            uint16_t *line = out + y * W;
            float a = a0 + step_a * xs, b = b0 + step_b * xs;
            // Lighter toward the upper left: 1 - GLOSS (px + py) / half.
            float gloss = 1.f - GLOSS * (xs + px0 + py) / half;
            for (int x = xs; x <= xe; ++x, a += step_a, b += step_b, gloss += gloss_step) {
                const float aa = fabsf(a), ab = fabsf(b);
                // How far outside the rounded face, in pixels (inside: below 0).
                const float ca = aa - (1.f - CORNER), cb = ab - (1.f - CORNER);
                float sd;
                if (ca > 0 && cb > 0) {
                    const float da = ca * ka, db = cb * kb;
                    sd = sqrtf(da * da + db * db) - corner;
                } else sd = fmaxf((aa - 1.f) * ka, (ab - 1.f) * kb);
                if (sd >= 0.5f) continue;
                const float rim = sd > -BEVEL_PX ? 0.8f + 0.2f * fmaxf(0.f, -sd) * (1.f / BEVEL_PX) : 1.f;
                // (constrain() is a macro: it would work the sum out again.)
                const int step = static_cast<int>((rim * gloss - SHADE_LOW) * ((SHADES - 1) / SHADE_SPAN) + 0.5f);
                const int shade = step < 0 ? 0 : step >= SHADES ? SHADES - 1 : step;
                line[x] = sd <= -0.5f ? shades[shade] : blend(line[x], shades[shade], static_cast<int>((0.5f - sd) * 255.f));
            }
            box.add(xs, y, xe, y);
        }
        faces_us += micros() - mark;
        mark = micros();
        // Its pips: each a small ellipse of its own.
        const uint16_t pip = lit(look.pip, 0.55f + 0.45f * light);
        const float pip_r = PIP_R * sqrtf(ka * kb), reach_x = PIP_R * (fabsf(ax) + fabsf(bx)) + 1.5f,
                    reach_y = PIP_R * (fabsf(ay) + fabsf(by)) + 1.5f, far = (pip_r + 1) * (pip_r + 1);
        // Inside this, a pixel is all pip: only the edge needs a square root.
        const float solid = pip_r > 0.5f ? (pip_r - 0.5f) * (pip_r - 0.5f) : 0.f;
        const float pip_step_a = step_a * ka, pip_step_b = step_b * kb;
        for (int p = 0; p <= f; ++p) {
            const float pa = PIPS[f][p][0] * PIP_AT, pb = PIPS[f][p][1] * PIP_AT;
            const float pcx = fx + pa * ax + pb * bx, pcy = fy + pa * ay + pb * by;
            const int qx0 = max(0, static_cast<int>(pcx - reach_x)), qx1 = min(W - 1, static_cast<int>(pcx + reach_x));
            const int qy0 = max(0, static_cast<int>(pcy - reach_y)), qy1 = min(H - 1, static_cast<int>(pcy + reach_y));
            for (int y = qy0; y <= qy1; ++y) {
                uint16_t *line = out + y * W;
                const float py = y + 0.5f - fy, px = qx0 + 0.5f - fx;
                float da = ((px * by - py * bx) * inv - pa) * ka, db = ((ax * py - ay * px) * inv - pb) * kb;
                for (int x = qx0; x <= qx1; ++x, da += pip_step_a, db += pip_step_b) {
                    const float d2 = da * da + db * db;
                    if (d2 >= far) continue;
                    if (d2 <= solid) {
                        line[x] = pip;
                        continue;
                    }
                    const float cover = fminf(1.f, pip_r + 0.5f - sqrtf(d2));
                    if (cover > 0) line[x] = blend(line[x], pip, static_cast<int>(cover * 255.f));
                }
            }
        }
        pips_us += micros() - mark;
    }
    parts_[2] = faces_us;
    parts_[3] = pips_us;
    box_[0] = box.x0;
    box_[1] = box.y0;
    box_[2] = box.x1;
    box_[3] = box.y1;
    dirty_ = false;
}
}  // namespace keys
