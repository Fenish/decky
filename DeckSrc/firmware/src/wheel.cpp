// Frames are composed here, 60 a second, beside the panel's scanout: speed
// over size. fast-math lets min, max and square roots be single FPU steps.
#pragma GCC optimize("O2", "fast-math")
#include "wheel.h"
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <limits.h>
#include <math.h>
#include <string.h>
#include "live_patch.h"

namespace wheel {
namespace {
constexpr int KEYS = 15, LOOKS = 4, MAX_LABELS = 200, MAX_SIZES = 2, MAX_GLYPHS = 64, MAX_TEXT = 16;
// Coasting slower than this, in labels a second, the wheel springs onto the
// nearest label instead of gliding on.
constexpr float SNAP_SPEED = 4.0f;
// At rest: within this many labels of one, moving slower than REST_SPEED.
constexpr float REST_OFFSET = 0.004f, REST_SPEED = 0.05f;
// The flick is the finger's last SAMPLE_MS; samples are taken SAMPLE_GAP_MS
// apart, and a finger still for LIFT_MS before it lifted did not flick.
constexpr uint32_t SAMPLE_MS = 80, SAMPLE_GAP_MS = 10, LIFT_MS = 50;
constexpr int SAMPLES = 8;
// A picture no more often than this, however fast the loop comes round.
constexpr uint32_t FRAME_MS = 8;
// A dial's value goes to the desktop no more often than this while it turns.
constexpr uint32_t VALUE_MS = 40;

// A die is seen leaning VIEW_TILT from straight down, toward the key's bottom
// edge, so a sliver of its front shows; light comes from the upper left. The
// desktop draws a die at rest with the same sums (src/shared/die.ts).
constexpr float VIEW_TILT = 0.30f;
constexpr float LIGHT[3] = {-0.40f, 0.50f, 0.77f};
constexpr float AMBIENT = 0.36f, DIFFUSE = 0.70f, GLOSS = 0.08f, BEVEL_PX = 2.5f;
// Its faces' corners, and where its pips sit and how big, in half-edges.
constexpr float CORNER = 0.24f, PIP_AT = 0.52f, PIP_R = 0.18f;
// How it moves: pixels a second squared down, what a landing gives back of a
// hop, how much bigger a pixel of height makes it, how slow it lies down, how
// the table slows it besides its drag (px/s^2), and its gap to the key's edge.
constexpr float GRAVITY = 1500.f, HOP_GIVE = 0.4f, HOP_SCALE = 110.f, SETTLE_SPEED = 45.f,
                FRICTION = 90.f, EDGE = 2.f;
constexpr uint32_t SETTLE_MS = 260, DIE_FRAME_MS = 12;
// The faces 1-6: outward normal, and the axes their pips are laid out on.
struct Face { int8_t n[3], u[3], v[3]; };
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

enum Kind : uint8_t { DRUM = 1, DIAL = 2, DIE = 3 };
struct Size {
    uint8_t height = 0, count = 0;
    uint8_t chars[MAX_GLYPHS] = {};
    uint8_t widths[MAX_GLYPHS] = {};
    const uint8_t *alpha[MAX_GLYPHS] = {};
};
struct Label {
    uint8_t size = 0, length = 0;
    uint8_t glyphs[MAX_TEXT] = {};
    uint16_t width = 0;
};
struct Look {
    uint32_t crc = 0, used = 0;
    Kind kind = DRUM;
    uint8_t *data = nullptr;       // the look as sent; glyph alpha points into it
    uint16_t *backdrop = nullptr;  // the key under the numbers; a dial at its lowest
    uint16_t color = 0;
    int sizes = 0;
    Size size[MAX_SIZES];
    // A drum: its labels, their spacing and place, and how it moves.
    int count = 0, row = 0, center = 0, clip_top = 0, clip_bottom = 0;
    float angle = 0, fade = 0, rubber = 0, fling = 0, snap = 0, max_speed = 0;
    Label labels[MAX_LABELS];
    // A dial: its range, finger pixels a step, whether it writes its number
    // and where, the key at its highest, and at what share of the range each
    // pixel fills (1-254; 255 never).
    int min = 0, max = 0, text_y = 0;
    bool number = true;
    float unit_px = 1;
    uint16_t *fill = nullptr;
    uint8_t *map = nullptr;
    // A die: its edge in pixels and pip colour (the body is `color`); how hard
    // a roll throws it (px/s), how high (px/s up), how soon it slows (1/s)
    // and what a wall gives back.
    float die_size = 0, speed = 0, hop = 0, drag = 0, bounce = 0;
    uint16_t pip = 0;
};
enum Mode : uint8_t { REST, DRAG, GLIDE, SPRING, ROLL, SETTLE };
struct Key {
    Look *look = nullptr;
    int page = -1;
    uint32_t signature = 0;
    uint16_t *frame = nullptr;  // the picture last composed
    Mode mode = REST;
    float pos = 0;              // a drum's label at the band, or a dial's value
    float drawn = -1e9f;        // pos when last composed
    uint32_t composed_ms = 0;
    int index = 0;              // what the desktop knows: label, or value
    bool report = false;
    uint32_t reported_ms = 0;
    int grab_y = 0;
    float grab_pos = 0;
    uint32_t sample_t[SAMPLES] = {};
    float sample_p[SAMPLES] = {};
    int samples = 0;
    // GLIDE: pos = x0 + v0 * fling * (1 - e^(-t / fling)).
    // SPRING: pos = target + (a + b t) e^(-snap t), critically damped.
    uint32_t since = 0;
    float x0 = 0, v0 = 0, a = 0, b = 0;
    int target = 0;
    int forced = -1;            // a roll's label, which the spring lands on
    // A die: where it is (px, y down), how fast it goes, how high it is and
    // rises; how it is turned (row-major, world x right, y up, z toward the
    // eye) and turning (rad/s about world axes). Lying down: the turn left,
    // about `axis`, from `from`, onto `face`.
    float x = 0, y = 0, vx = 0, vy = 0, h = 0, vh = 0;
    float rot[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    float turn[3] = {};
    float from[9] = {}, axis[3] = {}, angle = 0;
    int face = 0;
    // Thrown: the tumble through the air, `angle` about `axis` from `from`
    // over `air` seconds, up at `lift` px/s.
    bool flying = false;
    float air = 0, lift = 0;
    uint32_t last_ms = 0;
    bool dirty = false;
    // The part of its frame the die drew on last; `fresh` puts back all of it.
    int box[4] = {0, 0, -1, -1};
    bool fresh = true;
};
Look looks[LOOKS];
Key keys[KEYS];
int W = 0, H = 0;
uint32_t used_counter = 0, last_compose = 0, composed_frames = 0;
// A die's last frame, in parts (us): putting back, shadow, faces, pips.
uint32_t die_parts[4] = {};

struct Reader {
    const uint8_t *data;
    size_t length, at = 0;
    bool ok = true;
    const uint8_t *take(size_t n) {
        if (!ok || at + n > length) { ok = false; return nullptr; }
        const uint8_t *p = data + at;
        at += n;
        return p;
    }
    uint8_t u8() { const uint8_t *p = take(1); return p ? p[0] : 0; }
    uint16_t u16() { const uint8_t *p = take(2); return p ? p[0] | (p[1] << 8) : 0; }
    uint32_t u32() { const uint8_t *p = take(4); return p ? p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24) : 0; }
};

void forget(Look &look) {
    for (auto &key : keys) if (key.look == &look) disarm(&key - keys);
    free(look.data);
    free(look.backdrop);
    free(look.fill);
    free(look.map);
    look.data = nullptr;
    look.backdrop = nullptr;
    look.fill = nullptr;
    look.map = nullptr;
    look.crc = 0;
}
Look *find(uint32_t crc) {
    for (auto &look : looks) if (look.data && look.crc == crc) return &look;
    return nullptr;
}
uint16_t *image() { return static_cast<uint16_t*>(heap_caps_malloc(W * H * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)); }
// A LIVE patch applied to a picture, checked first.
bool picture(Reader &r, uint16_t *into) {
    const uint32_t bytes = r.u32();
    const uint8_t *patch = r.take(bytes);
    return r.ok && into && apply_patch(into, W, H, patch, bytes, false) && apply_patch(into, W, H, patch, bytes, true);
}
bool glyphs(Reader &r, Size &size) {
    size.height = r.u8();
    size.count = r.u8();
    if (!r.ok || size.height < 1 || size.height > 64 || size.count < 1 || size.count > MAX_GLYPHS) return false;
    for (int g = 0; g < size.count; ++g) {
        size.chars[g] = r.u8();
        size.widths[g] = r.u8();
        if (!size.widths[g] || size.widths[g] > 64) return false;
    }
    for (int g = 0; g < size.count; ++g) size.alpha[g] = r.take(size.widths[g] * size.height);
    return r.ok;
}
int glyph_of(const Size &size, uint8_t c) {
    for (int g = 0; g < size.count; ++g) if (size.chars[g] == c) return g;
    return -1;
}
bool parse_drum(Look &look, Reader &r) {
    look.sizes = r.u8();
    look.count = r.u16();
    look.row = r.u16();
    look.center = r.u16();
    look.clip_top = r.u16();
    look.clip_bottom = r.u16();
    look.color = r.u16();
    look.angle = r.u16() / 1000.f;
    look.fade = r.u8() / 100.f;
    look.rubber = r.u8() / 100.f;
    look.fling = r.u16() / 1000.f;
    look.snap = r.u16() / 100.f;
    look.max_speed = r.u16() / 10.f;
    if (!r.ok || look.sizes < 1 || look.sizes > MAX_SIZES || look.count < 1 || look.count > MAX_LABELS ||
        look.row < 4 || look.row > H || look.center >= H || look.clip_top >= look.clip_bottom ||
        look.clip_bottom > H || look.angle < 0.05f || look.angle > 1.2f || look.fade > 1.f ||
        look.rubber > 1.f || look.fling <= 0 || look.snap <= 0 || look.max_speed <= 0)
        return false;
    memset(look.backdrop, 0, W * H * 2);
    if (!picture(r, look.backdrop)) return false;
    for (int s = 0; s < look.sizes; ++s) if (!glyphs(r, look.size[s])) return false;
    for (int i = 0; i < look.count; ++i) {
        Label &label = look.labels[i];
        label.size = r.u8();
        label.length = r.u8();
        const uint8_t *text = r.take(label.length);
        if (!r.ok || label.size >= look.sizes || !label.length || label.length > MAX_TEXT) return false;
        label.width = 0;
        for (int c = 0; c < label.length; ++c) {
            const int glyph = glyph_of(look.size[label.size], text[c]);
            if (glyph < 0) return false;
            label.glyphs[c] = glyph;
            label.width += look.size[label.size].widths[glyph];
        }
    }
    return r.ok && r.at == r.length;
}
bool parse_dial(Look &look, Reader &r) {
    look.min = r.u16();
    look.max = r.u16();
    look.unit_px = r.u16() / 10.f;
    look.text_y = r.u16();
    look.color = r.u16();
    const int number = r.u8();
    look.number = number == 1;
    if (!r.ok || look.max <= look.min || look.max > 1000 || look.unit_px <= 0 || look.text_y >= H || number > 1)
        return false;
    look.fill = image();
    look.map = static_cast<uint8_t*>(heap_caps_malloc(W * H, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!look.fill || !look.map) return false;
    memset(look.backdrop, 0, W * H * 2);
    if (!picture(r, look.backdrop)) return false;
    memcpy(look.fill, look.backdrop, W * H * 2);
    if (!picture(r, look.fill)) return false;
    // The map, as runs: a count (1-255) and the share its pixels fill at.
    const uint32_t bytes = r.u32();
    const uint8_t *runs = r.take(bytes);
    if (!r.ok || bytes % 2) return false;
    int at = 0;
    for (uint32_t i = 0; i < bytes; i += 2) {
        if (!runs[i] || at + runs[i] > W * H) return false;
        memset(look.map + at, runs[i + 1], runs[i]);
        at += runs[i];
    }
    if (at != W * H) return false;
    // Digits only for a dial that writes its number (the arc; the bar none).
    look.sizes = look.number ? 1 : 0;
    if (look.number) {
        if (!glyphs(r, look.size[0])) return false;
        for (char c = '0'; c <= '9'; ++c) if (glyph_of(look.size[0], c) < 0) return false;
    }
    return r.at == r.length;
}
bool parse_die(Look &look, Reader &r) {
    look.die_size = r.u8();
    look.color = r.u16();
    look.pip = r.u16();
    look.speed = r.u16();
    look.hop = r.u16();
    look.drag = r.u16() / 100.f;
    look.bounce = r.u8() / 100.f;
    // Every number bounded: the physics has no clamp of its own, and a throw
    // of 65535 px/s or a hop that long would send the die off into numbers
    // no pixel loop is ready for.
    if (!r.ok || look.die_size < 12 || look.die_size > min(W, H) / 2 || look.speed <= 0 || look.speed > 3000 ||
        look.hop < 20 || look.hop > 800 || look.drag <= 0 || look.drag > 20 || look.bounce > 1.f)
        return false;
    memset(look.backdrop, 0, W * H * 2);
    if (!picture(r, look.backdrop)) return false;
    return r.at == r.length;
}
bool parse(Look &look, const uint8_t *data, size_t length) {
    Reader r{data, length};
    const uint8_t version = r.u8();
    look.kind = version == 2 ? DIAL : version == 3 ? DIE : DRUM;
    return version == 1 ? parse_drum(look, r) : version == 2 ? parse_dial(look, r) : version == 3 ? parse_die(look, r) : false;
}

// Blend a colour over a pixel, both RGB565, by a (0-255).
inline uint16_t blend(uint16_t under, uint16_t over, int a) {
    a += a >> 7;
    const int ur = under >> 11, ug = (under >> 5) & 63, ub = under & 31;
    const int orr = over >> 11, og = (over >> 5) & 63, ob = over & 31;
    return ((ur + (((orr - ur) * a) >> 8)) << 11) | ((ug + (((og - ug) * a) >> 8)) << 5) | (ub + (((ob - ub) * a) >> 8));
}

// ---- The die ----
float random01() { return esp_random() / 4294967296.f; }
void mat_mul(const float *a, const float *b, float *out) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
}
// A turn of `angle` about the unit `axis` (Rodrigues).
void mat_axis(const float *axis, float angle, float *out) {
    const float c = cosf(angle), s = sinf(angle), t = 1 - c, x = axis[0], y = axis[1], z = axis[2];
    const float m[9] = {t * x * x + c,     t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c,
                        t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c};
    memcpy(out, m, sizeof m);
}
void mat_vec(const float *m, const int8_t *v, float *out) {
    for (int i = 0; i < 3; ++i) out[i] = m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2];
}
// Keep a rotation a rotation as float errors pile up: rows made orthonormal.
void orthonormalize(float *m) {
    float *a = m, *b = m + 3, *c = m + 6;
    const float la = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    for (int i = 0; i < 3; ++i) a[i] /= la;
    const float d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (int i = 0; i < 3; ++i) b[i] -= d * a[i];
    const float lb = sqrtf(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]);
    for (int i = 0; i < 3; ++i) b[i] /= lb;
    c[0] = a[1] * b[2] - a[2] * b[1];
    c[1] = a[2] * b[0] - a[0] * b[2];
    c[2] = a[0] * b[1] - a[1] * b[0];
}
// The die as the eye sees it: its turn, leaned by the view.
void viewed(const float *rot, float *out) {
    const float c = cosf(VIEW_TILT), s = sinf(VIEW_TILT);
    const float view[9] = {1, 0, 0, 0, c, s, 0, -s, c};
    mat_mul(view, rot, out);
}
// A die lying with `face` up, turned `yaw` degrees, at (x, y) in 128ths of
// the key: packed face + 8 (x + 128 (y + 128 yaw)).
bool valid_pose(int pose) {
    return pose >= 0 && (pose & 7) <= 5 && (pose >> 17) <= 359;
}
void set_pose(Key &k, int pose) {
    const int face = pose & 7, x = (pose >> 3) & 127, y = (pose >> 10) & 127, yaw = pose >> 17;
    const float t = yaw * (PI / 180.f), c = cosf(t), s = sinf(t);
    const float spin[9] = {c, -s, 0, s, c, 0, 0, 0, 1};
    const Face &f = FACES[face];
    // Rows u, v, n: the face's axes onto x and y, its normal onto z.
    const float lying[9] = {static_cast<float>(f.u[0]), static_cast<float>(f.u[1]), static_cast<float>(f.u[2]),
                            static_cast<float>(f.v[0]), static_cast<float>(f.v[1]), static_cast<float>(f.v[2]),
                            static_cast<float>(f.n[0]), static_cast<float>(f.n[1]), static_cast<float>(f.n[2])};
    mat_mul(spin, lying, k.rot);
    k.x = x * (W - 1) / 127.f;
    k.y = y * (H - 1) / 127.f;
    k.vx = k.vy = k.h = k.vh = 0;
    k.turn[0] = k.turn[1] = k.turn[2] = 0;
    k.face = face;
    k.dirty = true;
}
int pose_of(const Key &k) {
    float u[3];
    mat_vec(k.rot, FACES[k.face].u, u);
    int yaw = static_cast<int>(lroundf(atan2f(u[1], u[0]) * 180.f / PI));
    yaw = (yaw % 360 + 360) % 360;
    const int x = constrain(static_cast<int>(lroundf(k.x * 127.f / (W - 1))), 0, 127);
    const int y = constrain(static_cast<int>(lroundf(k.y * 127.f / (H - 1))), 0, 127);
    return k.face + 8 * (x + 128 * (y + 128 * yaw));
}
// How far the die reaches from its middle across and down the key, as seen.
void reach(const Key &k, float half, float &ex, float &ey) {
    float view[9];
    viewed(k.rot, view);
    ex = half * (fabsf(view[0]) + fabsf(view[1]) + fabsf(view[2]));
    ey = half * (fabsf(view[3]) + fabsf(view[4]) + fabsf(view[5]));
}
// Keep it inside the key: a wall sends it back with `give` of its speed and,
// on the table, a little hop and a new spin about the vertical. In the air it
// meets the walls as a ball would, so its path does not depend on how it is
// turned - part of what keeps the throw fair.
void walls(Key &k, float give) {
    const Look &look = *k.look;
    const float half = look.die_size * 0.5f * (1.f + k.h / HOP_SCALE);
    float ex = half * 1.7320508f, ey = ex;
    if (!k.flying) reach(k, half, ex, ey);
    const float lift = sinf(VIEW_TILT) * k.h;
    bool hit = false;
    if (k.x - ex < EDGE) { k.x = EDGE + ex; if (k.vx < 0) { k.vx = -k.vx * give; hit = true; } }
    if (k.x + ex > W - EDGE) { k.x = W - EDGE - ex; if (k.vx > 0) { k.vx = -k.vx * give; hit = true; } }
    if (k.y - lift - ey < EDGE) { k.y = EDGE + ey + lift; if (k.vy < 0) { k.vy = -k.vy * give; hit = true; } }
    if (k.y - lift + ey > H - EDGE) { k.y = H - EDGE - ey + lift; if (k.vy > 0) { k.vy = -k.vy * give; hit = true; } }
    if (hit && k.mode == ROLL && !k.flying) {
        k.turn[2] += (random01() - 0.5f) * 12.f;
        if (k.h <= 0.5f) k.vh = fmaxf(k.vh, 40.f + 40.f * random01());
    }
}
// Down to the nearest face: the axis pointing most nearly up is turned the
// short way onto straight up, over SETTLE_MS.
void lie_down(Key &k, uint32_t now) {
    int best = 0;
    for (int j = 1; j < 3; ++j) if (fabsf(k.rot[6 + j]) > fabsf(k.rot[6 + best])) best = j;
    const float sign = k.rot[6 + best] > 0 ? 1.f : -1.f;
    const float up[3] = {k.rot[best] * sign, k.rot[3 + best] * sign, k.rot[6 + best] * sign};
    // Local +z is face 1, -z 6; +x 2, -x 5; +y 3, -y 4.
    static constexpr int FACE_OF[3][2] = {{1, 4}, {2, 3}, {0, 5}};
    k.face = FACE_OF[best][sign > 0 ? 0 : 1];
    const float length = sqrtf(up[0] * up[0] + up[1] * up[1]);
    k.angle = acosf(constrain(up[2], -1.f, 1.f));
    if (length > 1e-5f) { k.axis[0] = up[1] / length; k.axis[1] = -up[0] / length; }
    else { k.axis[0] = 1; k.axis[1] = 0; k.angle = 0; }
    k.axis[2] = 0;
    memcpy(k.from, k.rot, sizeof k.from);
    k.since = now;
    k.mode = SETTLE;
}
void roll_die(Key &k, float dt, uint32_t now) {
    const Look &look = *k.look;
    if (k.mode == SETTLE) {
        const float t = fminf(1.f, (now - k.since) / static_cast<float>(SETTLE_MS));
        const float ease = 1.f - (1.f - t) * (1.f - t) * (1.f - t);
        float step[9];
        mat_axis(k.axis, k.angle * ease, step);
        mat_mul(step, k.from, k.rot);
        const float slow = expf(-8.f * dt);
        k.vx *= slow;
        k.vy *= slow;
        k.x += k.vx * dt;
        k.y += k.vy * dt;
        walls(k, look.bounce);
        k.dirty = true;
        if (t >= 1.f) {
            // Lying exactly as the pose it reports says, as arming it there would.
            const int pose = pose_of(k);
            set_pose(k, pose);
            k.mode = REST;
            k.index = pose;
            k.report = true;
        }
        return;
    }
    const float radius = look.die_size * 0.58f;
    if (k.flying) {
        const float since = (now - k.since) / 1000.f;
        if (since < k.air) {
            // Through the air along the throw's own turn, exactly, and up and
            // down on a parabola; the air barely slows it.
            float step[9];
            mat_axis(k.axis, k.angle * since / k.air, step);
            mat_mul(step, k.from, k.rot);
            k.h = k.lift * since - 0.5f * GRAVITY * since * since;
            const float slow = expf(-look.drag * 0.25f * dt);
            k.vx *= slow;
            k.vy *= slow;
            k.x += k.vx * dt;
            k.y += k.vy * dt;
            walls(k, look.bounce);
            k.dirty = true;
            return;
        }
        // Down, turned exactly as the throw was aimed. The table takes its
        // spin: from here it rolls the way it goes, with a twist of its own.
        k.flying = false;
        float step[9];
        mat_axis(k.axis, k.angle, step);
        mat_mul(step, k.from, k.rot);
        k.h = 0;
        k.vh = k.lift * HOP_GIVE;
        k.turn[0] = k.vy / radius;
        k.turn[1] = k.vx / radius;
        k.turn[2] = (random01() - 0.5f) * 8.f;
    }
    const int steps = max(1, static_cast<int>(ceilf(dt / 0.004f)));
    const float h = dt / steps;
    for (int i = 0; i < steps; ++i) {
        // Up and down: a hop, and smaller ones as it lands.
        if (k.h > 0 || k.vh > 0) {
            k.vh -= GRAVITY * h;
            k.h += k.vh * h;
            if (k.h <= 0) { k.h = 0; k.vh = k.vh < -60.f ? -k.vh * HOP_GIVE : 0; }
        }
        const bool grounded = k.h <= 0.5f;
        // The air barely slows it; the table does, down to a stop.
        const float slow = expf(-(grounded ? look.drag : look.drag * 0.25f) * h);
        k.vx *= slow;
        k.vy *= slow;
        const float speed = sqrtf(k.vx * k.vx + k.vy * k.vy);
        if (grounded && speed > 0) {
            const float cut = fminf(speed, FRICTION * h) / speed;
            k.vx -= k.vx * cut;
            k.vy -= k.vy * cut;
        }
        k.x += k.vx * h;
        k.y += k.vy * h;
        // On the table it rolls the way it goes (y down on the key is -y in
        // the world); in the air it tumbles on as it was.
        if (grounded) {
            const float blend = fminf(1.f, 10.f * h);
            k.turn[0] += (k.vy / radius - k.turn[0]) * blend;
            k.turn[1] += (k.vx / radius - k.turn[1]) * blend;
            k.turn[2] *= expf(-2.5f * h);
        }
        const float w = sqrtf(k.turn[0] * k.turn[0] + k.turn[1] * k.turn[1] + k.turn[2] * k.turn[2]);
        if (w > 1e-4f) {
            const float axis[3] = {k.turn[0] / w, k.turn[1] / w, k.turn[2] / w};
            float step[9], next[9];
            mat_axis(axis, w * h, step);
            mat_mul(step, k.rot, next);
            memcpy(k.rot, next, sizeof next);
        }
        walls(k, look.bounce);
    }
    orthonormalize(k.rot);
    k.dirty = true;
    if (k.h <= 0 && k.vh == 0 && sqrtf(k.vx * k.vx + k.vy * k.vy) < SETTLE_SPEED) lie_down(k, now);
}
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
        x1 = max(x1, min(ax1, W - 1));
        y1 = max(y1, min(ay1, H - 1));
    }
};
// Narrow [lo, hi] to where |v0 + dv x| <= limit; false if that is nowhere.
inline bool span(float v0, float dv, float limit, float &lo, float &hi) {
    if (fabsf(dv) < 1e-6f) return fabsf(v0) <= limit;
    float a = (-limit - v0) / dv, b = (limit - v0) / dv;
    if (a > b) { const float t = a; a = b; b = t; }
    lo = fmaxf(lo, a);
    hi = fminf(hi, b);
    return lo <= hi;
}
// Its shadow on the table: the footprint, a rounded square turned `yaw`,
// seen leaning, darkened by `strength` and softened over `soft` pixels.
void shadow(uint16_t *out, float sx, float sy, float half, float yaw, float soft, float strength, Box &box) {
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
// The die: its shadow, then each face turned toward the eye, lit by how it
// faces the light, darker at its rounded edges, then its pips. Each face is
// walked row by row over just the pixels it can cover, with its shades worked
// out once; only the part the last frame drew on is put back first.
void compose_die(Key &k) {
    const Look &look = *k.look;
    uint32_t mark = micros(), faces_us = 0, pips_us = 0;
    const float tilt_s = sinf(VIEW_TILT);
    const float rest_half = look.die_size * 0.5f;
    const float half = rest_half * (1.f + k.h / HOP_SCALE);
    const float cx = k.x, cy = k.y - tilt_s * k.h;
    const float sx = k.x + 1.5f + k.h * 0.35f, sy = k.y + tilt_s * rest_half + 1.5f + k.h * 0.35f, soft = 1.5f + k.h * 0.2f;
    // Where this frame can draw - a cube seen any way stays within its
    // corners' reach, sqrt(3) half-edges - and the last frame's: those rows
    // are put back from the backdrop, then drawn on.
    Box area;
    const float reach = half * 1.7320508f + 2.f, shade_reach = rest_half * 1.42f + soft + 1.f;
    area.add(static_cast<int>(cx - reach), static_cast<int>(cy - reach), static_cast<int>(cx + reach) + 1, static_cast<int>(cy + reach) + 1);
    area.add(static_cast<int>(sx - shade_reach), static_cast<int>(sy - shade_reach), static_cast<int>(sx + shade_reach) + 1,
             static_cast<int>(sy + shade_reach) + 1);
    Box rows = area;
    if (k.fresh) rows.add(0, 0, W - 1, H - 1);
    else if (k.box[2] >= k.box[0]) rows.add(k.box[0], k.box[1], k.box[2], k.box[3]);
    k.fresh = false;
    uint16_t *out = k.frame;
    const int row_bytes = (rows.x1 - rows.x0 + 1) * 2;
    for (int y = rows.y0; y <= rows.y1; ++y) memcpy(out + y * W + rows.x0, look.backdrop + y * W + rows.x0, row_bytes);
    die_parts[0] = micros() - mark;
    mark = micros();
    Box box;
    // The shadow falls from the side most nearly level, toward the lower right.
    int level = 0;
    for (int j = 1; j < 3; ++j) if (fabsf(k.rot[6 + j]) < fabsf(k.rot[6 + level])) level = j;
    shadow(out, sx, sy, rest_half, atan2f(k.rot[3 + level], k.rot[level]), soft, fmaxf(0.25f, 0.5f - k.h / 120.f), box);
    die_parts[1] = micros() - mark;
    float view[9];
    viewed(k.rot, view);
    // Shades of the body from 0.72 to 1.12 of a face's light, for its rim and gloss.
    constexpr int SHADES = 32;
    constexpr float SHADE_LOW = 0.72f, SHADE_SPAN = 0.40f;
    for (int f = 0; f < 6; ++f) {
        float n[3], u[3], v[3], world[3];
        mat_vec(view, FACES[f].n, n);
        if (n[2] <= 0.02f) continue;
        mat_vec(view, FACES[f].u, u);
        mat_vec(view, FACES[f].v, v);
        mat_vec(k.rot, FACES[f].n, world);
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
                    if (d2 <= solid) { line[x] = pip; continue; }
                    const float cover = fminf(1.f, pip_r + 0.5f - sqrtf(d2));
                    if (cover > 0) line[x] = blend(line[x], pip, static_cast<int>(cover * 255.f));
                }
            }
        }
        pips_us += micros() - mark;
    }
    die_parts[2] = faces_us;
    die_parts[3] = pips_us;
    k.box[0] = box.x0;
    k.box[1] = box.y0;
    k.box[2] = box.x1;
    k.box[3] = box.y1;
}

