/*---------------------------------------------------------------
 * Designs picked on the key itself: a hold offers what a widget can look
 * like, a dot for each, every tap moves on, and the one left showing is
 * kept in the profile once the touches stop.
 *--------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckPage } from "../src/shared/config";
import type { Widget, WidgetState, WidgetStates } from "../src/shared/widgets";
import { deckTurned, designsOf, shownWidget } from "../src/shared/widgets/registry";
import type { MainWindow } from "../src/main/app/main-window";
import type { Profile } from "../src/main/profile/profile";
import type { DeckWheels } from "../src/main/widgets/deck-wheels";
import type { WidgetReadings } from "../src/main/widgets/readings";
import { KEEP_MS, WidgetPresses } from "../src/main/widgets/presses";
import { HOLD_MS } from "../src/main/widgets/widget-state";
import type { WidgetStore } from "../src/main/widgets/widget-state";

const PAGE = { id: "home" } as DeckPage;
const CLOCK: Widget = {
    type: "clock",
    style: "digital",
    seconds: false,
    date: false,
    timeZone: "",
};
// One option: nothing to choose from, so a list is not one of its designs.
const DICE: Widget = { type: "dice", mode: "die", options: "Pizza" };

/** Presses on key 4 of Home, which holds `widget` until a design is kept. */
function keyWith(widget: Widget) {
    let held = widget;
    const states: WidgetStates = {};
    const store = {
        get: (address: string) => states[address],
        set: (address: string, state: WidgetState | undefined) => {
            if (state === undefined) delete states[address];
            else states[address] = state;
        },
        save: () => {},
    };
    const profile = {
        config: { activePageId: "home" },
        currentWidget: (pageId: string, cell: number) =>
            pageId === "home" && cell === 4 ? held : undefined,
    };
    const rollDice = vi.fn(() => "Rolling.");
    const presses = new WidgetPresses(
        profile as unknown as Profile,
        store as unknown as WidgetStore,
        { pings: {}, feeds: {}, integrations: {} } as unknown as WidgetReadings,
        { turns: () => false, rollDice } as unknown as DeckWheels,
        { send: () => {} } as unknown as MainWindow,
    );
    const saved: Widget[] = [];
    presses.onDesign = (_pageId, _cell, design) => {
        held = design;
        saved.push(design);
    };
    const touch = (ms = 80): void => {
        presses.widgetPress(PAGE, 4, true);
        vi.advanceTimersByTime(ms);
        presses.widgetPress(PAGE, 4, false);
    };
    const hold = (): void => {
        presses.widgetPress(PAGE, 4, true);
        vi.advanceTimersByTime(HOLD_MS);
        presses.widgetPress(PAGE, 4, false);
    };
    /** What the key is showing: its state's choosing, and the widget that draws. */
    const showing = () => ({
        choosing: states["home:4"]?.choosing,
        widget: shownWidget(held, states["home:4"]),
    });
    return { presses, touch, hold, showing, saved, rollDice, shown: () => held };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("picking a design on the key", () => {
    it("offers a clock's faces on a hold, the one it wears among them", () => {
        const { hold, showing } = keyWith(CLOCK);
        hold();
        expect(showing().choosing).toEqual({ index: 0, count: 3 });
        expect(showing().widget).toEqual(CLOCK);
    });

    it("moves to the next on every tap, and round again", () => {
        const { hold, touch, showing } = keyWith(CLOCK);
        hold();
        touch();
        expect(showing().widget).toEqual({ ...CLOCK, style: "analog" });
        touch();
        expect(showing().widget).toEqual({ ...CLOCK, style: "minimal" });
        touch();
        expect(showing().choosing).toEqual({ index: 0, count: 3 });
        expect(showing().widget).toEqual(CLOCK);
    });

    it("keeps the one showing once the touches stop, and is a key again", async () => {
        const { hold, touch, showing, saved } = keyWith(CLOCK);
        hold();
        touch();
        // Each touch puts the keeping off; only three quiet seconds settle it.
        vi.advanceTimersByTime(KEEP_MS - 100);
        touch();
        vi.advanceTimersByTime(KEEP_MS - 100);
        expect(saved).toEqual([]);
        vi.advanceTimersByTime(100);
        await vi.runAllTicks();
        expect(saved).toEqual([{ ...CLOCK, style: "minimal" }]);
        expect(showing().choosing).toBeUndefined();
    });

    it("offers what a die throws instead of rolling it, and rolls again after", async () => {
        const { hold, touch, showing, saved, rollDice } = keyWith(DICE);
        hold();
        expect(rollDice).not.toHaveBeenCalled();
        touch();
        expect(showing().widget).toEqual({ ...DICE, mode: "coin" });
        vi.advanceTimersByTime(KEEP_MS);
        await vi.runAllTicks();
        expect(saved).toEqual([{ ...DICE, mode: "coin" }]);
        touch();
        expect(rollDice).toHaveBeenCalledTimes(1);
    });

    it("leaves a widget with one design alone: its hold does what it always did", () => {
        const { hold, showing } = keyWith({ type: "counter", step: 1, start: 0, daily: false });
        hold();
        expect(showing().choosing).toBeUndefined();
    });
});

describe("what the deck is told while a design is picked", () => {
    it("stops turning the key itself, so the picture with the dots shows", () => {
        const now = Date.now();
        expect(deckTurned(DICE, undefined, now)).toBe("die");
        expect(deckTurned(DICE, { choosing: { index: 1, count: 4 } }, now)).toBeNull();
    });

    it("shows the design under the finger, not the one saved", () => {
        const { list } = designsOf(DICE);
        expect(list.map((design) => design.mode)).toEqual(["die", "coin", "yesno"]);
        expect(shownWidget(DICE, { choosing: { index: 2, count: 3 } })).toEqual({
            ...DICE,
            mode: "yesno",
        });
    });

    it("counts a list among them only where there is something to choose from", () => {
        const listed = designsOf({ type: "dice", mode: "die", options: "Pizza, Burger, Sushi" });
        expect(listed.list.map((design) => design.mode)).toEqual(["die", "coin", "yesno", "list"]);
    });
});
