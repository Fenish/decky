import { describe, expect, it } from "vitest";
import {
    decodeSweep,
    encodeSweep,
    SWEEP_BYTES,
    sweepFits,
    sweepMoving,
    sweepShare,
} from "../src/shared/sweep-spec";
import type { SweepArc } from "../src/shared/sweep-spec";
import type { WidgetState } from "../src/shared/widgets";
import type { TimerWidget } from "../src/shared/widgets/timer";
import { drawTimer } from "../src/renderer/src/features/widgets/kinds/timer/draw-timer";
import { drawPomodoro } from "../src/renderer/src/features/widgets/kinds/pomodoro/draw-pomodoro";
import { drawObs } from "../src/renderer/src/features/widgets/kinds/obs/draw-obs";

// The deck's key: 118 × 123, as the panel's openings are.
const W = 118;
const H = 123;

const arc = (extra: Partial<SweepArc> = {}): SweepArc => ({
    x: 59,
    y: 61.5,
    r: 47.1875,
    width: 5.625,
    color: "#f8fcf8",
    alpha: 1,
    glow: 0,
    reach: 0,
    motion: { share: 0.5 },
    ...extra,
});

describe("a ring's arc for the deck (SWEEP)", () => {
    it("round-trips what the deck reads, held still or moving", () => {
        for (const motion of [
            { share: 0 },
            { share: 1 },
            { zero: 1_789_000_000_123, turn: 60_000, round: true },
            { zero: 1_789_000_005_000, turn: -5000, round: false },
        ]) {
            const bytes = encodeSweep(
                arc({ motion, r: 30, alpha: 128 / 255, glow: 56 / 255, reach: 7 }),
            );
            expect(bytes).toHaveLength(SWEEP_BYTES);
            expect(decodeSweep(bytes, W, H)).toEqual(
                arc({ motion, r: 30, alpha: 128 / 255, glow: 56 / 255, reach: 7 }),
            );
        }
    });

    it("fits only whole and 2 px inside the key, as the deck reckons it", () => {
        // Its reach: radius, half the stroke, its glow, and a pixel.
        const inside = arc({ x: 50, y: 50, r: 45, width: 4 });
        expect(sweepFits(inside, 100, 100)).toBe(true);
        expect(sweepFits({ ...inside, x: 49.9375 }, 100, 100)).toBe(false);
        expect(sweepFits({ ...inside, reach: 1 }, 100, 100)).toBe(false);
        expect(sweepFits({ ...inside, y: 50.0625 }, 100, 100)).toBe(false);
        // A stroke wider than its radius, or a hair's breadth, is refused.
        expect(sweepFits(arc({ width: 48 }), W, H)).toBe(false);
        expect(sweepFits(arc({ width: 0.25 }), W, H)).toBe(false);
        expect(decodeSweep(encodeSweep(arc({ r: 60 })), W, H)).toBeNull();
    });

    it("refuses what the deck would: another length, version or motion, a turn of none or over a day", () => {
        const good = encodeSweep(arc({ motion: { zero: 0, turn: 1000, round: false } }));
        const changed = (at: number, value: number) => {
            const bytes = good.slice();
            bytes[at] = value;
            return decodeSweep(bytes, W, H);
        };
        expect(decodeSweep(good, W, H)).not.toBeNull();
        expect(decodeSweep(good.slice(0, 31), W, H)).toBeNull();
        expect(changed(0, 2)).toBeNull();
        expect(changed(1, 3)).toBeNull();
        expect(changed(15, 1)).toBeNull();
        expect(changed(18, 1)).toBeNull();
        expect(
            decodeSweep(encodeSweep(arc({ motion: { zero: 0, turn: 0, round: true } })), W, H),
        ).toBeNull();
        expect(
            decodeSweep(
                encodeSweep(arc({ motion: { zero: 0, turn: 86_400_001, round: false } })),
                W,
                H,
            ),
        ).toBeNull();
    });

    it("moves as the deck moves it: once to its end and held, or round and round", () => {
        const fill = { zero: 10_000, turn: 4000, round: false };
        expect(sweepShare(fill, 9000)).toBe(0);
        expect(sweepShare(fill, 11_000)).toBe(0.25);
        expect(sweepShare(fill, 20_000)).toBe(1);
        // A countdown drains: whole at its start, none at its end.
        const drain = { zero: 10_000, turn: -5000, round: false };
        expect(sweepShare(drain, 5000)).toBe(1);
        expect(sweepShare(drain, 7500)).toBe(0.5);
        expect(sweepShare(drain, 12_000)).toBe(0);
        const round = { zero: 0, turn: 60_000, round: true };
        expect(sweepShare(round, 90_000)).toBe(0.5);
        expect(sweepMoving(round, 1e12)).toBe(true);
        expect(sweepMoving(fill, 13_999)).toBe(true);
        expect(sweepMoving(fill, 14_000)).toBe(false);
        expect(sweepMoving(drain, 9999)).toBe(true);
        expect(sweepMoving(drain, 10_000)).toBe(false);
        expect(sweepMoving({ share: 0.3 }, 0)).toBe(false);
    });
});

