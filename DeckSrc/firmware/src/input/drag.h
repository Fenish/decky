#pragma once
#include <stdint.h>

// Finger movement on keys the desktop named with DRAG (the keys a finger
// turns there): `EV <page> <cell> MOVE <y>`, the finger's height inside the
// key, at once when it lands, then each time it has moved 2 px, at most every
// 20 ms. Only those keys: a desktop that never sent DRAG never sees a MOVE
// line, and apps from before it hand a line they don't know to the command
// waiting for its reply.
class DragReport {
public:
    // The keys to report on: 15 bits, one per key; 0 for none.
    void set(unsigned int mask) { mask_ = mask & 0x7FFF; }
    void clear() { mask_ = 0; }
    bool wants(int cell) const { return mask_ & (1 << cell); }
    void report(int page, int cell, int inside, uint32_t now, bool first);

private:
    uint16_t mask_ = 0;
    int sent_y_ = 0;
    uint32_t sent_ms_ = 0;
};
