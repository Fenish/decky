/*---------------------------------------------------------------
 * The snake easter egg: what counts as the five taps that start it, and what
 * the deck says while it is being played.
 *--------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { EmptyTaps } from "../src/main/deck/deck-events";
import { parseEvent } from "../src/main/device/protocol";

/** Tap the same key `times` over, a moment apart, and say the last count. */
function run(taps: EmptyTaps, times: number, from = 1000, page = "home", cell = 3): number {
    let count = 0;
    for (let i = 0; i < times; i++) count = taps.count(page, cell, from + i * 200);
    return count;
}

describe("five taps on an empty key", () => {
    it("counts up to five and starts over", () => {
        const taps = new EmptyTaps();
        expect(run(taps, 4)).toBe(4);
        expect(run(taps, 1, 1800)).toBe(5);
    });

    it("starts over on a different key", () => {
        const taps = new EmptyTaps();
        run(taps, 4);
        expect(taps.count("home", 7, 2000)).toBe(1);
    });

    it("starts over on a different page", () => {
        const taps = new EmptyTaps();
        run(taps, 4);
        expect(taps.count("scenes", 3, 2000)).toBe(1);
    });

    it("does not count taps left too long apart", () => {
        const taps = new EmptyTaps();
        expect(taps.count("home", 3, 1000)).toBe(1);
        expect(taps.count("home", 3, 1000 + 2500)).toBe(1);
    });

    it("wants five fresh taps for a second game", () => {
        const taps = new EmptyTaps();
        expect(run(taps, 5)).toBe(5);
        expect(taps.count("home", 3, 2000)).toBe(1);
        expect(run(taps, 4, 2200)).toBe(5);
    });
});

describe("what the deck says about the game", () => {
    it("reads the score as it climbs", () => {
        expect(parseEvent("EV GAME SCORE 7")).toMatchObject({
            kind: "game",
            over: false,
            score: 7,
        });
    });

    it("reads the end of it", () => {
        expect(parseEvent("EV GAME OVER 12")).toMatchObject({
            kind: "game",
            over: true,
            score: 12,
        });
    });

    it("ignores a line it cannot read", () => {
        expect(parseEvent("EV GAME SCORE")).toBeNull();
        expect(parseEvent("EV GAME SCORE -1")).toBeNull();
        expect(parseEvent("EV GAME PAUSED 3")).toBeNull();
    });

    it("still reads a key press", () => {
        expect(parseEvent("EV 0 3 DOWN")).toMatchObject({ kind: "key", cell: 3, down: true });
    });
});
