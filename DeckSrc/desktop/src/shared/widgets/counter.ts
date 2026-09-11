import { whole } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

export type CounterWidget = {
    type: "counter";
    start: number;
    step: number;
};

export const counterKind: WidgetKind<CounterWidget> = {
    type: "counter",
    label: "Counter",
    icon: "Plus",
    words: "count tally",
    defaults: () => ({ type: "counter", start: 0, step: 1 }),
    valid: (w) => whole(w.start, -999_999, 999_999) && whole(w.step, 1, 1000),
    press: (widget, state, hold) => {
        if (hold) return { state: undefined, message: `Counter back to ${widget.start}.` };
        const value = Math.max(
            -999_999,
            Math.min(999_999, (state?.value ?? widget.start) + widget.step),
        );
        return { state: { value }, message: `Counter at ${value}.` };
    },
};