// Glyphs side by side, centred on x, middle at y, faded by strength (0-256)
// and squashed by squash; only rows between top and bottom.
void text(uint16_t *out, const Size &size, const uint8_t *glyph_ids, int length, int width, float y_mid, float squash,
          int strength, uint16_t color, int top_limit, int bottom_limit) {
    const float height = size.height * squash;
    const float top = y_mid - height / 2;
    const int y0 = max(max(static_cast<int>(ceilf(top)), top_limit), 0);
    const int y1 = min(min(static_cast<int>(ceilf(top + height)), bottom_limit), H);
    const int x0 = (W - width) / 2;
    for (int y = y0; y < y1; ++y) {
        const int sy = constrain(static_cast<int>((y - top) / squash), 0, size.height - 1);
        uint16_t *line = out + y * W;
        int x = x0;
        for (int c = 0; c < length; ++c) {
            const int glyph = glyph_ids[c], w = size.widths[glyph];
            const uint8_t *alpha = size.alpha[glyph] + sy * w;
            for (int gx = 0; gx < w; ++gx) {
                const int px = x + gx;
                if (px < 0 || px >= W || !alpha[gx]) continue;
                line[px] = blend(line[px], color, (alpha[gx] * strength) >> 8);
            }
            x += w;
        }
    }
}

