import { localDate } from "../widgets";
import { text } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/** Days until `date`, a YYYY-MM-DD local date. */
export type CountdownWidget = {
    type: "countdown";
    date: string;
    title: string;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days from today to `date`, both in this PC's time zone. */
export function daysUntil(date: string, now: number): number {
    const match = DATE.exec(date);
    if (!match) return 0;
    const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export const countdownKind: WidgetKind<CountdownWidget> = {
    type: "countdown",
    label: "Countdown",
    icon: "CalendarClock",
    words: "days date event",
    defaults: (now) => ({
        type: "countdown",
        date: localDate(now + 30 * 86_400_000),
        title: "Launch",
    }),
    valid: (w) => typeof w.date === "string" && DATE.test(w.date) && text(w.title, 24, true),
    nextChange: (_widget, _state, now) => {
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return midnight.getTime() - now;
    },
};
