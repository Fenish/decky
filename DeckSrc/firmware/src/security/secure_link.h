#pragma once
#include <Arduino.h>
#include <WiFiClient.h>
#include <mbedtls/gcm.h>

// A paired Wi-Fi connection, after the challenge-response handshake.
//
// Every byte in either direction travels inside an AES-128-GCM frame:
//
//     [payload length, u16 big-endian][ciphertext][16-byte tag]
//
// Each direction has its own key, derived from the pairing secret and this
// connection's challenge, and its own frame counter. The GCM nonce is the
// direction and the counter, never sent - so a frame that is tampered with,
// injected, replayed or reordered fails authentication, and the connection
// ends. Without this, anyone on the same network who could inject into the TCP
// stream could send commands to the deck, or fake key presses to the PC, once
// the real desktop had authenticated.
//
// The desktop side is desktop/src/main/device/secure-channel.ts; the two must
// agree byte for byte.
class SecureLink : public Stream {
public:
    static constexpr size_t MAX_PAYLOAD = 4096;
    static constexpr uint32_t FROM_DESKTOP = 1;
    static constexpr uint32_t FROM_DECK = 2;

    explicit SecureLink(WiFiClient &client) : client_(client) {}

    void begin(const uint8_t send_key[16], const uint8_t receive_key[16]);
    void reset();
    bool active() const { return keyed_ && !failed_; }
    bool failed() const { return failed_; }

    int available() override;
    int read() override;
    int peek() override;
    int read(uint8_t *buffer, size_t count);
    size_t write(uint8_t byte) override { return write(&byte, 1); }
    size_t write(const uint8_t *data, size_t size) override;
    void flush() override {}

private:
    bool fill();

    WiFiClient &client_;
    mbedtls_gcm_context send_{};
    mbedtls_gcm_context receive_{};
    bool keyed_ = false;
    bool failed_ = false;
    uint64_t send_counter_ = 0;
    uint64_t receive_counter_ = 0;
    uint8_t frame_[2 + MAX_PAYLOAD + 16] = {};
    size_t frame_length_ = 0;
    uint8_t plain_[MAX_PAYLOAD] = {};
    size_t plain_start_ = 0;
    size_t plain_end_ = 0;
    uint8_t out_[2 + MAX_PAYLOAD + 16] = {};
};
