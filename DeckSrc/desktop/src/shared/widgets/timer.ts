import { formatDuration, runTick, runTime } from "../widgets";
import type { Widget, WidgetState } from "../widgets";
import { whole } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/**
 * A stopwatch counts up; a countdown counts down from `seconds`. An
 * `adjustable` countdown's time is picked on the deck, with a swipe. A
 * countdown rings when it ends unless `sound` is false.
 */
export type TimerWidget = {
    type: "timer";
    mode: "stopwatch" | "countdown";
    seconds: number;
    adjustable?: boolean;
    sound?: boolean;
};

/** Whether the widget is a countdown whose time is picked on the deck. */
export function hasWheel(widget: Widget): boolean {
    return widget.type === "timer" && widget.mode === "countdown" && widget.adjustable === true;
}

/**
 * The times a deck wheel steps through: 10 seconds apart up to a minute,
 * minutes up to an hour, then 5 minutes up to three hours.
 */
export const TIMER_STEPS: readonly number[] = [
    ...Array.from({ length: 6 }, (_, i) => (i + 1) * 10),
    ...Array.from({ length: 59 }, (_, i) => (i + 2) * 60),
    ...Array.from({ length: 24 }, (_, i) => 3600 + (i + 1) * 300),
];

/**
 * `steps` along TIMER_STEPS from `seconds`, stopping at either end. A time
 * between two steps - 7:30, set in the app - goes to the step beyond it in
 * the direction of travel, as the first step.
 */
export function stepTimer(seconds: number, steps: number): number {
    if (steps === 0) return seconds;
    const last = TIMER_STEPS.length - 1;
    let index: number;
    if (steps > 0) {
        const above = TIMER_STEPS.findIndex((step) => step > seconds);
        index = above < 0 ? last : above + steps - 1;
    } else {
        let below = -1;
        for (let i = 0; i <= last && TIMER_STEPS[i]! < seconds; i++) below = i;
        index = below < 0 ? 0 : below + steps + 1;
    }
    return TIMER_STEPS[Math.max(0, Math.min(last, index))]!;
}

/** The times an adjustable countdown's wheel offers: the steps, and the app's own time. */
export function wheelValues(widget: TimerWidget): number[] {
    return [...new Set([...TIMER_STEPS, widget.seconds])].sort((a, b) => a - b);
}

/** A countdown's time in seconds: as picked on the deck, else as set in the app. */
export function timerSeconds(widget: TimerWidget, state: WidgetState | undefined): number {
    const picked = state?.picked;
    return hasWheel(widget) && picked?.over === widget.seconds ? picked.seconds : widget.seconds;
}

/**
 * When a running countdown that rings ends, in epoch milliseconds; null for
 * one that is not running, is silent, or is not a countdown. It keeps running
 * past its end - showing 0:00 - until a tap sets it back.
 */
export function countdownEnd(widget: Widget, state: WidgetState | undefined): number | null {
    if (widget.type !== "timer" || widget.mode !== "countdown" || widget.sound === false)
        return null;
    if (!state?.running || state.since === undefined) return null;
    return state.since + timerSeconds(widget, state) * 1000 - (state.elapsed ?? 0);
}

export function timerView(
    widget: TimerWidget,
    state: WidgetState | undefined,
    now: number,
): { text: string; progress: number; done: boolean } {
    const run = runTime(state, now);
    if (widget.mode === "stopwatch") return { text: formatDuration(run), progress: 0, done: false };
    const total = timerSeconds(widget, state) * 1000;
    const left = Math.max(0, total - run);
    return {
        text: formatDuration(left, true),
        progress: Math.min(1, run / total),
        done: left === 0,
    };
}

export const timerKind: WidgetKind<TimerWidget> = {
    type: "timer",
    label: "Timer",
    icon: "Timer",
    words: "stopwatch countdown alarm",
    defaults: () => ({ type: "timer", mode: "stopwatch", seconds: 300 }),
    valid: (w) =>
        (w.mode === "stopwatch" || w.mode === "countdown") &&
        whole(w.seconds, 1, 86_399) &&
        (w.adjustable === undefined || typeof w.adjustable === "boolean") &&
        (w.sound === undefined || typeof w.sound === "boolean"),
    nextChange: (_widget, state, now) => runTick(state, now),
    press: (widget, state, hold, now) => {
        // A time picked on the deck stays through starts, pauses and resets.
        const keep = state?.picked ? { picked: state.picked } : {};
        if (hold) return { state: state?.picked ? keep : undefined, message: "Timer reset." };
        // A countdown that ended: the tap stops its sound and sets it back
        // to its time, ready for the next tap to start it.
        if (
            widget.mode === "countdown" &&
            runTime(state, now) > 0 &&
            timerView(widget, state, now).done
        )
            return { state: state?.picked ? keep : undefined, message: "Timer reset." };
        if (state?.running)
            return {
                state: { ...keep, running: false, elapsed: runTime(state, now) },
                message: "Timer paused.",
            };
        return {
            state: { ...keep, running: true, since: now, elapsed: state?.elapsed ?? 0 },
            message: "Timer started.",
        };
    },
    /**
     * A swipe of `steps` on an adjustable countdown: the time it will run moves
     * along the wheel, and a paused countdown starts over from the new time.
     * Null when the widget has no wheel, or while it runs.
     */
    swipe: (widget, state, steps) => {
        if (!hasWheel(widget) || state?.running) return null;
        const seconds = stepTimer(timerSeconds(widget, state), steps);
        return { picked: { seconds, over: widget.seconds } };
    },
    // An adjustable countdown at rest is a drum on the deck.
    deckTurned: (widget, state, now) =>
        hasWheel(widget) && runTime(state, now) === 0 ? "drum" : null,
    fingerTurns: (widget) => hasWheel(widget),
};
