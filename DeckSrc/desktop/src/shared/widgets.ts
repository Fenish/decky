/*---------------------------------------------------------------
 * Widgets: keys whose picture keeps changing - a clock, a timer.
 *
 * A widget is a key action like any other, so it lives in the profile with
 * the key's appearance. What changes while it runs (a counter's value, when a
 * timer started) is widget state, kept by the main process. Everything here
 * is pure: the same widget, state and time always give the same picture, so
 * the editor preview, the dashboard and the deck agree.
 *--------------------------------------------------------------*/

export type ClockStyle = "digital" | "analog" | "minimal";
export type NoteSize = "small" | "medium" | "large";

export type Widget =
    | {
          type: "clock";
          style: ClockStyle;
          hour12: boolean;
          seconds: boolean;
          date: boolean;
          /** An IANA time zone such as "Europe/Istanbul"; empty for this PC's. */
          timeZone: string;
      }
    /**
     * A stopwatch counts up; a countdown counts down from `seconds`. An
     * `adjustable` countdown's time is picked on the deck, with a swipe. A
     * countdown rings when it ends unless `sound` is false.
     */
    | {
          type: "timer";
          mode: "stopwatch" | "countdown";
          seconds: number;
          adjustable?: boolean;
          sound?: boolean;
      }
    /** Minutes of focus, then of rest, repeating. */
    | { type: "pomodoro"; focus: number; rest: number }
    /** Days until `date`, a YYYY-MM-DD local date. */
    | { type: "countdown"; date: string; title: string }
    | { type: "counter"; start: number; step: number }
    /** How long a host takes to answer, asked every `interval` seconds. */
    | { type: "ping"; host: string; interval: number }
    | { type: "note"; text: string; size: NoteSize }
    /** The PC's volume, turned on the deck: an arc or a bar. */
    | { type: "volume"; style: "arc" | "bar" }
    /** What is playing, in any app Windows knows of: cover, title, progress. */
    | { type: "media"; style: "cover" | "card" }
    /** CPU and memory in use over the last minute, sampled every `interval` s. */
    | { type: "system"; show: "cpu" | "ram" | "both"; style: "graph" | "rings"; interval: number }
    /** Whether the microphone is muted, as Windows has it. */
    | { type: "mic" }
    /** A die, a coin, yes or no, or a pick from `options` (comma separated). */
    | { type: "dice"; mode: "die" | "coin" | "yesno" | "list"; options: string }
    /** A coin's price in US dollars, live (src/main/crypto-feed.ts). */
    | { type: "crypto"; coin: string; style: "chart" | "ticker" };

export type WidgetType = Widget["type"];

/** What changes while a widget runs. Unused fields stay absent. */
export interface WidgetState {
    running?: boolean;
    /** When the current run began, in epoch milliseconds. */
    since?: number;
    /** Time run before `since`, in milliseconds. */
    elapsed?: number;
    value?: number;
    /**
     * A countdown's time picked on the deck, in seconds, and the time set in
     * the app it replaced: a new time set in the app wins.
     */
    picked?: { seconds: number; over: number };
    /** A ping's last answer: whether the host replied, and in how many ms. */
    up?: boolean;
    ms?: number;
    checkedAt?: number;
    /** The PC's volume, 0-100, and whether it (or the microphone) is muted. */
    level?: number;
    muted?: boolean;
    /** There is no such device: no microphone, say. */
    missing?: boolean;
    /** Samples over the last minute, oldest first: CPU and memory in %. */
    cpu?: number[];
    ram?: number[];
    /** Where a die the deck threw came to lie (src/shared/die.ts). */
    rest?: number;
    track?: Track;
    /** A price, its change over 24 hours in %, the price a minute before, and the last day's prices. */
    price?: number;
    change?: number;
    previous?: number;
    history?: number[];
}
export type WidgetStates = Record<string, WidgetState>;

/** What is playing. `position` (ms) was true at `at` (epoch ms). */
export interface Track {
    title: string;
    artist: string;
    playing: boolean;
    position: number;
    duration: number;
    at: number;
    /** The cover, as a data URL. */
    art?: string;
}

/** What survives a restart: what a person did, not what was read or fetched. */
export const KEPT_STATE = ["running", "since", "elapsed", "value", "picked", "rest"] as const;

/** The widgets to pick from, with other words people search for them by. */
export const WIDGET_CHOICES: { type: WidgetType; label: string; icon: string; words: string }[] = [
    { type: "clock", label: "Clock", icon: "Clock", words: "time world zone" },
    { type: "timer", label: "Timer", icon: "Timer", words: "stopwatch countdown alarm" },
    { type: "pomodoro", label: "Pomodoro", icon: "Hourglass", words: "focus break work" },
    { type: "countdown", label: "Countdown", icon: "CalendarClock", words: "days date event" },
    {
        type: "media",
        label: "Now playing",
        icon: "Music",
        words: "music song spotify track player media currently playing pause",
    },
    { type: "volume", label: "Volume", icon: "Volume2", words: "sound audio speaker mute" },
    { type: "mic", label: "Microphone", icon: "Mic", words: "mic mute voice" },
    { type: "system", label: "System", icon: "Cpu", words: "cpu ram memory task manager" },
    { type: "ping", label: "Ping", icon: "Activity", words: "latency internet server" },
    { type: "crypto", label: "Crypto", icon: "Bitcoin", words: "bitcoin btc price coin" },
    { type: "counter", label: "Counter", icon: "Plus", words: "count tally" },
    { type: "dice", label: "Dice", icon: "Dices", words: "die roll random coin decide" },
    { type: "note", label: "Note", icon: "StickyNote", words: "text memo" },
];

