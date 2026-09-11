#pragma once
#include "keys/key_animation.h"
#include "keys/look.h"

namespace keys {
// A die the deck draws in 3D and throws: a tap (turned into WHEELROLL by the
// desktop) sends it tumbling through the air, hopping, bouncing off the
// key's edges and rolling the way it goes, until it lies flat wherever it
// stops. Its "label" is how it lies - face 0-5, where (x, y in 128ths of the
// key) and its turn (yaw, degrees) - packed in one int:
// face + 8 (x + 128 (y + 128 yaw)). src/shared/die.ts holds the same sums.
// Look version 3:
//   u8 edge (px), u16 body colour, u16 pip colour (RGB565), u16 speed (px/s),
//   u16 hop (px/s up), u16 drag (1/100 per s), u8 bounce (%), then the key
//   under it (a LIVE patch of the whole key).
class DieLook : public Look {
public:
    Kind kind() const override { return Kind::Die; }
    bool accepts(int index) const override;
    KeyAnimation *animate(int index, uint16_t *frame) const override;

    // Its edge in pixels, body and pip colours; how hard a roll throws it
    // (px/s), how high (px/s up), how soon it slows (1/s) and what a wall
    // gives back.
    float size = 0, speed = 0, hop = 0, drag = 0, bounce = 0;
    uint16_t color = 0, pip = 0;

protected:
    bool read(ByteReader &r) override;
};

class Die : public KeyAnimation {
public:
    Die(const DieLook &look, int pose, uint16_t *frame);
    bool moving() const override { return mode_ != REST; }
    bool tick(uint32_t now) override;
    void compose() override;
    void roll(int target, uint32_t now) override;
    int settled() override;
    // The last frame's parts (us): putting back, shadow, faces, pips.
    static const uint32_t *timings() { return parts_; }

private:
    enum Mode : uint8_t { REST, ROLL, SETTLE };
    const DieLook &die() const { return static_cast<const DieLook &>(*look_); }
    // Lying still with the pose's face up, where and turned as it says.
    void set_pose(int pose);
    int pose() const;
    // How far it reaches from its middle across and down the key, as seen.
    void reach(float half, float &ex, float &ey) const;
    // Kept inside the key: a wall sends it back with `give` of its speed.
    void walls(float give);
    // Down onto the nearest face, over SETTLE_MS.
    void lie_down(uint32_t now);
    // The throw, the table, and lying down, `dt` seconds on.
    void move(float dt, uint32_t now);

    Mode mode_ = REST;
    int index_ = 0;  // how it lies, as the desktop knows
    bool report_ = false;
    // Where it is (px, y down), how fast it goes, how high it is and rises;
    // how it is turned (row-major, world x right, y up, z toward the eye) and
    // turning (rad/s about world axes). Lying down: the turn left, about
    // `axis`, from `from`, onto `face`.
    float x_ = 0, y_ = 0, vx_ = 0, vy_ = 0, h_ = 0, vh_ = 0;
    float rot_[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    float turn_[3] = {};
    float from_[9] = {}, axis_[3] = {}, angle_ = 0;
    int face_ = 0;
    // Thrown: the tumble through the air, `angle` about `axis` from `from`
    // over `air` seconds, up at `lift` px/s.
    bool flying_ = false;
    float air_ = 0, lift_ = 0;
    uint32_t since_ = 0, last_ms_ = 0;
    bool dirty_ = false;
    // The part of its frame the die drew on last; `fresh` puts back all of it.
    int box_[4] = {0, 0, -1, -1};
    bool fresh_ = true;
    static inline uint32_t parts_[4] = {};
};
}  // namespace keys