void spring(Key &k, float speed, uint32_t now) {
    const Look &look = *k.look;
    // Near where a spring let go at this speed would carry it, on a label -
    // or where a roll was sent.
    int target = k.forced >= 0 ? k.forced : lroundf(k.pos + speed / look.snap);
    target = constrain(target, 0, look.count - 1);
    k.target = target;
    k.a = k.pos - target;
    k.b = speed + look.snap * k.a;
    k.since = now;
    k.mode = SPRING;
}
void coast(Key &k, float speed, uint32_t now) {
    const Look &look = *k.look;
    speed = constrain(speed, -look.max_speed, look.max_speed);
    if (fabsf(speed) < SNAP_SPEED || k.pos < 0 || k.pos > look.count - 1) { spring(k, speed, now); return; }
    k.x0 = k.pos;
    k.v0 = speed;
    k.since = now;
    k.mode = GLIDE;
}
}

void begin(int image_w, int image_h) { W = image_w; H = image_h; }

bool load(uint8_t *data, size_t length, uint32_t crc) {
    if (find(crc)) { free(data); return true; }
    Look *slot = &looks[0];
    for (auto &look : looks) {
        if (!look.data) { slot = &look; break; }
        if (look.used < slot->used) slot = &look;
    }
    forget(*slot);
    slot->backdrop = image();
    if (!slot->backdrop || !parse(*slot, data, length)) {
        free(data);
        forget(*slot);
        return false;
    }
    slot->data = data;
    slot->crc = crc;
    slot->used = ++used_counter;
    return true;
}

