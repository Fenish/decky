#pragma once
#include <esp_heap_caps.h>
#include <stddef.h>
#include <stdint.h>

// Pictures live in PSRAM (8 MB); internal RAM is kept for the code's own use.
namespace memory {
// What is always left free in PSRAM, for transfers and the system.
constexpr size_t FLOOR = 768 * 1024;

inline void *psram(size_t bytes) { return heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); }
inline uint16_t *pixels(size_t count) { return static_cast<uint16_t *>(psram(count * sizeof(uint16_t))); }
inline size_t free_bytes() { return heap_caps_get_free_size(MALLOC_CAP_SPIRAM); }
inline size_t largest_block() { return heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM); }
}  // namespace memory
