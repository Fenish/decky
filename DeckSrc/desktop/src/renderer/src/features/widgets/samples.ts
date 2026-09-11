import type { Widget, WidgetState } from "../../../../shared/widgets";
import { viewOf } from "./kinds/registry";

// A smooth, made-up curve: `count` samples around `base`.
export const wave = (count: number, base: number, swing: number, seed: number): number[] =>
    Array.from({ length: count }, (_, i) =>
        Math.max(
            0,
            base + swing * Math.sin(i / 4 + seed) + swing * 0.5 * Math.sin(i / 1.7 + seed * 2),
        ),
    );

/**
 * Readings made up for the style pickers, so each style can be seen before
 * a real reading comes in. Widgets that read nothing get none; each type's
 * readings are its view's (kinds/).
 */
export function sampleState(widget: Widget, now: number): WidgetState | undefined {
    return viewOf(widget).sample?.(now);
}
