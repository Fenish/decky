import { describe, expect, it } from "vitest";
import {
    decodeWheelSpec,
    DIE_FEEL,
    drumRow,
    encodeWheelSpec,
    mapRuns,
    WHEEL_FEEL,
} from "../src/shared/wheel-spec";
import type { DialSpec, DieSpec, DrumSpec } from "../src/shared/wheel-spec";
import { dieSeen, packPose, poseRotation, unpackPose } from "../src/shared/die";
import { encodeLivePatch } from "../src/shared/live-patch";
import { TIMER_STEPS, wheelValues } from "../src/shared/widgets";

const W = 118;
const H = 123;

function spec(overrides: Partial<DrumSpec> = {}): DrumSpec {
    const glyphs = (height: number, widths: number[]) =>
        [..."0123456789:"].map((char, i) => ({
            char,
            width: widths[i % widths.length]!,
            alpha: Uint8Array.from(
                { length: widths[i % widths.length]! * height },
                (_, k) => (k * 37 + i) & 255,
            ),
        }));
    const background = new Uint8Array(W * H * 2).fill(0x20);
    return {
        kind: "drum",
        row: 37,
        center: 61,
        clipTop: 0,
        clipBottom: H,
        color: 0xef7b,
        feel: WHEEL_FEEL,
        backdrop: encodeLivePatch(null, background, W, H),
        sizes: [
            { height: 38, glyphs: glyphs(38, [16, 17]) },
            { height: 31, glyphs: glyphs(31, [13]) },
        ],
        labels: [
            { size: 0, text: "0:10" },
            { size: 0, text: "59:00" },
            { size: 1, text: "1:05:00" },
        ],
        ...overrides,
    };
}

describe("a wheel's look, as the deck reads it", () => {
    it("reads back exactly what was written", () => {
        const look = spec();
        const decoded = decodeWheelSpec(encodeWheelSpec(look), W, H);
        expect(decoded).not.toBeNull();
        expect({ ...decoded!, feel: { ...decoded!.feel } }).toEqual({
            ...look,
            backdrop: Uint8Array.from(look.backdrop),
        });
    });
    it("is refused where the deck would refuse it", () => {
        const bytes = encodeWheelSpec(spec());
        expect(decodeWheelSpec(bytes.subarray(0, bytes.length - 1), W, H)).toBeNull();
        expect(decodeWheelSpec(Uint8Array.from([...bytes, 0]), W, H)).toBeNull();
        expect(decodeWheelSpec(Uint8Array.from([3, ...bytes.subarray(1)]), W, H)).toBeNull();
        // A character its font size has no glyph for.
        expect(
            decodeWheelSpec(encodeWheelSpec(spec({ labels: [{ size: 0, text: "5-00" }] })), W, H),
        ).toBeNull();
        expect(decodeWheelSpec(encodeWheelSpec(spec({ row: H + 1 })), W, H)).toBeNull();
        expect(
            decodeWheelSpec(encodeWheelSpec(spec({ clipTop: 90, clipBottom: 80 })), W, H),
        ).toBeNull();
        // A backdrop that would draw outside the key.
        expect(
            decodeWheelSpec(
                encodeWheelSpec(spec({ backdrop: Uint8Array.from([100, 100, 30, 30, 128, 0, 0]) })),
                W,
                H,
            ),
        ).toBeNull();
    });
});

function dial(overrides: Partial<DialSpec> = {}): DialSpec {
    const low = new Uint8Array(W * H * 2).fill(0x10);
    const high = new Uint8Array(W * H * 2).fill(0x7e);
    // The lower half fills first, the top row never.
    const map = Uint8Array.from({ length: W * H }, (_, i) =>
        i < W ? 255 : i < (W * H) / 2 ? 200 : 30,
    );
    return {
        kind: "dial",
        min: 0,
        max: 100,
        unitPx: 1.2,
        textY: 62,
        color: 0xffff,
        backdrop: encodeLivePatch(null, low, W, H),
        fill: encodeLivePatch(low, high, W, H),
        map,
        size: {
            height: 30,
            glyphs: [..."0123456789%"].map((char, i) => ({
                char,
                width: 14,
                alpha: Uint8Array.from({ length: 14 * 30 }, (_, k) => (k + i * 9) & 255),
            })),
        },
        ...overrides,
    };
}