bool known(uint32_t crc) { return find(crc) != nullptr; }

bool arm(int cell, int page, uint32_t signature, uint32_t crc, int index) {
    Look *look = find(crc);
    if (!look || cell < 0 || cell >= KEYS) return false;
    if (look->kind == DIE) {
        if (!valid_pose(index)) return false;
    } else {
        const int low = look->kind == DIAL ? look->min : 0, high = look->kind == DIAL ? look->max : look->count - 1;
        if (index < low || index > high) return false;
    }
    look->used = ++used_counter;
    Key &k = keys[cell];
    // Turning under a finger or coasting, it keeps its motion: a new look of
    // the same kind (a volume dial unmuted by the swipe) takes over in place.
    if (k.look && k.look->kind == look->kind && k.page == page && k.signature == signature && k.mode != REST) {
        k.look = look;
        return true;
    }
    if (!k.frame) k.frame = image();
    if (!k.frame) return false;
    k.look = look;
    k.page = page;
    k.signature = signature;
    k.mode = REST;
    k.pos = index;
    k.index = index;
    k.report = false;
    k.forced = -1;
    if (look->kind == DIE) set_pose(k, index);
    k.fresh = true;
    compose(cell);
    return true;
}

void disarm(int cell) {
    if (cell < 0 || cell >= KEYS) return;
    free(keys[cell].frame);
    keys[cell] = Key{};
}

