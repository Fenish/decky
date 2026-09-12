/*---------------------------------------------------------------
 * A speed test on a key: tap it and it measures the line against the nearest
 * Speedtest.net server - its latency, then download, then upload - and rests
 * on the result until it is tapped again. A tap while it runs stops it.
 *
 * The run itself is main's (src/main/widgets/speedtest.ts); this is what the
 * key knows of it.
 *--------------------------------------------------------------*/

import type { WidgetKind } from "./widget-kind";

export type SpeedtestWidget = {
    type: "speedtest";
};

/** How long each transfer runs. Both ways, so a run takes this twice, plus the pings. */
export const SPEED_MS = 10_000;

/** Where a run has got to. */
export type SpeedPhase = "ping" | "down" | "up" | "done" | "failed";

/** A run on a key, as the key draws it. */
export interface SpeedRun {
    phase: SpeedPhase;
    /**
     * When the phase began, and how long it takes (ms) where that is known -
     * the arc the deck sweeps runs on these. Looking for a server has no
     * length: its arc goes round instead.
     */
    since: number;
    length?: number;
    /** Megabits a second as far as the phase has measured. */
    now?: number;
    /** What the run found: megabits a second, and the best ping in ms. */
    down?: number;
    up?: number;
    ping?: number;
    /** The server it used: "Istanbul, Turkey". */
    server?: string;
    /** When the run ended, done or failed, and why it failed. */
    at?: number;
    message?: string;
}

/**
 * The top of the dial. A line faster than this fills it and no more; the
 * scale below it is logarithmic, as the dials of speed tests are, so 10 and
 * 100 megabits are both somewhere a needle can point at.
 */
export const SPEED_TOP = 1000;

/** Where a speed sits on the dial, 0 to 1. */
export function speedShare(mbps: number): number {
    return Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, mbps)) / Math.log10(1 + SPEED_TOP)));
}

/** Whether a run is still going. */
export function speedRunning(run: SpeedRun | undefined): boolean {
    return run !== undefined && run.phase !== "done" && run.phase !== "failed";
}

/** A speed as the key writes it: three figures at most, so it fits. */
export function speedFigure(mbps: number): string {
    if (mbps >= 100) return String(Math.round(mbps));
    if (mbps >= 10) return mbps.toFixed(1);
    return mbps.toFixed(2);
}

export const speedtestKind: WidgetKind<SpeedtestWidget> = {
    type: "speedtest",
    label: "Speed test",
    icon: "Gauge",
    words: "speedtest internet bandwidth download upload mbps ookla broadband line",
    defaults: () => ({ type: "speedtest" }),
    valid: () => true,
};
