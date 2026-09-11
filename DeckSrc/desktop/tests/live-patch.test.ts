import { describe, expect, it } from "vitest";
import { decodeLivePatch, encodeLivePatch } from "../src/shared/live-patch";

const W = 118;
const H = 123;

function image(fill: number): Uint8Array {
    const bytes = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i++) {
        bytes[i * 2] = fill & 255;
        bytes[i * 2 + 1] = fill >> 8;
    }
    return bytes;
}

function paint(target: Uint8Array, x: number, y: number, w: number, h: number, seed: number): void {
    for (let row = y; row < y + h; row++)
        for (let col = x; col < x + w; col++) {
            // Varied pixels, like anti-aliased text, so runs do not hide the work.
            const value = (seed + row * 31 + col * 7) & 0xffff;
            target[(row * W + col) * 2] = value & 255;
            target[(row * W + col) * 2 + 1] = value >> 8;
        }
}

describe("LIVE patches", () => {
    it("rebuilds the new picture exactly from the old one", () => {
        const base = image(0x0000);
        paint(base, 20, 40, 70, 30, 1);
        const next = base.slice();
        paint(next, 60, 44, 24, 20, 9); // the seconds changing
        const patch = encodeLivePatch(base, next, W, H);
        const rebuilt = base.slice();
        expect(decodeLivePatch(rebuilt, patch, W, H)).toBe(true);
        expect(Buffer.from(rebuilt).equals(Buffer.from(next))).toBe(true);
        // A seconds tick costs a small fraction of the 29 KB key.
        expect(patch.length).toBeLessThan(1400);
    });
    it("sends nothing when nothing changed, and a whole key with no base", () => {
        const same = image(0x1234);
        expect(encodeLivePatch(same, same, W, H).length).toBe(0);
        const next = image(0x1f00);
        paint(next, 10, 10, 30, 30, 5);
        const full = encodeLivePatch(null, next, W, H);
        const rebuilt = image(0xffff);
        expect(decodeLivePatch(rebuilt, full, W, H)).toBe(true);
        expect(Buffer.from(rebuilt).equals(Buffer.from(next))).toBe(true);
        // A flat background compresses: far below 29 KB despite the painted square.
        expect(full.length).toBeLessThan(4000);
    });
    it("rejects payloads that would write outside the key or run short", () => {
        const target = image(0);
        expect(decodeLivePatch(target, Uint8Array.from([100, 100, 30, 30, 128, 0, 0]), W, H)).toBe(
            false,
        );
        expect(decodeLivePatch(target, Uint8Array.from([0, 0, 2, 2, 1, 5]), W, H)).toBe(false);
        expect(decodeLivePatch(target, Uint8Array.from([0, 0, 1, 1, 200, 1, 1]), W, H)).toBe(false);
    });
});
