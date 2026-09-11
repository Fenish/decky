#include "pages/patch.h"

bool apply_patch(uint16_t *image, int width, int height, const uint8_t *data, size_t length, bool write) {
    size_t at = 0;
    while (at < length) {
        if (at + 4 > length) return false;
        const int x = data[at], y = data[at + 1], w = data[at + 2], h = data[at + 3];
        at += 4;
        if (!w || !h || x + w > width || y + h > height) return false;
        const int total = w * h;
        int written = 0;
        while (written < total) {
            if (at >= length) return false;
            const uint8_t control = data[at++];
            const int count = control < 128 ? control + 1 : control - 127;
            if (written + count > total) return false;
            if (control < 128) {
                if (at + static_cast<size_t>(count) * 2 > length) return false;
                for (int k = 0; k < count; ++k, at += 2, ++written)
                    if (write) image[(y + written / w) * width + x + written % w] = data[at] | (data[at + 1] << 8);
            } else {
                if (at + 2 > length) return false;
                const uint16_t value = data[at] | (data[at + 1] << 8);
                at += 2;
                for (int k = 0; k < count; ++k, ++written)
                    if (write) image[(y + written / w) * width + x + written % w] = value;
            }
        }
    }
    return true;
}