void disarm_all() { for (int cell = 0; cell < KEYS; ++cell) disarm(cell); }

bool armed(int cell, int page, uint32_t signature) {
    return cell >= 0 && cell < KEYS && keys[cell].look && keys[cell].page == page && keys[cell].signature == signature;
}

const uint16_t *frame(int cell) { return cell >= 0 && cell < KEYS ? keys[cell].frame : nullptr; }

// A drum's labels sit on a drum turning about the key's width: label i, d
// labels from the band, is angle * d round it - its middle at center + r sin,
// its height squashed by cos, and faded by cos squared and by how far from
// the band. The desktop's preview uses the same sums (drumRow in
// src/shared/wheel-spec.ts). A dial takes each pixel from its highest or its
// lowest picture by the map, and writes its value in the middle.
void compose(int cell) {
    Key &k = keys[cell];
    if (!k.look || !k.frame) return;
    const uint32_t started = micros();
    const Look &look = *k.look;
    uint16_t *out = k.frame;
    if (look.kind == DIE) {
        compose_die(k);
        k.dirty = false;
    } else if (look.kind == DIAL) {
        const float share = (k.pos - look.min) / static_cast<float>(look.max - look.min);
        const uint8_t level = static_cast<uint8_t>(constrain(lroundf(share * 254.f), 0L, 254L));
        for (int i = 0; i < W * H; ++i) out[i] = look.map[i] <= level ? look.fill[i] : look.backdrop[i];
        if (look.number) {
            char digits[8];
            const int length = snprintf(digits, sizeof digits, "%d", static_cast<int>(lroundf(k.pos)));
            uint8_t ids[8];
            int width = 0;
            for (int c = 0; c < length; ++c) { ids[c] = glyph_of(look.size[0], digits[c]); width += look.size[0].widths[ids[c]]; }
            text(out, look.size[0], ids, length, width, look.text_y, 1.f, 256, look.color, 0, H);
        }
    } else {
        memcpy(out, look.backdrop, W * H * 2);
        const float radius = look.row / look.angle;
        const int first = max(0, static_cast<int>(floorf(k.pos)) - 3);
        const int last = min(look.count - 1, static_cast<int>(floorf(k.pos)) + 4);
        for (int i = first; i <= last; ++i) {
            const float d = i - k.pos, theta = d * look.angle;
            if (fabsf(theta) >= 1.45f) continue;
            const float squash = cosf(theta);
            const float fade = squash * squash * (1.f - look.fade * fminf(1.f, fabsf(d)));
            const int strength = static_cast<int>(fade * 256.f);
            if (strength <= 0) continue;
            const Label &label = look.labels[i];
            text(out, look.size[label.size], label.glyphs, label.length, label.width, look.center + radius * sinf(theta),
                 squash, strength, look.color, look.clip_top, look.clip_bottom);
        }
    }
    k.drawn = k.pos;
    k.composed_ms = millis();
    last_compose = micros() - started;
    ++composed_frames;
}

