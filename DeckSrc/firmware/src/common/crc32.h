#pragma once
#include <stddef.h>
#include <stdint.h>

// CRC-32 (IEEE, as zlib and the desktop compute it): pages are named by the
// CRC of their pictures, and every transfer is checked with one.
uint32_t crc32(const uint8_t *data, size_t length);
