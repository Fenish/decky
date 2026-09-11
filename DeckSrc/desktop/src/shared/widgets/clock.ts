import type { WidgetKind } from "./widget-kind";

export type ClockStyle = "digital" | "analog" | "minimal";

export type ClockWidget = {
    type: "clock";
    style: ClockStyle;
    hour12: boolean;
    seconds: boolean;
    date: boolean;
    /** An IANA time zone such as "Europe/Istanbul"; empty for this PC's. */
    timeZone: string;
};

export function validTimeZone(zone: string): boolean {
    if (zone === "") return true;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

export function clockParts(
    widget: ClockWidget,
    now: number,
): {
    hours: number;
    minutes: number;
    seconds: number;
    /** The hour as shown: two digits in either format, "02" at 2 AM or 2 PM. */
    hour: string;
    time: string;
    period: string;
    date: string;
} {
    const zone = widget.timeZone || undefined;
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(now)
            .map((part) => [part.type, part.value]),
    );
    const hours = Number(parts.hour) % 24;
    const minutes = Number(parts.minute);
    const seconds = Number(parts.second);
    const hour = String(widget.hour12 ? hours % 12 || 12 : hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const time = widget.seconds
        ? `${hour}:${mm}:${String(seconds).padStart(2, "0")}`
        : `${hour}:${mm}`;
    const date = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(now);
    return { hours, minutes, seconds, hour, time, period: hours < 12 ? "AM" : "PM", date };
}

export const clockKind: WidgetKind<ClockWidget> = {
    type: "clock",
    label: "Clock",
    icon: "Clock",
    words: "time world zone",
    defaults: () => ({
        type: "clock",
        style: "digital",
        hour12: false,
        seconds: false,
        date: true,
        timeZone: "",
    }),
    valid: (w) =>
        ["digital", "analog", "minimal"].includes(String(w.style)) &&
        typeof w.hour12 === "boolean" &&
        typeof w.seconds === "boolean" &&
        typeof w.date === "boolean" &&
        typeof w.timeZone === "string" &&
        w.timeZone.length <= 64 &&
        validTimeZone(w.timeZone),
    // Analog hands move every second only when the second hand shows.
    nextChange: (widget, _state, now) =>
        widget.seconds ? 1000 - (now % 1000) : 60_000 - (now % 60_000),
};