/** Coins to choose from: CoinGecko's id, the ticker, and its colour. */
export const COINS: { id: string; symbol: string; color: string }[] = [
    { id: "bitcoin", symbol: "BTC", color: "#f7931a" },
    { id: "ethereum", symbol: "ETH", color: "#8a92f2" },
    { id: "solana", symbol: "SOL", color: "#a77bff" },
    { id: "binancecoin", symbol: "BNB", color: "#f3ba2f" },
    { id: "ripple", symbol: "XRP", color: "#9fb2c8" },
    { id: "dogecoin", symbol: "DOGE", color: "#d4b44a" },
    { id: "cardano", symbol: "ADA", color: "#5b8def" },
    { id: "avalanche-2", symbol: "AVAX", color: "#ef5a5b" },
    { id: "the-open-network", symbol: "TON", color: "#2aa7e8" },
];

export function defaultWidget(type: WidgetType, now = Date.now()): Widget {
    switch (type) {
        case "clock":
            return {
                type,
                style: "digital",
                hour12: false,
                seconds: false,
                date: true,
                timeZone: "",
            };
        case "timer":
            return { type, mode: "stopwatch", seconds: 300 };
        case "pomodoro":
            return { type, focus: 25, rest: 5 };
        case "countdown":
            return { type, date: localDate(now + 30 * 86_400_000), title: "Launch" };
        case "counter":
            return { type, start: 0, step: 1 };
        case "ping":
            return { type, host: "google.com", interval: 5 };
        case "note":
            return { type, text: "Note", size: "medium" };
        case "volume":
            return { type, style: "arc" };
        case "media":
            return { type, style: "cover" };
        case "system":
            return { type, show: "both", style: "graph", interval: 2 };
        case "mic":
            return { type };
        case "dice":
            return { type, mode: "die", options: "Pizza, Burger, Sushi" };
        case "crypto":
            return { type, coin: "bitcoin", style: "chart" };
    }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A host name or IPv4 address, or an IPv6 one. Never anything starting with a
// dash: the host is handed to ping.exe as an argument.
const HOST_NAME =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV6 = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;

export function validTimeZone(zone: string): boolean {
    if (zone === "") return true;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

export function validPingHost(host: string): boolean {
    return HOST_NAME.test(host) || IPV6.test(host);
}

const whole = (v: unknown, min: number, max: number): boolean =>
    Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v: unknown, max: number, allowEmpty = false): boolean =>
    typeof v === "string" &&
    (allowEmpty || v.trim().length > 0) &&
    v.length <= max &&
    !Array.from(v).some((c) => c.charCodeAt(0) < 32 && c !== "\n");

export function validWidget(v: unknown): v is Widget {
    if (typeof v !== "object" || v === null) return false;
    const w = v as Record<string, unknown>;
    switch (w.type) {
        case "clock":
            return (
                ["digital", "analog", "minimal"].includes(String(w.style)) &&
                typeof w.hour12 === "boolean" &&
                typeof w.seconds === "boolean" &&
                typeof w.date === "boolean" &&
                typeof w.timeZone === "string" &&
                w.timeZone.length <= 64 &&
                validTimeZone(w.timeZone)
            );
        case "timer":
            return (
                (w.mode === "stopwatch" || w.mode === "countdown") &&
                whole(w.seconds, 1, 86_399) &&
                (w.adjustable === undefined || typeof w.adjustable === "boolean") &&
                (w.sound === undefined || typeof w.sound === "boolean")
            );
        case "pomodoro":
            return whole(w.focus, 1, 180) && whole(w.rest, 1, 180);
        case "countdown":
            return typeof w.date === "string" && DATE.test(w.date) && text(w.title, 24, true);
        case "counter":
            return whole(w.start, -999_999, 999_999) && whole(w.step, 1, 1000);
        case "ping":
            return (
                typeof w.host === "string" && validPingHost(w.host) && whole(w.interval, 5, 3600)
            );
        case "note":
            return text(w.text, 120) && ["small", "medium", "large"].includes(String(w.size));
        case "volume":
            return w.style === "arc" || w.style === "bar";
        case "media":
            return w.style === "cover" || w.style === "card";
        case "system":
            return (
                ["cpu", "ram", "both"].includes(String(w.show)) &&
                (w.style === "graph" || w.style === "rings") &&
                [1, 2, 5].includes(Number(w.interval))
            );
        case "mic":
            return true;
        case "dice":
            return (
                ["die", "coin", "yesno", "list"].includes(String(w.mode)) &&
                text(w.options, 120, true) &&
                (w.mode !== "list" || listOptions(String(w.options)).length >= 2)
            );
        case "crypto":
            return (
                COINS.some((coin) => coin.id === w.coin) &&
                (w.style === "chart" || w.style === "ticker")
            );
        default:
            return false;
    }
}

/** A dice list's options: comma or line separated, blanks dropped, at most 8 of 14 characters. */
export function listOptions(options: string): string[] {
    return options
        .split(/[,\n]/)
        .map((option) => option.trim().slice(0, 14))
        .filter(Boolean)
        .slice(0, 8);
}

/** What a dice widget can land on, in order. */
export function diceFaces(widget: Extract<Widget, { type: "dice" }>): string[] {
    switch (widget.mode) {
        case "die":
            return ["1", "2", "3", "4", "5", "6"];
        case "coin":
            return ["Heads", "Tails"];
        case "yesno":
            return ["Yes", "No"];
        case "list":
            return listOptions(widget.options);
    }
}

/** Where a track is now: its position moves on by itself while it plays. */
export function trackPosition(track: Track, now: number): number {
    return track.playing
        ? Math.min(track.duration || Infinity, track.position + Math.max(0, now - track.at))
        : track.position;
}

/** A price in dollars, shortened only when it would not fit: $76,904, $1.25M, $0.1234. */
export function formatPrice(price: number): string {
    const sign = "$";
    if (price >= 1_000_000)
        return (
            sign +
            new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 2,
            }).format(price)
        );
    if (price >= 1000) return sign + Math.round(price).toLocaleString("en-US");
    if (price >= 1) return sign + price.toFixed(2);
    return sign + price.toPrecision(4);
}