void touch(int cell, int y, uint32_t now, bool landed) {
    // A die is thrown by a tap, which the desktop turns into a roll.
    if (cell < 0 || cell >= KEYS || !keys[cell].look || keys[cell].look->kind == DIE) return;
    Key &k = keys[cell];
    const Look &look = *k.look;
    if (landed) {
        k.mode = DRAG;
        k.grab_y = y;
        k.grab_pos = k.pos;
        k.samples = 0;
        k.forced = -1;
    }
    if (k.mode != DRAG) return;
    if (look.kind == DIAL) {
        // Up is more, a step every unit_px of finger; no further than the ends.
        k.pos = constrain(k.grab_pos + (k.grab_y - y) / look.unit_px, static_cast<float>(look.min), static_cast<float>(look.max));
        const int value = lroundf(k.pos);
        if (value != k.index) { k.index = value; k.report = true; }
        return;
    }
    // Up is more: the numbers follow the finger, one label per row of pixels.
    const float raw = k.grab_pos + static_cast<float>(k.grab_y - y) / look.row;
    const float last = look.count - 1;
    k.pos = raw < 0 ? raw * look.rubber : raw > last ? last + (raw - last) * look.rubber : raw;
    if (k.samples && now - k.sample_t[0] < SAMPLE_GAP_MS) return;
    for (int i = SAMPLES - 1; i > 0; --i) { k.sample_t[i] = k.sample_t[i - 1]; k.sample_p[i] = k.sample_p[i - 1]; }
    k.sample_t[0] = now;
    k.sample_p[0] = k.pos;
    if (k.samples < SAMPLES) ++k.samples;
}

