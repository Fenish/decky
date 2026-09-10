#include "secure_link.h"

namespace {
void nonce(uint8_t iv[12], uint32_t direction, uint64_t counter) {
    for (int i = 0; i < 4; ++i) iv[i] = static_cast<uint8_t>(direction >> (24 - 8 * i));
    for (int i = 0; i < 8; ++i) iv[4 + i] = static_cast<uint8_t>(counter >> (56 - 8 * i));
}
}

void SecureLink::begin(const uint8_t send_key[16], const uint8_t receive_key[16]) {
    reset();
    mbedtls_gcm_init(&send_);
    mbedtls_gcm_init(&receive_);
    if (mbedtls_gcm_setkey(&send_, MBEDTLS_CIPHER_ID_AES, send_key, 128) != 0 ||
        mbedtls_gcm_setkey(&receive_, MBEDTLS_CIPHER_ID_AES, receive_key, 128) != 0) {
        mbedtls_gcm_free(&send_);
        mbedtls_gcm_free(&receive_);
        failed_ = true;
        return;
    }
    keyed_ = true;
}

void SecureLink::reset() {
    if (keyed_) {
        mbedtls_gcm_free(&send_);
        mbedtls_gcm_free(&receive_);
    }
    keyed_ = false;
    failed_ = false;
    send_counter_ = 0;
    receive_counter_ = 0;
    frame_length_ = 0;
    plain_start_ = 0;
    plain_end_ = 0;
}

// Decrypt the next frame into plain_ once the socket holds all of it. Reads
// exactly one frame's bytes, so the next frame stays in the socket buffer.
bool SecureLink::fill() {
    if (plain_start_ < plain_end_) return true;
    if (!active()) return false;
    while (frame_length_ < 2 && client_.available()) {
        const int byte = client_.read();
        if (byte < 0) return false;
        frame_[frame_length_++] = static_cast<uint8_t>(byte);
    }
    if (frame_length_ < 2) return false;
    const size_t payload = (static_cast<size_t>(frame_[0]) << 8) | frame_[1];
    if (payload == 0 || payload > MAX_PAYLOAD) {
        failed_ = true;
        return false;
    }
    const size_t total = 2 + payload + 16;
    while (frame_length_ < total && client_.available()) {
        const int got = client_.read(frame_ + frame_length_, total - frame_length_);
        if (got <= 0) break;
        frame_length_ += static_cast<size_t>(got);
    }
    if (frame_length_ < total) return false;

    uint8_t iv[12];
    nonce(iv, FROM_DESKTOP, receive_counter_);
    if (mbedtls_gcm_auth_decrypt(&receive_, payload, iv, sizeof(iv), nullptr, 0, frame_ + 2 + payload, 16,
                                 frame_ + 2, plain_) != 0) {
        failed_ = true;
        return false;
    }
    ++receive_counter_;
    frame_length_ = 0;
    plain_start_ = 0;
    plain_end_ = payload;
    return true;
}

int SecureLink::available() {
    fill();
    return static_cast<int>(plain_end_ - plain_start_);
}

int SecureLink::read() {
    return fill() ? plain_[plain_start_++] : -1;
}

int SecureLink::peek() {
    return fill() ? plain_[plain_start_] : -1;
}

int SecureLink::read(uint8_t *buffer, size_t count) {
    if (!fill()) return 0;
    const size_t n = min(count, plain_end_ - plain_start_);
    memcpy(buffer, plain_ + plain_start_, n);
    plain_start_ += n;
    return static_cast<int>(n);
}

size_t SecureLink::write(const uint8_t *data, size_t size) {
    size_t sent = 0;
    while (sent < size && active()) {
        const size_t n = min(size - sent, MAX_PAYLOAD);
        uint8_t iv[12];
        nonce(iv, FROM_DECK, send_counter_);
        out_[0] = static_cast<uint8_t>(n >> 8);
        out_[1] = static_cast<uint8_t>(n);
        if (mbedtls_gcm_crypt_and_tag(&send_, MBEDTLS_GCM_ENCRYPT, n, iv, sizeof(iv), nullptr, 0, data + sent,
                                      out_ + 2, 16, out_ + 2 + n) != 0) {
            failed_ = true;
            break;
        }
        ++send_counter_;
        const size_t total = 2 + n + 16;
        size_t offset = 0;
        while (offset < total) {
            const size_t written = client_.write(out_ + offset, total - offset);
            if (written == 0) {
                // A frame cut short cannot be resumed; the counters would
                // disagree from here on. End the connection instead.
                failed_ = true;
                return sent;
            }
            offset += written;
        }
        sent += n;
    }
    return sent;
}