/** YYYY-MM-DD for a moment, in this PC's time zone. */
export function localDate(at: number): string {
    const d = new Date(at);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Milliseconds run so far, counting the current run if there is one. */
export function runTime(state: WidgetState | undefined, now: number): number {
    const before = state?.elapsed ?? 0;
    return state?.running && state.since !== undefined
        ? before + Math.max(0, now - state.since)
        : before;
}

/** "4:05", or "1:02:03" past an hour. Rounds a countdown's remainder up. */
export function formatDuration(ms: number, roundUp = false): string {
    const total = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const two = (n: number): string => String(n).padStart(2, "0");
    return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

type TimerWidget = Extract<Widget, { type: "timer" }>;

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

/**
 * How the deck turns a widget's key by itself, if it does: a drum (an
 * adjustable countdown at rest; a coin, yes or no, or a list), a dial
 * (volume), or a die it throws.
 */
export function deckTurned(
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
): "drum" | "dial" | "die" | null {
    if (widget.type === "volume") return "dial";
    if (widget.type === "dice") return widget.mode === "die" ? "die" : "drum";
    if (widget.type === "timer" && hasWheel(widget) && runTime(state, now) === 0) return "drum";
    return null;
}

/**
 * A dice drum's labels, as indexes into its faces: the faces over and over,
 * so a roll can spin a few turns and land anywhere.
 */
export function diceLabels(widget: Extract<Widget, { type: "dice" }>): number[] {
    const faces = diceFaces(widget).length;
    return Array.from({ length: Math.floor(120 / faces) * faces }, (_, i) => i % faces);
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

/**
 * Where a pomodoro is: focus and rest alternate for as long as it runs, so the
 * phase follows from the total run time alone.
 */
export function pomodoroView(
    widget: Extract<Widget, { type: "pomodoro" }>,
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
    widget: Extract<Widget, { type: "pomodoro" }>,
    state: WidgetState | undefined,
    now: number,
): number {
    const focus = widget.focus * 60_000;
    const cycle = focus + widget.rest * 60_000;
    const run = runTime(state, now);
    const start = run - (run % cycle);
    return run % cycle < focus ? start + focus : start + cycle;
}

/** Whole days from today to `date`, both in this PC's time zone. */
export function daysUntil(date: string, now: number): number {
    const match = DATE.exec(date);
    if (!match) return 0;
    const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function clockParts(
    widget: Extract<Widget, { type: "clock" }>,
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

/**
 * Milliseconds until the widget's picture next changes, or null when only an
 * event (a press, a check, an edit) can change it.
 */
export function nextChange(
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
): number | null {
    switch (widget.type) {
        case "clock":
            // Analog hands move every second only when the second hand shows.
            return widget.seconds ? 1000 - (now % 1000) : 60_000 - (now % 60_000);
        case "timer":
        case "pomodoro": {
            if (!state?.running) return null;
            const run = runTime(state, now);
            return 1000 - (run % 1000);
        }
        case "countdown": {
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);
            return midnight.getTime() - now;
        }
        case "media": {
            // The progress bar moves every second while the track plays.
            const track = state?.track;
            if (!track?.playing) return null;
            return 1000 - (trackPosition(track, now) % 1000);
        }
        default:
            return null;
    }
}
