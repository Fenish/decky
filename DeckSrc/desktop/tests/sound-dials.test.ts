import { describe, expect, it, vi } from "vitest";
import type { Widget } from "../src/shared/widgets";
import type { MainWindow } from "../src/main/app/main-window";
import type { Profile } from "../src/main/profile/profile";
import type { DeckWheels } from "../src/main/widgets/deck-wheels";
import type { WidgetReadings } from "../src/main/widgets/readings";
import { WidgetPresses } from "../src/main/widgets/presses";
import type { WidgetStore } from "../src/main/widgets/widget-state";

/** Presses over one key holding `widget`, with the deck's dial there armed or not. */
function pressesFor(widget: Widget, armed: boolean) {
    const feeds = {
        setLevel: vi.fn(async () => {}),
        toggleMute: vi.fn(async () => {}),
    };
    const wheels = { dialTurned: vi.fn(() => armed) };
    const profile = {
        config: { activePageId: "home" },
        currentWidget: (pageId: string, cell: number) =>
            pageId === "home" && cell === 4 ? widget : undefined,
    };
    const presses = new WidgetPresses(
        profile as unknown as Profile,
        { get: () => undefined } as unknown as WidgetStore,
        { pings: {}, feeds, integrations: {} } as unknown as WidgetReadings,
        wheels as unknown as DeckWheels,
        { send: () => {} } as unknown as MainWindow,
    );
    return { presses, feeds, wheels };
}

describe("sound dials on the deck", () => {
    it("set the level of the device their widget shows", () => {
        const volume = pressesFor({ type: "volume", style: "arc" }, true);
        volume.presses.widgetTurned(4, 55);
        expect(volume.wheels.dialTurned).toHaveBeenCalledWith(4, 55);
        expect(volume.feeds.setLevel).toHaveBeenCalledWith("speaker", 55);

        const mic = pressesFor({ type: "mic", style: "bar" }, true);
        mic.presses.widgetTurned(4, 30);
        expect(mic.feeds.setLevel).toHaveBeenCalledWith("microphone", 30);
    });

    it("do nothing where the deck has no dial armed", () => {
        const { presses, feeds } = pressesFor({ type: "mic", style: "arc" }, false);
        presses.widgetTurned(4, 30);
        expect(feeds.setLevel).not.toHaveBeenCalled();
    });

    it("mute their own device on a tap", () => {
        const { presses, feeds } = pressesFor({ type: "mic", style: "arc" }, true);
        expect(presses.useWidget("home", 4, { type: "mic", style: "arc" }, "tap").ok).toBe(true);
        expect(feeds.toggleMute).toHaveBeenCalledWith("home:4", "microphone");
    });
});
