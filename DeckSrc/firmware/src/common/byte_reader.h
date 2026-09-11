#pragma once
#include <stddef.h>
#include <stdint.h>

// Reads what the desktop sent, little-endian, never past its end: a read past
// it returns 0 and leaves `ok` false, so a parser checks once at the end
// instead of before every field.
struct ByteReader {
    const uint8_t *data;
    size_t length, at = 0;
    bool ok = true;
    const uint8_t *take(size_t n) {
        if (!ok || at + n > length) {
            ok = false;
            return nullptr;
        }
        const uint8_t *p = data + at;
        at += n;
        return p;
    }
    uint8_t u8() {
        const uint8_t *p = take(1);
        return p ? p[0] : 0;
    }
    uint16_t u16() {
        const uint8_t *p = take(2);
        return p ? p[0] | (p[1] << 8) : 0;
    }
    uint32_t u32() {
        const uint8_t *p = take(4);
        return p ? p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24) : 0;
    }
};
