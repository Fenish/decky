#include "protocol/transfer.h"
#include <Arduino.h>
#include "common/crc32.h"
#include "network/wireless.h"

bool Transfer::read(uint8_t *target, size_t bytes, uint32_t expected_crc) {
    const bool network = wireless::network_transfer();
    const size_t block_bytes = network ? 4096 : serial_block_;
    if (block_bytes != BLOCK_BYTES) wireless::reply().printf("READY %u\n", static_cast<unsigned>(block_bytes));
    else wireless::reply().println("READY");
    size_t received = 0;
    while (received < bytes) {
        const size_t count = min(block_bytes, bytes - received);
        const uint32_t deadline = millis() + 5000;
        size_t block = 0;
        while (block < count && static_cast<int32_t>(deadline - millis()) > 0) {
            if (wireless::reply().available()) {
                if (network) {
                    const int got = wireless::read_network(target + received + block, count - block);
                    if (got > 0) block += got;
                } else target[received + block++] = static_cast<uint8_t>(wireless::reply().read());
            } else {
                idle_.between_blocks();
                vTaskDelay(1);
            }
        }
        if (block != count) {
            wireless::reply().printf("ERR transfer timeout %u/%u\n", static_cast<unsigned>(block),
                                     static_cast<unsigned>(count));
            return false;
        }
        received += count;
        session_.heard(millis());
        wireless::reply().write(reinterpret_cast<const uint8_t *>("A\n"), 2);
        idle_.between_blocks();
    }
    if (crc32(target, bytes) != expected_crc) {
        wireless::reply().println("ERR checksum mismatch");
        return false;
    }
    return true;
}

bool Transfer::set_block(size_t bytes) {
    if (bytes < BLOCK_BYTES || bytes > SERIAL_BLOCK_MAX) return false;
    serial_block_ = bytes;
    return true;
}
