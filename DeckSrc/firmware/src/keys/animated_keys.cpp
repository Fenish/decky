// Frames are composed in keys/, 60 a second, beside the panel's scanout:
// speed over size. fast-math lets min, max and square roots be single FPU
// steps.
#pragma GCC optimize("O2", "fast-math")
#include "keys/animated_keys.h"
#include <Arduino.h>
#include "common/key_image.h"
#include "common/memory.h"

namespace keys {
Look *AnimatedKeys::find(uint32_t crc) const {
    for (Look *look : looks_)
        if (look && look->crc == crc) return look;
    return nullptr;
}

void AnimatedKeys::drop(int slot) {
    Look *look = looks_[slot];
    if (!look) return;
    for (int cell = 0; cell < KEYS; ++cell)
        if (keys_[cell] && &keys_[cell]->look() == look) disarm(cell);
    delete look;
    looks_[slot] = nullptr;
}

bool AnimatedKeys::in_use(const Look *look) const {
    for (KeyAnimation *key : keys_)
        if (key && &key->look() == look) return true;
    return false;
}

int AnimatedKeys::unused_slot() const {
    int slot = -1;
    for (int i = 0; i < LOOKS; ++i)
        if (looks_[i] && !in_use(looks_[i]) && (slot < 0 || looks_[i]->used < looks_[slot]->used)) slot = i;
    return slot;
}

AnimatedKeys::Loaded AnimatedKeys::load(uint8_t *data, size_t length, uint32_t crc) {
    if (find(crc)) {
        free(data);
        return Loaded::Kept;
    }
    // Its backdrop must leave a page's worth whole: unused looks go until it
    // does, least lately armed first.
    const size_t key = KeyImage::bytes();
    while (!memory::spare(key, key * KEYS)) {
        const int unused = unused_slot();
        if (unused < 0) {
            free(data);
            return Loaded::NoRoom;
        }
        drop(unused);
    }
    // An empty slot, else the unused look armed least lately. With a slot for
    // every key and one more, there always is one.
    int slot = -1;
    for (int i = 0; i < LOOKS && slot < 0; ++i)
        if (!looks_[i]) slot = i;
    if (slot < 0) slot = unused_slot();
    if (slot < 0) {
        free(data);
        return Loaded::NoRoom;
    }
    drop(slot);
    Look *look = Look::parse(data, length);
    if (!look) return Loaded::Malformed;
    look->crc = crc;
    look->used = ++used_counter_;
    looks_[slot] = look;
    return Loaded::Kept;
}

bool AnimatedKeys::arm(int cell, int page, uint32_t signature, uint32_t crc, int index) {
    Look *look = find(crc);
    if (!look || cell < 0 || cell >= KEYS || !look->accepts(index)) return false;
    look->used = ++used_counter_;
    KeyAnimation *current = keys_[cell];
    // Turning under a finger or coasting, it keeps its motion: a new look of
    // the same kind (a volume dial unmuted by the swipe) takes over in place.
    if (current && current->look().kind() == look->kind() && current->page == page &&
        current->signature == signature && current->moving()) {
        current->relook(*look);
        return true;
    }
    if (!frames_[cell]) frames_[cell] = memory::pixels(KeyImage::pixels());
    if (!frames_[cell]) return false;
    KeyAnimation *next = look->animate(index, frames_[cell]);
    if (!next) return false;
    delete current;
    keys_[cell] = next;
    next->page = page;
    next->signature = signature;
    compose(cell);
    return true;
}

void AnimatedKeys::disarm(int cell) {
    if (cell < 0 || cell >= KEYS) return;
    delete keys_[cell];
    keys_[cell] = nullptr;
    free(frames_[cell]);
    frames_[cell] = nullptr;
}

void AnimatedKeys::disarm_all() {
    for (int cell = 0; cell < KEYS; ++cell) disarm(cell);
}

bool AnimatedKeys::armed(int cell, int page, uint32_t signature) const {
    const KeyAnimation *key = at(cell);
    return key && key->page == page && key->signature == signature;
}

void AnimatedKeys::compose(int cell) {
    KeyAnimation *key = at(cell);
    if (!key) return;
    const uint32_t started = micros();
    key->compose();
    key->composed_ms = millis();
    last_compose_ = micros() - started;
    ++composed_frames_;
}

void AnimatedKeys::touch(int cell, int y, uint32_t now, bool landed) {
    if (KeyAnimation *key = at(cell)) key->touch(y, now, landed);
}

void AnimatedKeys::release(int cell, uint32_t now) {
    if (KeyAnimation *key = at(cell)) key->release(now);
}

uint16_t AnimatedKeys::tick(uint32_t now) {
    uint16_t due = 0;
    for (int cell = 0; cell < KEYS; ++cell)
        if (keys_[cell] && keys_[cell]->tick(now)) due |= 1 << cell;
    return due;
}

int AnimatedKeys::settled(int cell) {
    KeyAnimation *key = at(cell);
    return key ? key->settled() : -1;
}

int AnimatedKeys::value(int cell, uint32_t now) {
    KeyAnimation *key = at(cell);
    return key ? key->value(now) : INT_MIN;
}

void AnimatedKeys::roll(int cell, int target, uint32_t now) {
    if (KeyAnimation *key = at(cell)) key->roll(target, now);
}

void AnimatedKeys::spin(int cell, float rows_per_s, uint32_t now) {
    if (KeyAnimation *key = at(cell)) key->spin(rows_per_s, now);
}
}  // namespace keys
