#pragma once
#include <stddef.h>
#include <stdint.h>

// The size of a key's picture as the desktop sends it: the first key's
// opening, measured once at start-up. Every page's keys, live pictures and
// animation frames are this size (RGB565); openings a pixel off after
// rounding are mapped onto it when drawn.
class KeyImage {
public:
    static void set(int width, int height) {
        width_ = width;
        height_ = height;
    }
    static int width() { return width_; }
    static int height() { return height_; }
    static size_t pixels() { return static_cast<size_t>(width_) * height_; }
    static size_t bytes() { return pixels() * sizeof(uint16_t); }

private:
    static inline int width_ = 0;
    static inline int height_ = 0;
};
