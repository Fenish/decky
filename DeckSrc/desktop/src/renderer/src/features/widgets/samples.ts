import type { Widget, WidgetState } from "../../../../shared/widgets";

// A smooth, made-up curve: `count` samples around `base`.
const wave = (count: number, base: number, swing: number, seed: number): number[] =>
    Array.from({ length: count }, (_, i) =>
        Math.max(
            0,
            base + swing * Math.sin(i / 4 + seed) + swing * 0.5 * Math.sin(i / 1.7 + seed * 2),
        ),
    );

/**
 * Readings made up for the style pickers, so each style can be seen before
 * a real reading comes in. Widgets that read nothing get none.
 */
export function sampleState(widget: Widget, now: number): WidgetState | undefined {
    switch (widget.type) {
        case "volume":
            return { level: 62, muted: false };
        case "mic":
            return { muted: false };
        case "media":
            return {
                track: {
                    title: "Midnight City",
                    artist: "M83",
                    playing: true,
                    position: 95_000,
                    duration: 243_000,
                    at: now,
                },
            };
        case "system":
            return {
                cpu: wave(60, 30, 12, 1).map(Math.round),
                ram: wave(60, 62, 3, 2).map(Math.round),
            };
        case "crypto":
            return {
                price: 76_904,
                change: 1.42,
                previous: 76_800,
                history: wave(25, 76_000, 500, 1),
            };
        case "dice":
            return { value: 3 };
        default:
            return undefined;
    }
}
