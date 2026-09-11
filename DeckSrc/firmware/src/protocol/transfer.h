#pragma once
#include <stddef.h>
#include <stdint.h>
#include "deck/session.h"

// What keeps the deck alive during a transfer: touch, animations, sliding
// text - run between blocks.
class TransferIdle {
public:
    virtual ~TransferIdle() = default;
    virtual void between_blocks() = 0;
};

// Uploads from the desktop: `READY [<block>]`, then the bytes in blocks, each
// acknowledged with `A`, then a CRC check. Over USB a block is 128 bytes
// unless the desktop asks for more with BLOCK - a released app expects 128 -
// and back to 128 on HELLO and when the desktop goes: a round trip a block,
// 128 bytes spent more time waiting than sending. Over Wi-Fi it is 4096.
class Transfer {
public:
    static constexpr size_t BLOCK_BYTES = 128;
    static constexpr size_t SERIAL_BLOCK_MAX = 4096;

    Transfer(Session &session, TransferIdle &idle) : session_(session), idle_(idle) {}
    // `bytes` into `target`, checked against `crc`. False when it timed out or
    // the CRC differs; the ERR has been sent.
    bool read(uint8_t *target, size_t bytes, uint32_t crc);
    // BLOCK <n>: false when out of range.
    bool set_block(size_t bytes);
    void reset_block() { serial_block_ = BLOCK_BYTES; }
    size_t block() const { return serial_block_; }

private:
    Session &session_;
    TransferIdle &idle_;
    size_t serial_block_ = BLOCK_BYTES;
};
