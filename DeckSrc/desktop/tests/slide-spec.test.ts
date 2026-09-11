import { describe, expect, it } from "vitest";
import { decodeSlide, encodeSlide, SLIDE_FEEL, slideOffset } from "../src/shared/slide-spec";
import type { SlideLine } from "../src/shared/slide-spec";

const W = 118;
const H = 123;
const line = (over: Partial<SlideLine> = {}): SlideLine => {
    const base = { x: 8, y: 88, w: 102, h: 21, width: 240, color: 0xffff, ...over };
    return { ...base, alpha: over.alpha ?? new Uint8Array(base.width * base.h).fill(7) };
};

describe("sliding text", () => {
    it("reads back as it was written: its feel, and each line's window, colour and coverage", () => {
        const lines = [line(), line({ y: 104, h: 17, width: 150, color: 0x7bef })];
        const bytes = encodeSlide({ feel: SLIDE_FEEL, lines });
        expect(decodeSlide(bytes, W, H)).toEqual({ feel: SLIDE_FEEL, lines });
    });

    it("is refused where the deck would refuse it", () => {
        const bad = (over: Partial<SlideLine>) =>
            decodeSlide(encodeSlide({ feel: SLIDE_FEEL, lines: [line(over)] }), W, H);
        expect(bad({})).not.toBeNull();
        // On the key's edge, where a pressed key's outline runs.
        expect(bad({ x: 1 })).toBeNull();
        expect(bad({ x: 20, w: 97 })).toBeNull();
        // Below the key.
        expect(bad({ y: 110, h: 21 })).toBeNull();
        // Text that fits its window has nothing to slide.
        expect(bad({ width: 102 })).toBeNull();
        // A window too narrow for its fading edges.
        expect(bad({ w: 16, width: 40 })).toBeNull();
        const bytes = encodeSlide({ feel: SLIDE_FEEL, lines: [line()] });
        expect(decodeSlide(bytes.slice(0, -1), W, H)).toBeNull();
        expect(decodeSlide(Uint8Array.from([...bytes, 0]), W, H)).toBeNull();
        expect(decodeSlide(encodeSlide({ feel: SLIDE_FEEL, lines: [] }), W, H)).toBeNull();
        expect(
            decodeSlide(encodeSlide({ feel: { ...SLIDE_FEEL, speed: 0 }, lines: [line()] }), W, H),
        ).toBeNull();
    });

    it("rests at its start, slides at its speed, and comes round to where it began", () => {
        const feel = { rest: 1500, speed: 30, gap: 32, fade: 8 };
        const width = 240;
        const lap = width + feel.gap;
        const round = feel.rest + Math.floor((lap * 1000) / feel.speed);
        expect(slideOffset(feel, width, 0)).toBe(0);
        expect(slideOffset(feel, width, 1499)).toBe(0);
        expect(slideOffset(feel, width, 1500 + 1000)).toBe(30);
        expect(slideOffset(feel, width, 1500 + 2000)).toBe(60);
        // Never a whole lap: that looks as it did at rest, and rest is next.
        expect(slideOffset(feel, width, round - 1)).toBe(lap - 1);
        expect(slideOffset(feel, width, round)).toBe(0);
        expect(slideOffset(feel, width, round + 1500 + 1000)).toBe(30);
    });
});
