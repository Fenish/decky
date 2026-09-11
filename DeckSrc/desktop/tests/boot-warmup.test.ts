import { describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/shared/config";
import type { DeckConfig, KeyConfig } from "../src/shared/config";
import type { Widget } from "../src/shared/widgets";

// Views that draw nothing: each look names what it was built from.
vi.mock("../src/renderer/src/features/widgets/kinds/registry", () => {
    const build = ({ widget, muted }: { widget: Widget; muted: boolean }) =>
        new TextEncoder().encode(`${widget.type}:${muted}`);
    return {
        viewOf: (widget: Widget) => ({
            deckLook:
                widget.type === "volume" || widget.type === "mic"
                    ? { build, muted: () => false, place: () => ({ values: [], index: 0 }) }
                    : widget.type === "clock"
                      ? undefined
                      : { build, place: () => ({ values: [], index: 0 }) },
        }),
    };
});

const { lookKeys } = await import("../src/renderer/src/features/widgets/use-widget-live");
const { deckLooks } = await import("../src/renderer/src/features/widgets/wheel");

const key = (widget: Widget): KeyConfig => ({
    label: "",
    icon: "Clock",
    color: "#eee8da",
    behavior: "normal",
    action: { kind: "widget", widget },
});

const COUNTDOWN: Widget = { type: "timer", mode: "countdown", seconds: 300, adjustable: true };

/** Home, shown, with a die; Tools with a volume, a running countdown and a clock. */
function profile(): DeckConfig {
    const config = createConfig();
    config.pages[0]!.keys = { 2: key({ type: "dice", mode: "die", options: "" }) };
    config.pages.push({
        id: "tools",
        name: "Tools",
        parentId: null,
        keys: {
            0: key({ type: "volume", style: "arc" }),
            1: key(COUNTDOWN),
            4: key({ type: "clock", style: "digital" } as Widget),
        },
    });
    return config;
}

describe("loading's looks", () => {
    const now = 1_000_000;
    const running = { "tools:1": { running: true, since: now - 5000 } };

    it("go for every key the deck turns, a running countdown too, the page shown last", () => {
        const keys = lookKeys(profile(), running, now, true);
        expect(keys.map(({ page, widget }) => `${page.id}:${widget.type}`)).toEqual([
            "tools:volume",
            "tools:timer",
            "home:dice",
        ]);
    });

    it("leave out dials and dice where the deck turns only drums", () => {
        const keys = lookKeys(profile(), running, now, false);
        expect(keys.map(({ widget }) => widget.type)).toEqual(["timer"]);
    });

    it("are every look a key can take: both, where muting greys it", () => {
        const look = { background: "#000000", color: "#ffffff", label: "" };
        const names = (widget: Widget) =>
            deckLooks(look, widget, 118, 123).map((spec) => new TextDecoder().decode(spec));
        expect(names({ type: "mic", style: "bar" })).toEqual(["mic:false", "mic:true"]);
        expect(names(COUNTDOWN)).toEqual(["timer:false"]);
        expect(names({ type: "clock", style: "digital" } as Widget)).toEqual([]);
    });
});