void release(int cell, uint32_t now) {
    if (cell < 0 || cell >= KEYS || !keys[cell].look || keys[cell].mode != DRAG) return;
    Key &k = keys[cell];
    if (k.look->kind == DIAL) {
        // The last value goes at once, however soon after the one before.
        k.mode = REST;
        k.reported_ms = 0;
        return;
    }
    float speed = 0;
    if (k.samples >= 2 && now - k.sample_t[0] < LIFT_MS) {
        int oldest = 0;
        for (int i = 1; i < k.samples; ++i) if (now - k.sample_t[i] <= SAMPLE_MS) oldest = i;
        const uint32_t span = k.sample_t[0] - k.sample_t[oldest];
        if (span >= SAMPLE_GAP_MS) speed = (k.sample_p[0] - k.sample_p[oldest]) * 1000.f / span;
    }
    coast(k, speed, now);
}

void roll(int cell, int target, uint32_t now) {
    if (cell < 0 || cell >= KEYS || !keys[cell].look || keys[cell].look->kind == DIAL) return;
    Key &k = keys[cell];
    const Look &look = *k.look;
    if (look.kind == DIE) {
        // Thrown from where it is, any way; a throw while it rolls throws it
        // again. How it is turned when it comes down is picked evenly among
        // all turns (a random unit quaternion, Shoemake's way) and reached
        // along its own axis with one or two whole turns more. That, and the
        // cube's symmetry from there on, make every face come up as often -
        // a spin about a random axis by a random angle would not.
        const float heading = random01() * 2.f * PI, speed = look.speed * (0.8f + 0.4f * random01());
        k.vx = cosf(heading) * speed;
        k.vy = sinf(heading) * speed;
        const float u1 = random01(), u2 = random01() * 2.f * PI, u3 = random01() * 2.f * PI;
        float qx = sqrtf(1.f - u1) * sinf(u2), qy = sqrtf(1.f - u1) * cosf(u2), qz = sqrtf(u1) * sinf(u3),
              qw = sqrtf(u1) * cosf(u3);
        if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
        const float half = acosf(fminf(1.f, qw)), sh = sinf(half);
        if (sh > 1e-5f) { k.axis[0] = qx / sh; k.axis[1] = qy / sh; k.axis[2] = qz / sh; }
        else { k.axis[0] = 0; k.axis[1] = 0; k.axis[2] = 1; }
        k.angle = 2.f * half + 2.f * PI * (1 + (esp_random() & 1));
        memcpy(k.from, k.rot, sizeof k.from);
        k.lift = look.hop * (0.8f + 0.4f * random01());
        k.air = 2.f * k.lift / GRAVITY;
        k.h = 0;
        k.vh = 0;
        k.flying = true;
        k.mode = ROLL;
        k.since = now;
        k.last_ms = now;
        k.dirty = true;
        return;
    }
    k.forced = constrain(target, 0, look.count - 1);
    // The glide alone would carry it fling * speed labels: aim it at the label,
    // and the spring lands it there.
    k.x0 = k.pos;
    k.v0 = constrain((k.forced - k.pos) / look.fling, -look.max_speed, look.max_speed);
    k.since = now;
    k.mode = fabsf(k.v0) < SNAP_SPEED ? SPRING : GLIDE;
    if (k.mode == SPRING) spring(k, 0, now);
}

