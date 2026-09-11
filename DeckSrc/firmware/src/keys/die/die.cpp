// The die's physics, 60 times a second beside the scanout: speed over size,
// and fast-math lets min, max and square roots be single FPU steps.
#pragma GCC optimize("O2", "fast-math")
#include "keys/die/die.h"
#include <Arduino.h>
#include <esp_system.h>
#include <math.h>
#include <new>
#include "common/key_image.h"
#include "keys/die/die_shape.h"
#include "keys/die/rotation.h"

namespace keys {
using namespace die_shape;

namespace {
// How it moves: pixels a second squared down, what a landing gives back of a
// hop, how slow it lies down, how the table slows it besides its drag
// (px/s^2), and its gap to the key's edge.
constexpr float GRAVITY = 1500.f, HOP_GIVE = 0.4f, SETTLE_SPEED = 45.f, FRICTION = 90.f, EDGE = 2.f;
constexpr uint32_t SETTLE_MS = 260, DIE_FRAME_MS = 12;

float random01() { return esp_random() / 4294967296.f; }
}  // namespace

// Every number bounded: the physics has no clamp of its own, and a throw of
// 65535 px/s or a hop that long would send the die off into numbers no pixel
// loop is ready for.
bool DieLook::read(ByteReader &r) {
    size = r.u8();
    color = r.u16();
    pip = r.u16();
    speed = r.u16();
    hop = r.u16();
    drag = r.u16() / 100.f;
    bounce = r.u8() / 100.f;
    if (!r.ok || size < 12 || size > min(KeyImage::width(), KeyImage::height()) / 2 || speed <= 0 || speed > 3000 ||
        hop < 20 || hop > 800 || drag <= 0 || drag > 20 || bounce > 1.f)
        return false;
    memset(backdrop_, 0, KeyImage::bytes());
    if (!picture(r, backdrop_)) return false;
    return r.at == r.length;
}

// A die lying with `face` up, turned `yaw` degrees, at (x, y) in 128ths of
// the key: packed face + 8 (x + 128 (y + 128 yaw)).
bool DieLook::accepts(int pose) const { return pose >= 0 && (pose & 7) <= 5 && (pose >> 17) <= 359; }

KeyAnimation *DieLook::animate(int pose, uint16_t *frame) const {
    return new (std::nothrow) Die(*this, pose, frame);
}

Die::Die(const DieLook &look, int pose, uint16_t *frame) : KeyAnimation(look, frame), index_(pose) { set_pose(pose); }

void Die::set_pose(int pose) {
    const int W = KeyImage::width(), H = KeyImage::height();
    const int face = pose & 7, x = (pose >> 3) & 127, y = (pose >> 10) & 127, yaw = pose >> 17;
    const float t = yaw * (PI / 180.f), c = cosf(t), s = sinf(t);
    const float spin[9] = {c, -s, 0, s, c, 0, 0, 0, 1};
    const Face &f = FACES[face];
    // Rows u, v, n: the face's axes onto x and y, its normal onto z.
    const float lying[9] = {static_cast<float>(f.u[0]), static_cast<float>(f.u[1]), static_cast<float>(f.u[2]),
                            static_cast<float>(f.v[0]), static_cast<float>(f.v[1]), static_cast<float>(f.v[2]),
                            static_cast<float>(f.n[0]), static_cast<float>(f.n[1]), static_cast<float>(f.n[2])};
    rotation::multiply(spin, lying, rot_);
    x_ = x * (W - 1) / 127.f;
    y_ = y * (H - 1) / 127.f;
    vx_ = vy_ = h_ = vh_ = 0;
    turn_[0] = turn_[1] = turn_[2] = 0;
    face_ = face;
    dirty_ = true;
}

int Die::pose() const {
    const int W = KeyImage::width(), H = KeyImage::height();
    float u[3];
    rotation::apply(rot_, FACES[face_].u, u);
    int yaw = static_cast<int>(lroundf(atan2f(u[1], u[0]) * 180.f / PI));
    yaw = (yaw % 360 + 360) % 360;
    const int x = constrain(static_cast<int>(lroundf(x_ * 127.f / (W - 1))), 0, 127);
    const int y = constrain(static_cast<int>(lroundf(y_ * 127.f / (H - 1))), 0, 127);
    return face_ + 8 * (x + 128 * (y + 128 * yaw));
}

void Die::reach(float half, float &ex, float &ey) const {
    float view[9];
    viewed(rot_, view);
    ex = half * (fabsf(view[0]) + fabsf(view[1]) + fabsf(view[2]));
    ey = half * (fabsf(view[3]) + fabsf(view[4]) + fabsf(view[5]));
}

// On the table a wall also gives a little hop and a new spin about the
// vertical. In the air it meets the walls as a ball would, so its path does
// not depend on how it is turned - part of what keeps the throw fair.
void Die::walls(float give) {
    const int W = KeyImage::width(), H = KeyImage::height();
    const float half = die().size * 0.5f * (1.f + h_ / HOP_SCALE);
    float ex = half * 1.7320508f, ey = ex;
    if (!flying_) reach(half, ex, ey);
    const float lift = sinf(VIEW_TILT) * h_;
    bool hit = false;
    if (x_ - ex < EDGE) {
        x_ = EDGE + ex;
        if (vx_ < 0) {
            vx_ = -vx_ * give;
            hit = true;
        }
    }
    if (x_ + ex > W - EDGE) {
        x_ = W - EDGE - ex;
        if (vx_ > 0) {
            vx_ = -vx_ * give;
            hit = true;
        }
    }
    if (y_ - lift - ey < EDGE) {
        y_ = EDGE + ey + lift;
        if (vy_ < 0) {
            vy_ = -vy_ * give;
            hit = true;
        }
    }
    if (y_ - lift + ey > H - EDGE) {
        y_ = H - EDGE - ey + lift;
        if (vy_ > 0) {
            vy_ = -vy_ * give;
            hit = true;
        }
    }
    if (hit && mode_ == ROLL && !flying_) {
        turn_[2] += (random01() - 0.5f) * 12.f;
        if (h_ <= 0.5f) vh_ = fmaxf(vh_, 40.f + 40.f * random01());
    }
}

// The axis pointing most nearly up is turned the short way onto straight up.
void Die::lie_down(uint32_t now) {
    int best = 0;
    for (int j = 1; j < 3; ++j)
        if (fabsf(rot_[6 + j]) > fabsf(rot_[6 + best])) best = j;
    const float sign = rot_[6 + best] > 0 ? 1.f : -1.f;
    const float up[3] = {rot_[best] * sign, rot_[3 + best] * sign, rot_[6 + best] * sign};
    // Local +z is face 1, -z 6; +x 2, -x 5; +y 3, -y 4.
    static constexpr int FACE_OF[3][2] = {{1, 4}, {2, 3}, {0, 5}};
    face_ = FACE_OF[best][sign > 0 ? 0 : 1];
    const float length = sqrtf(up[0] * up[0] + up[1] * up[1]);
    angle_ = acosf(constrain(up[2], -1.f, 1.f));
    if (length > 1e-5f) {
        axis_[0] = up[1] / length;
        axis_[1] = -up[0] / length;
    } else {
        axis_[0] = 1;
        axis_[1] = 0;
        angle_ = 0;
    }
    axis_[2] = 0;
    memcpy(from_, rot_, sizeof from_);
    since_ = now;
    mode_ = SETTLE;
}

void Die::move(float dt, uint32_t now) {
    const DieLook &look = die();
    if (mode_ == SETTLE) {
        const float t = fminf(1.f, (now - since_) / static_cast<float>(SETTLE_MS));
        const float ease = 1.f - (1.f - t) * (1.f - t) * (1.f - t);
        float step[9];
        rotation::about(axis_, angle_ * ease, step);
        rotation::multiply(step, from_, rot_);
        const float slow = expf(-8.f * dt);
        vx_ *= slow;
        vy_ *= slow;
        x_ += vx_ * dt;
        y_ += vy_ * dt;
        walls(look.bounce);
        dirty_ = true;
        if (t >= 1.f) {
            // Lying exactly as the pose it reports says, as arming it there would.
            const int lying = pose();
            set_pose(lying);
            mode_ = REST;
            index_ = lying;
            report_ = true;
        }
        return;
    }
    const float radius = look.size * 0.58f;
    if (flying_) {
        const float since = (now - since_) / 1000.f;
        if (since < air_) {
            // Through the air along the throw's own turn, exactly, and up and
            // down on a parabola; the air barely slows it.
            float step[9];
            rotation::about(axis_, angle_ * since / air_, step);
            rotation::multiply(step, from_, rot_);
            h_ = lift_ * since - 0.5f * GRAVITY * since * since;
            const float slow = expf(-look.drag * 0.25f * dt);
            vx_ *= slow;
            vy_ *= slow;
            x_ += vx_ * dt;
            y_ += vy_ * dt;
            walls(look.bounce);
            dirty_ = true;
            return;
        }
        // Down, turned exactly as the throw was aimed. The table takes its
        // spin: from here it rolls the way it goes, with a twist of its own.
        flying_ = false;
        float step[9];
        rotation::about(axis_, angle_, step);
        rotation::multiply(step, from_, rot_);
        h_ = 0;
        vh_ = lift_ * HOP_GIVE;
        turn_[0] = vy_ / radius;
        turn_[1] = vx_ / radius;
        turn_[2] = (random01() - 0.5f) * 8.f;
    }
    const int steps = max(1, static_cast<int>(ceilf(dt / 0.004f)));
    const float h = dt / steps;
    for (int i = 0; i < steps; ++i) {
        // Up and down: a hop, and smaller ones as it lands.
        if (h_ > 0 || vh_ > 0) {
            vh_ -= GRAVITY * h;
            h_ += vh_ * h;
            if (h_ <= 0) {
                h_ = 0;
                vh_ = vh_ < -60.f ? -vh_ * HOP_GIVE : 0;
            }
        }
        const bool grounded = h_ <= 0.5f;
        // The air barely slows it; the table does, down to a stop.
        const float slow = expf(-(grounded ? look.drag : look.drag * 0.25f) * h);
        vx_ *= slow;
        vy_ *= slow;
        const float speed = sqrtf(vx_ * vx_ + vy_ * vy_);
        if (grounded && speed > 0) {
            const float cut = fminf(speed, FRICTION * h) / speed;
            vx_ -= vx_ * cut;
            vy_ -= vy_ * cut;
        }
        x_ += vx_ * h;
        y_ += vy_ * h;
        // On the table it rolls the way it goes (y down on the key is -y in
        // the world); in the air it tumbles on as it was.
        if (grounded) {
            const float blend = fminf(1.f, 10.f * h);
            turn_[0] += (vy_ / radius - turn_[0]) * blend;
            turn_[1] += (vx_ / radius - turn_[1]) * blend;
            turn_[2] *= expf(-2.5f * h);
        }
        const float w = sqrtf(turn_[0] * turn_[0] + turn_[1] * turn_[1] + turn_[2] * turn_[2]);
        if (w > 1e-4f) {
            const float axis[3] = {turn_[0] / w, turn_[1] / w, turn_[2] / w};
            float step[9], next[9];
            rotation::about(axis, w * h, step);
            rotation::multiply(step, rot_, next);
            memcpy(rot_, next, sizeof next);
        }
        walls(look.bounce);
    }
    rotation::orthonormalize(rot_);
    dirty_ = true;
    if (h_ <= 0 && vh_ == 0 && sqrtf(vx_ * vx_ + vy_ * vy_) < SETTLE_SPEED) lie_down(now);
}

bool Die::tick(uint32_t now) {
    if (mode_ == ROLL || mode_ == SETTLE) {
        move(fminf(0.05f, (now - last_ms_) / 1000.f), now);
        last_ms_ = now;
    }
    return dirty_ && now - composed_ms >= DIE_FRAME_MS;
}

// Thrown from where it is, any way; a throw while it rolls throws it again.
// How it is turned when it comes down is picked evenly among all turns (a
// random unit quaternion, Shoemake's way) and reached along its own axis with
// one or two whole turns more. That, and the cube's symmetry from there on,
// make every face come up as often - a spin about a random axis by a random
// angle would not.
void Die::roll(int, uint32_t now) {
    const DieLook &look = die();
    const float heading = random01() * 2.f * PI, speed = look.speed * (0.8f + 0.4f * random01());
    vx_ = cosf(heading) * speed;
    vy_ = sinf(heading) * speed;
    const float u1 = random01(), u2 = random01() * 2.f * PI, u3 = random01() * 2.f * PI;
    float qx = sqrtf(1.f - u1) * sinf(u2), qy = sqrtf(1.f - u1) * cosf(u2), qz = sqrtf(u1) * sinf(u3),
          qw = sqrtf(u1) * cosf(u3);
    if (qw < 0) {
        qx = -qx;
        qy = -qy;
        qz = -qz;
        qw = -qw;
    }
    const float half = acosf(fminf(1.f, qw)), sh = sinf(half);
    if (sh > 1e-5f) {
        axis_[0] = qx / sh;
        axis_[1] = qy / sh;
        axis_[2] = qz / sh;
    } else {
        axis_[0] = 0;
        axis_[1] = 0;
        axis_[2] = 1;
    }
    angle_ = 2.f * half + 2.f * PI * (1 + (esp_random() & 1));
    memcpy(from_, rot_, sizeof from_);
    lift_ = look.hop * (0.8f + 0.4f * random01());
    air_ = 2.f * lift_ / GRAVITY;
    h_ = 0;
    vh_ = 0;
    flying_ = true;
    mode_ = ROLL;
    since_ = now;
    last_ms_ = now;
    dirty_ = true;
}

int Die::settled() {
    if (!report_) return -1;
    report_ = false;
    return index_;
}
}  // namespace keys
