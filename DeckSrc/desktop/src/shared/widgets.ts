/*---------------------------------------------------------------
 * Widgets: keys whose picture keeps changing - a clock, a timer.
 *
 * A widget is a key action like any other, so it lives in the profile with
 * the key's appearance. What changes while it runs (a counter's value, when a
 * timer started) is widget state, kept by the main process. Everything here
 * is pure: the same widget, state and time always give the same picture, so
 * the editor preview, the dashboard and the deck agree.
 *
 * Each type is a kind of its own in widgets/, and widgets/registry.ts lists
 * them. This file holds what they all share.
 *--------------------------------------------------------------*/

import type { ClockWidget } from "./widgets/clock";
import type { CountdownWidget } from "./widgets/countdown";
import type { CounterWidget } from "./widgets/counter";
import type { CryptoWidget } from "./widgets/crypto";
import type { DiceWidget } from "./widgets/dice";
import type { Choice } from "./widgets/choice";
import type { DiscordInbox, DiscordWidget, VoiceChannel } from "./widgets/discord";
import type { MediaWidget } from "./widgets/media";
import type { MicWidget } from "./widgets/mic";
import type { NoteWidget } from "./widgets/note";
import type { ObsState, ObsWidget } from "./widgets/obs";
import type { PingWidget } from "./widgets/ping";
import type { PomodoroWidget } from "./widgets/pomodoro";
import type { SpeedtestWidget, SpeedRun } from "./widgets/speedtest";
import type { SystemWidget } from "./widgets/system";
import type { TimerWidget } from "./widgets/timer";
import type { VolumeWidget } from "./widgets/volume";

export type Widget =
    | ClockWidget
    | TimerWidget
    | PomodoroWidget
    | CountdownWidget
    | CounterWidget
    | PingWidget
    | NoteWidget
    | VolumeWidget
    | MediaWidget
    | SystemWidget
    | SpeedtestWidget
    | MicWidget
    | DiceWidget
    | CryptoWidget
    | ObsWidget<"obs-record">
    | ObsWidget<"obs-stream">
    | DiscordWidget;

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
    /** What OBS says of the output an OBS widget shows (widgets/obs.ts). */
    obs?: ObsState;
    /** How a speed test on the key is going, or how the last one went (widgets/speedtest.ts). */
    speed?: SpeedRun;
    /** A touch's countdown: until when (epoch ms), and whether it will start, or stop, what the key shows. */
    arming?: { until: number; start: boolean };
    /**
     * A design being picked on the key, held down to start: which of the
     * widget's designs it shows now, and how many there are (a dot each). It
     * goes once the design is kept.
     */
    choosing?: { index: number; count: number };
    /** What Discord says of the voice channel, or call, a voice key shows (widgets/discord.ts). */
    voice?: VoiceChannel;
    /** The option a key that cycles through options shows (widgets/choice.ts): Discord's microphone. */
    choice?: Choice;
    /** Discord's notifications, for a notifications key. */
    inbox?: DiscordInbox;
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

/** Milliseconds to the run's next whole second while it runs; null while it does not. */
export function runTick(state: WidgetState | undefined, now: number): number | null {
    if (!state?.running) return null;
    const run = runTime(state, now);
    return 1000 - (run % 1000);
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
