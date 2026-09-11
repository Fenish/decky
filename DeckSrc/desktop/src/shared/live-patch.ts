/*---------------------------------------------------------------
 * LIVE patches: the parts of a key's picture that changed, small enough to
 * send every second.
 *
 * A key image is RGB565, little-endian, width × height. The key is split into
 * 32 × 32 tiles; for each tile that changed, the box around its changed
 * pixels is sent as
 *
 *     x, y, w, h (one byte each), then the box's pixels, run-length encoded:
 *     a control byte c < 128 is followed by c + 1 literal pixels; c >= 128 is
 *     followed by one pixel to repeat c - 127 times. Pixels are 2 bytes, LE.
 *
 * Boxes follow each other to the end of the payload. The firmware decodes
 * them into the key's cached image (LIVE in main.cpp) - mirrored by
 * decodeLivePatch here, which the tests use.
 *--------------------------------------------------------------*/

const TILE = 32;

function pixel(image: Uint8Array, index: number): number {
    return image[index * 2]! | (image[index * 2 + 1]! << 8);
}

function encodeBox(
    out: number[],
    image: Uint8Array,
    width: number,
    x: number,
    y: number,
    w: number,
    h: number,
): void {
    out.push(x, y, w, h);
    const pixels: number[] = [];
    for (let row = y; row < y + h; row++)
        for (let col = x; col < x + w; col++) pixels.push(pixel(image, row * width + col));
    let i = 0;
    while (i < pixels.length) {
        let run = 1;
        while (i + run < pixels.length && run < 128 && pixels[i + run] === pixels[i]) run++;
        if (run >= 3) {
            out.push(127 + run, pixels[i]! & 255, pixels[i]! >> 8);
            i += run;
            continue;
        }
        // Literals until the next run of three or more, at most 128.
        const start = i;
        while (
            i < pixels.length &&
            i - start < 128 &&
            !(i + 2 < pixels.length && pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2])
        )
            i++;
        out.push(i - start - 1);
        for (let k = start; k < i; k++) out.push(pixels[k]! & 255, pixels[k]! >> 8);
    }
}

/**
 * The boxes that turn `base` into `next`. With no base, one box covers the
 * whole key: a full replacement for when the deck's copy is not known.
 */
export function encodeLivePatch(
    base: Uint8Array | null,
    next: Uint8Array,
    width: number,
    height: number,
): Uint8Array {
    const out: number[] = [];
    if (!base) {
        encodeBox(out, next, width, 0, 0, width, height);
        return Uint8Array.from(out);
    }
    for (let ty = 0; ty < height; ty += TILE)
        for (let tx = 0; tx < width; tx += TILE) {
            let left = width,
                top = height,
                right = -1,
                bottom = -1;
            for (let y = ty; y < Math.min(height, ty + TILE); y++)
                for (let x = tx; x < Math.min(width, tx + TILE); x++) {
                    const i = (y * width + x) * 2;
                    if (base[i] !== next[i] || base[i + 1] !== next[i + 1]) {
                        left = Math.min(left, x);
                        right = Math.max(right, x);
                        top = Math.min(top, y);
                        bottom = Math.max(bottom, y);
                    }
                }
            if (right >= 0)
                encodeBox(out, next, width, left, top, right - left + 1, bottom - top + 1);
        }
    return Uint8Array.from(out);
}

/** Apply a patch to an image in place; false if the payload is malformed. */
export function decodeLivePatch(
    image: Uint8Array,
    payload: Uint8Array,
    width: number,
    height: number,
): boolean {
    let at = 0;
    while (at < payload.length) {
        if (at + 4 > payload.length) return false;
        const [x, y, w, h] = [payload[at]!, payload[at + 1]!, payload[at + 2]!, payload[at + 3]!];
        at += 4;
        if (!w || !h || x + w > width || y + h > height) return false;
        let written = 0;
        const put = (value: number): void => {
            const index = (y + Math.floor(written / w)) * width + x + (written % w);
            image[index * 2] = value & 255;
            image[index * 2 + 1] = value >> 8;
            written++;
        };
        while (written < w * h) {
            if (at >= payload.length) return false;
            const control = payload[at++]!;
            const count = control < 128 ? control + 1 : control - 127;
            if (written + count > w * h) return false;
            if (control < 128) {
                if (at + count * 2 > payload.length) return false;
                for (let k = 0; k < count; k++, at += 2)
                    put(payload[at]! | (payload[at + 1]! << 8));
            } else {
                if (at + 2 > payload.length) return false;
                const value = payload[at]! | (payload[at + 1]! << 8);
                at += 2;
                for (let k = 0; k < count; k++) put(value);
            }
        }
    }
    return true;
}
