import { formatDuration, runTick, runTime } from "../widgets";
import type { WidgetState } from "../widgets";
import { whole } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/** Minutes of focus, then of rest, repeating. */
export type PomodoroWidget = {
    type: "pomodoro";
    focus: number;
    rest: number;
};

/**
 * Where a pomodoro is: focus and rest alternate for as long as it runs, so the
 * phase follows from the total run time alone.
 */
export function pomodoroView(
    widget: PomodoroWidget,
    state: WidgetState | undefined,
    now: number,
): { phase: "focus" | "rest"; text: string; progress: number; rounds: number } {
    const focus = widget.focus * 60_000;
    const cycle = focus + widget.rest * 60_000;
    const run = runTime(state, now);
    const into = run % cycle;
    const phase = into < focus ? "focus" : "rest";
    const length = phase === "focus" ? focus : cycle - focus;
    const spent = phase === "focus" ? into : into - focus;
    return {
        phase,
        text: formatDuration(length - spent, true),
        progress: spent / length,
        rounds: Math.floor(run / cycle),
    };
}

/** The run time at the start of the pomodoro's next phase. */
export function pomodoroSkip(
    widget: PomodoroWidget,
    state: WidgetState | undefined,
    now: number,
): number {
    const focus = widget.focus * 60_000;
    const cycle = focus + widget.rest * 60_000;
    const run = runTime(state, now);
    const start = run - (run % cycle);
    return run % cycle < focus ? start + focus : start + cycle;
}

export const pomodoroKind: WidgetKind<PomodoroWidget> = {
    type: "pomodoro",
    label: "Pomodoro",
    icon: "Hourglass",
    words: "focus break work",
    defaults: () => ({ type: "pomodoro", focus: 25, rest: 5 }),
    valid: (w) => whole(w.focus, 1, 180) && whole(w.rest, 1, 180),
    nextChange: (_widget, state, now) => runTick(state, now),
    press: (widget, state, hold, now) => {
        if (hold) {
            const elapsed = pomodoroSkip(widget, state, now);
            return {
                state: state?.running ? { running: true, since: now, elapsed } : { elapsed },
                message: "Skipped to the next phase.",
            };
        }
        if (state?.running)
            return {
                state: { running: false, elapsed: runTime(state, now) },
                message: "Pomodoro paused.",
            };
        return {
            state: { running: true, since: now, elapsed: state?.elapsed ?? 0 },
            message: "Pomodoro started.",
        };
    },
};
