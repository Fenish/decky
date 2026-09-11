#include "pages/page.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "common/memory.h"

namespace {
// Room for one more live picture that still leaves the floor free and a whole
// page in one piece: live pictures must never be why a page cannot be built.
bool live_room() {
    const size_t key = KeyImage::bytes(), page = key * Page::KEYS;
    return memory::free_bytes() >= key + page + memory::FLOOR && memory::largest_block() >= key + page;
}
}  // namespace

uint16_t *Page::own(int cell) const { return pixels + KeyImage::pixels() * cell; }

uint16_t *Page::shown_off(int cell) const { return live[cell] ? live[cell] : own(cell); }

uint16_t *Page::new_live(int cell) {
    if (!live_room()) return nullptr;
    live[cell] = memory::pixels(KeyImage::pixels());
    return live[cell];
}

void Page::drop_live(int cell) {
    free(live[cell]);
    live[cell] = nullptr;
    delete texts[cell];
    texts[cell] = nullptr;
}

void Page::drop_lives() {
    for (int cell = 0; cell < KEYS; ++cell) drop_live(cell);
}

void Page::drop_alternates() {
    for (int cell = 0; cell < KEYS; ++cell) {
        free(alternates[cell]);
        alternates[cell] = nullptr;
        alternate_crc[cell] = 0;
    }
}