describe("a dial's look", () => {
    it("reads back exactly what was written, its fill map in runs", () => {
        const look = dial();
        const bytes = encodeWheelSpec(look);
        // Three runs of the map, not one byte a pixel.
        expect(mapRuns(look.map).length).toBeLessThan(200);
        expect(decodeWheelSpec(bytes, W, H)).toEqual({
            ...look,
            backdrop: Uint8Array.from(look.backdrop),
            fill: Uint8Array.from(look.fill),
        });
    });
    it("carries no digits when it writes no number (the bar)", () => {
        const look = dial({ size: null });
        const bytes = encodeWheelSpec(look);
        expect(bytes.length).toBeLessThan(encodeWheelSpec(dial()).length - 10 * 14 * 30);
        expect(decodeWheelSpec(bytes, W, H)).toMatchObject({ size: null });
    });
    it("is refused where the deck would refuse it", () => {
        const refused = (overrides: Partial<DialSpec>) =>
            decodeWheelSpec(encodeWheelSpec(dial(overrides)), W, H);
        expect(refused({ max: 0 })).toBeNull();
        expect(refused({ textY: H })).toBeNull();
        // A map that covers less than the key.
        expect(refused({ map: new Uint8Array(W * H - 1).fill(9) })).toBeNull();
        // Digits it cannot write.
        expect(
            refused({ size: { ...dial().size, glyphs: dial().size.glyphs.slice(1) } }),
        ).toBeNull();
    });
});

describe("a die", () => {
    const die = (overrides: Partial<DieSpec> = {}): DieSpec => ({
        kind: "die",
        size: 42,
        color: 0xef7b,
        pip: 0x0841,
        feel: DIE_FEEL,
        backdrop: encodeLivePatch(null, new Uint8Array(W * H * 2).fill(0x20), W, H),
        ...overrides,
    });
    it("is sent small - the deck draws it - and read back as written", () => {
        const look = die();
        const bytes = encodeWheelSpec(look);
        // Mostly the key under it: a drum's look is 20 KB.
        expect(bytes.length).toBeLessThan(1024);
        expect(decodeWheelSpec(bytes, W, H)).toEqual({
            ...look,
            backdrop: Uint8Array.from(look.backdrop),
        });
    });
    it("is refused where the deck would refuse it", () => {
        expect(decodeWheelSpec(encodeWheelSpec(die({ size: 60 })), W, H)).toBeNull();
        expect(decodeWheelSpec(encodeWheelSpec(die({ size: 11 })), W, H)).toBeNull();
        expect(
            decodeWheelSpec(encodeWheelSpec(die({ feel: { ...DIE_FEEL, drag: 0 } })), W, H),
        ).toBeNull();
    });
    it("lies as its pose says: a face, a place on the key and a turn, in one number", () => {
        const pose = { face: 4, x: 127, y: 3, yaw: 359 };
        expect(unpackPose(packPose(pose))).toEqual(pose);
        expect(unpackPose(6)).toBeNull();
        expect(unpackPose(packPose({ face: 0, x: 0, y: 0, yaw: 360 }))).toBeNull();
        expect(unpackPose(-1)).toBeNull();
        // Lying on any face, that face points up.
        for (let face = 0; face < 6; face++) {
            const rot = poseRotation({ face, x: 64, y: 64, yaw: 30 });
            const up = [rot[6], rot[7], rot[8]];
            const normal = [
                [0, 0, 1],
                [1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [-1, 0, 0],
                [0, 0, -1],
            ][face]!;
            expect(up.map((v, i) => v! * normal[i]!).reduce((a, b) => a + b)).toBeCloseTo(1, 6);
        }
    });
    it("shows its top, and a sliver of its front, from where the eye is", () => {
        const { faces } = dieSeen({ face: 0, x: 64, y: 64, yaw: 0 }, 118, 123, 42);
        // 1 up; 4 faces the front edge of the key.
        expect(faces.map((f) => f.face).sort()).toEqual([0, 3]);
        const top = faces.find((f) => f.face === 0)!;
        const front = faces.find((f) => f.face === 3)!;
        expect(top.light).toBeGreaterThan(front.light);
        expect(front.c[1]).toBeGreaterThan(top.c[1]);
    });
});

describe("the drum", () => {
    it("puts the band's label flat and whole, and its neighbours a row off, turned and faded", () => {
        expect(drumRow(0, 37, WHEEL_FEEL)).toEqual({ offset: 0, squash: 1, alpha: 1 });
        const next = drumRow(1, 37, WHEEL_FEEL)!;
        expect(next.offset).toBeCloseTo(35.9, 1);
        expect(next.squash).toBeCloseTo(Math.cos(0.42), 5);
        expect(next.alpha).toBeCloseTo(Math.cos(0.42) ** 2 * 0.4, 5);
        expect(drumRow(-1, 37, WHEEL_FEEL)!.offset).toBeCloseTo(-35.9, 1);
        // Past the drum's edge a label is out of sight.
        expect(drumRow(3.5, 37, WHEEL_FEEL)).toBeNull();
    });
    it("offers the wheel's steps, and a time set in the app between them", () => {
        const countdown = { type: "timer", mode: "countdown", seconds: 450 } as const;
        const values = wheelValues(countdown);
        expect(values).toHaveLength(TIMER_STEPS.length + 1);
        expect(values.slice(values.indexOf(420), values.indexOf(420) + 3)).toEqual([420, 450, 480]);
        expect(wheelValues({ ...countdown, seconds: 300 })).toEqual([...TIMER_STEPS]);
    });
});