/**
 * A canvas that draws nothing, for drawings run for what they hand the deck;
 * `arcs` lists the arcs it was asked to draw, as (start, end) angles.
 */
function fakeContext(arcs: [number, number][] = []): CanvasRenderingContext2D {
    const gradient = { addColorStop: () => {} };
    return new Proxy({} as Record<string | symbol, unknown>, {
        get: (target, key) => {
            if (key === "canvas") return { width: W, height: H };
            if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
            if (key === "createRadialGradient" || key === "createLinearGradient")
                return () => gradient;
            if (key === "arc")
                return (_x: number, _y: number, _r: number, start: number, end: number) =>
                    arcs.push([start, end]);
            if (key in target) return target[key];
            return () => {};
        },
        set: (target, key, value) => {
            target[key] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

const look = { background: "#000000", color: "#eee8da", label: "" };
const area = { x: 0, y: 0, w: W, h: H };

describe("rings' arcs, as the widgets hand them to the deck", () => {
    const T = 1_789_000_000_000;
    const top = -Math.PI / 2;
    /** The arcs a drawing painted from the top, as shares of a turn; it hands the deck none. */
    const painted = (draw: (ctx: CanvasRenderingContext2D, sweeps: SweepArc[]) => void) => {
        const arcs: [number, number][] = [];
        const sweeps: SweepArc[] = [];
        draw(fakeContext(arcs), sweeps);
        expect(sweeps).toEqual([]);
        return arcs
            .filter(([start]) => start === top)
            .map(([, end]) => (end - top) / (2 * Math.PI));
    };
    const timer = (widget: TimerWidget, state: WidgetState, now: number) =>
        painted((ctx, sweeps) => drawTimer(ctx, widget, look, area, { state, now, sweeps }));

    it("steps a timer's ring with its digits, drawn into each second's picture", () => {
        const stopwatch = { type: "timer", mode: "stopwatch", seconds: 300 } as const;
        const running = { running: true, since: T, elapsed: 5000 };
        expect(timer(stopwatch, running, T + 10_000)[0]).toBeCloseTo(0.25);
        expect(timer(stopwatch, running, T + 70_000)[0]).toBeCloseTo(0.25);
        expect(timer(stopwatch, { running: false, elapsed: 30_000 }, T)[0]).toBeCloseTo(0.5);
        const countdown = { type: "timer", mode: "countdown", seconds: 60 } as const;
        const started = { running: true, since: T, elapsed: 0 };
        expect(timer(countdown, started, T + 3000)[0]).toBeCloseTo(0.05);
        expect(timer(countdown, started, T + 30_000)[0]).toBeCloseTo(0.5);
        // Ended, it is whole.
        expect(timer(countdown, started, T + 61_000)[0]).toBeCloseTo(1);
    });

    it("steps a pomodoro's ring through each phase the same way", () => {
        const pomodoro = (now: number) =>
            painted((ctx, sweeps) =>
                drawPomodoro(ctx, { type: "pomodoro", focus: 25, rest: 5 }, look, area, {
                    state: { running: true, since: T, elapsed: 0 },
                    now,
                    sweeps,
                }),
            );
        expect(pomodoro(T + 5 * 60_000)[0]).toBeCloseTo(0.2);
        expect(pomodoro(T + 26 * 60_000)[0]).toBeCloseTo(0.2);
    });

    it("hands the deck OBS's countdown ring, draining to the moment it runs out", () => {
        const arming = (now: number) => {
            const sweeps: SweepArc[] = [];
            drawObs(fakeContext(), { glyph: "record", tag: "REC" }, look, area, {
                state: {
                    obs: { health: "ready", active: false },
                    arming: { until: T + 5000, start: true },
                },
                now,
                sweeps,
            });
            return sweeps;
        };
        const ring = arming(T + 400);
        expect(ring).toHaveLength(1);
        expect(ring[0]!.motion).toEqual({ zero: T + 5000, turn: -5000, round: false });
        expect(ring[0]!.glow).toBeGreaterThan(0);
        // The same from second to second: it goes to the deck once.
        expect(arming(T + 3100)).toEqual(ring);
    });
});
