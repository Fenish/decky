import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckPage } from "../src/shared/config";
import type { Widget } from "../src/shared/widgets";
import type { MainWindow } from "../src/main/app/main-window";
import type { Profile } from "../src/main/profile/profile";
import type { DeckWheels } from "../src/main/widgets/deck-wheels";
import type { WidgetReadings } from "../src/main/widgets/readings";
import { WidgetPresses } from "../src/main/widgets/presses";
import { HOLD_MS, TAP_GAP_MS } from "../src/main/widgets/widget-state";
import type { WidgetStore } from "../src/main/widgets/widget-state";

const PAGE = { id: "home" } as DeckPage;
const NOW_PLAYING: Widget = { type: "media", style: "cover" };

/** Presses on key 4 of Home, which holds `widget`. */
function keyWith(widget: Widget) {
    const feeds = {
        control: vi.fn(async () => {}),
        toggleMute: vi.fn(async () => {}),
    };
    const profile = {
        config: { activePageId: "home" },
        currentWidget: (pageId: string, cell: number) =>
            pageId === "home" && cell === 4 ? widget : undefined,
    };
    const presses = new WidgetPresses(
        profile as unknown as Profile,
        { get: () => undefined } as unknown as WidgetStore,
        { pings: {}, feeds, integrations: {} } as unknown as WidgetReadings,
        { turns: () => false } as unknown as DeckWheels,
        { send: () => {} } as unknown as MainWindow,
    );
    /** A finger on the key for `ms`, then `after` ms before whatever comes next. */
    const tap = (ms = 80, after = 120): void => {
        presses.widgetPress(PAGE, 4, true);
        vi.advanceTimersByTime(ms);
        presses.widgetPress(PAGE, 4, false);
        vi.advanceTimersByTime(after);
    };
    const controls = () => feeds.control.mock.calls.map(([what]) => what);
    return { presses, feeds, tap, controls };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("taps in a row on Now playing", () => {
    it("play or pause on one tap, once no second one comes", () => {
        const { tap, controls } = keyWith(NOW_PLAYING);
        tap(80, TAP_GAP_MS - 20);
        expect(controls()).toEqual([]);
        vi.advanceTimersByTime(20);
        expect(controls()).toEqual(["media-toggle"]);
    });

    it("skip to the next track on two", () => {
        const { tap, controls } = keyWith(NOW_PLAYING);
        tap();
        tap(80, TAP_GAP_MS);
        expect(controls()).toEqual(["media-next"]);
    });

    it("go back a track on three, at once on the third", () => {
        const { tap, controls } = keyWith(NOW_PLAYING);
        tap();
        tap();
        tap(80, 0);
        expect(controls()).toEqual(["media-previous"]);
        vi.advanceTimersByTime(TAP_GAP_MS);
        expect(controls()).toEqual(["media-previous"]);
    });

    it("go back a track on a hold, and drop a tap just before it", () => {
        const { presses, tap, controls } = keyWith(NOW_PLAYING);
        tap();
        presses.widgetPress(PAGE, 4, true);
        vi.advanceTimersByTime(HOLD_MS);
        expect(controls()).toEqual(["media-previous"]);
        presses.widgetPress(PAGE, 4, false);
        vi.advanceTimersByTime(TAP_GAP_MS * 2);
        expect(controls()).toEqual(["media-previous"]);
    });

    it("count taps too far apart as taps of their own", () => {
        const { tap, controls } = keyWith(NOW_PLAYING);
        tap(80, TAP_GAP_MS + 50);
        tap(80, TAP_GAP_MS + 50);
        expect(controls()).toEqual(["media-toggle", "media-toggle"]);
    });
});

describe("taps on a widget that tells none apart", () => {
    it("act the moment the finger lifts", () => {
        const { presses, feeds } = keyWith({ type: "mic", style: "arc" });
        presses.widgetPress(PAGE, 4, true);
        vi.advanceTimersByTime(80);
        presses.widgetPress(PAGE, 4, false);
        expect(feeds.toggleMute).toHaveBeenCalledTimes(1);
    });
});
