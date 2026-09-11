#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

// 3x3 rotations for the die, row-major. The die's sums run 60 times a second
// beside the scanout, so these stay small and inline.
namespace keys::rotation {
inline void multiply(const float *a, const float *b, float *out) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
}
// A turn of `angle` about the unit `axis` (Rodrigues).
inline void about(const float *axis, float angle, float *out) {
    const float c = cosf(angle), s = sinf(angle), t = 1 - c, x = axis[0], y = axis[1], z = axis[2];
    const float m[9] = {t * x * x + c,     t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c,
                        t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c};
    memcpy(out, m, sizeof m);
}
inline void apply(const float *m, const int8_t *v, float *out) {
    for (int i = 0; i < 3; ++i) out[i] = m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2];
}
// Keep a rotation a rotation as float errors pile up: rows made orthonormal.
inline void orthonormalize(float *m) {
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
}  // namespace keys::rotation