uint16_t tick(uint32_t now) {
    uint16_t due = 0;
    for (int cell = 0; cell < KEYS; ++cell) {
        Key &k = keys[cell];
        if (!k.look) continue;
        const Look &look = *k.look;
        if (look.kind == DIE) {
            if (k.mode == ROLL || k.mode == SETTLE) {
                roll_die(k, fminf(0.05f, (now - k.last_ms) / 1000.f), now);
                k.last_ms = now;
            }
            if (k.dirty && now - k.composed_ms >= DIE_FRAME_MS) due |= 1 << cell;
            continue;
        }
        if (k.mode == GLIDE) {
            const float t = (now - k.since) / 1000.f, decay = expf(-t / look.fling);
            k.pos = k.x0 + k.v0 * look.fling * (1.f - decay);
            const float speed = k.v0 * decay;
            if (fabsf(speed) < SNAP_SPEED || k.pos < 0 || k.pos > look.count - 1) spring(k, speed, now);
        } else if (k.mode == SPRING) {
            const float t = (now - k.since) / 1000.f, decay = expf(-look.snap * t);
            const float offset = (k.a + k.b * t) * decay;
            const float speed = (k.b - look.snap * (k.a + k.b * t)) * decay;
            if (fabsf(offset) < REST_OFFSET && fabsf(speed) < REST_SPEED) {
                k.pos = k.target;
                k.mode = REST;
                k.forced = -1;
                if (k.target != k.index) { k.index = k.target; k.report = true; }
            } else k.pos = k.target + offset;
        }
        // A new picture once a drum's numbers moved a quarter of a pixel, or a
        // dial a fifth of a step.
        const float moved = fabsf(k.pos - k.drawn);
        if ((look.kind == DIAL ? moved >= 0.2f : moved * look.row >= 0.25f) && now - k.composed_ms >= FRAME_MS)
            due |= 1 << cell;
    }
    return due;
}

int settled(int cell) {
    if (cell < 0 || cell >= KEYS || !keys[cell].report || !keys[cell].look || keys[cell].look->kind == DIAL) return -1;
    keys[cell].report = false;
    return keys[cell].index;
}

int value(int cell, uint32_t now) {
    if (cell < 0 || cell >= KEYS || !keys[cell].report || !keys[cell].look || keys[cell].look->kind != DIAL) return INT_MIN;
    Key &k = keys[cell];
    if (k.mode == DRAG && now - k.reported_ms < VALUE_MS) return INT_MIN;
    k.report = false;
    k.reported_ms = now;
    return k.index;
}

void spin(int cell, float rows_per_s, uint32_t now) {
    if (cell >= 0 && cell < KEYS && keys[cell].look && keys[cell].look->kind == DRUM) coast(keys[cell], rows_per_s, now);
}

uint32_t compose_us() { return last_compose; }

const uint32_t *die_us() { return die_parts; }


uint32_t frames() { return composed_frames; }
}
