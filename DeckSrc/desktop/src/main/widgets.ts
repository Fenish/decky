/*---------------------------------------------------------------
 * Widget state: what a widget has done since it was set up.
 *
 * A counter's value and a timer's run survive a restart, so they are saved
 * beside the profile. A running timer is saved as when it started, so it
 * keeps counting by the real clock even while Decky is closed.
 *--------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { rename, readFile, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { keyAddress } from "../shared/config";
import type { DeckConfig } from "../shared/config";
import type { KeyLocation } from "../shared/key-layout";
import {
    hasWheel,
    KEPT_STATE,
    pomodoroSkip,
    runTime,
    stepTimer,
    timerSeconds,
    timerView,
} from "../shared/widgets";
import type { Widget, WidgetState, WidgetStates } from "../shared/widgets";

/** A press held this long is a hold: reset, skip, back to the start. */
export const HOLD_MS = 600;
/** A finger that moves this far is swiping: no tap when it lifts, no hold. */
export const SWIPE_PX = 10;
/** How far a finger moves on a wheel for one step. */
export const WHEEL_STEP_PX = 15;

/**
 * A swipe of `steps` on an adjustable countdown: the time it will run moves
 * along the wheel, and a paused countdown starts over from the new time.
 * Null when the widget has no wheel, or while it runs.
 */
export function dialTimer(
    widget: Widget,
    state: WidgetState | undefined,
    steps: number,
): WidgetState | null {
    if (widget.type !== "timer" || !hasWheel(widget) || state?.running) return null;
    const seconds = stepTimer(timerSeconds(widget, state), steps);
    return { picked: { seconds, over: widget.seconds } };
}

/** What pressing a widget does to its state, and what to report. */
export function pressWidget(
    widget: Widget,
    state: WidgetState | undefined,
    hold: boolean,
    now: number,
): { state: WidgetState | undefined; message: string } {
    switch (widget.type) {
        case "timer": {
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
        }
        case "pomodoro": {
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
        }
        case "counter": {
            if (hold) return { state: undefined, message: `Counter back to ${widget.start}.` };
            const value = Math.max(
                -999_999,
                Math.min(999_999, (state?.value ?? widget.start) + widget.step),
            );
            return { state: { value }, message: `Counter at ${value}.` };
        }
        default:
            return { state, message: "" };
    }
}

export class WidgetStore {
    private states: WidgetStates = {};
    private saving: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly path: string,
        private readonly changed: (states: WidgetStates) => void,
    ) {}

    async load(): Promise<void> {
        try {
            const saved = JSON.parse(await readFile(this.path, "utf8")) as unknown;
            if (typeof saved === "object" && saved !== null && !Array.isArray(saved))
                this.states = saved as WidgetStates;
        } catch {
            this.states = {};
        }
    }

    snapshot(): WidgetStates {
        return structuredClone(this.states);
    }

    get(address: string): WidgetState | undefined {
        return this.states[address];
    }

    set(address: string, state: WidgetState | undefined, persist = true): void {
        if (state === undefined) delete this.states[address];
        else this.states[address] = state;
        this.changed(this.snapshot());
        if (persist) this.save();
    }

    /** Keep state with the key it belongs to when keys move or swap. */
    move(from: KeyLocation, to: KeyLocation, swapped: boolean): void {
        const source = keyAddress(from.pageId, from.cell);
        const target = keyAddress(to.pageId, to.cell);
        if (source === target) return;
        const moving = this.states[source];
        const displaced = this.states[target];
        delete this.states[source];
        delete this.states[target];
        if (moving) this.states[target] = moving;
        if (swapped && displaced) this.states[source] = displaced;
        this.changed(this.snapshot());
        this.save();
    }

    /**
     * Forget state for keys that are no longer widgets. Moves are applied
     * first (move()), so a widget that changed places keeps its count.
     */
    reconcile(next: DeckConfig): void {
        let dropped = false;
        for (const address of Object.keys(this.states)) {
            const split = address.lastIndexOf(":");
            const pageId = address.slice(0, split);
            const cell = address.slice(split + 1);
            const action = next.pages.find((p) => p.id === pageId)?.keys[cell]?.action;
            if (action?.kind !== "widget") {
                delete this.states[address];
                dropped = true;
            }
        }
        if (dropped) {
            this.changed(this.snapshot());
            this.save();
        }
    }

    /** Save soon; `set(..., false)` only changes what is in memory. */
    save(): void {
        clearTimeout(this.saving);
        this.saving = setTimeout(() => {
            // Readings (pings, load, volume, prices) are read again on start;
            // only what a person did is kept.
            const kept = Object.fromEntries(
                Object.entries(this.states)
                    .map(([address, state]) => [
                        address,
                        Object.fromEntries(
                            Object.entries(state).filter(([field]) =>
                                (KEPT_STATE as readonly string[]).includes(field),
                            ),
                        ),
                    ])
                    .filter(([, state]) => Object.keys(state as object).length > 0),
            );
            const temporary = `${this.path}.tmp`;
            void writeFile(temporary, JSON.stringify(kept))
                .then(() => rename(temporary, this.path))
                .catch(() => {});
        }, 400);
    }
}

export interface PingResult {
    up: boolean;
    ms?: number;
}

/**
 * The round trip to a host, timed by opening a TCP connection to its port
 * 443: the handshake is one round trip, and a refusal is an answer too. Many
 * networks - VPNs, some routers and ISPs - drop the ICMP packets ping.exe
 * sends while connections go through, so ICMP is only asked when TCP gets no
 * answer at all: a printer or console on the LAN may answer nothing else.
 */
export async function pingHost(host: string, timeoutMs = 2000): Promise<PingResult> {
    const tcp = await tcpPing(host, timeoutMs);
    return tcp.up ? tcp : icmpPing(host, timeoutMs);
}

/** A second connection starts if the first has not answered by then. */
const SECOND_TRY_MS = 500;

/**
 * One TCP handshake, raced against a second one begun SECOND_TRY_MS later:
 * on a network that loses the odd handshake (one in thirty, measured behind
 * a VPN), one lost packet must not read as no reply. Each is timed from its
 * own start, so the answer is a round trip whichever wins.
 */
function tcpPing(host: string, timeoutMs: number): Promise<PingResult> {
    return new Promise((resolve) => {
        const sockets: Socket[] = [];
        let finished = false;
        const finish = (result: PingResult): void => {
            if (finished) return;
            finished = true;
            clearTimeout(second);
            clearTimeout(timer);
            for (const socket of sockets) socket.destroy();
            resolve(result);
        };
        const attempt = (): void => {
            const started = performance.now();
            const socket = new Socket();
            sockets.push(socket);
            const answered = (): void =>
                finish({ up: true, ms: Math.round(performance.now() - started) });
            // Refused is an answer; unknown host or no route is final.
            socket.once("error", (error: NodeJS.ErrnoException) =>
                error.code === "ECONNREFUSED" ? answered() : finish({ up: false }),
            );
            socket.connect(443, host, answered);
        };
        const second = setTimeout(attempt, SECOND_TRY_MS);
        const timer = setTimeout(() => finish({ up: false }), timeoutMs);
        attempt();
    });
}

/**
 * One ping.exe echo. Its text is in the system's language, but "TTL=" marks
 * a reply in every one, and the time sits after "=" or "<" before "ms".
 */
function icmpPing(host: string, timeoutMs: number): Promise<PingResult> {
    return new Promise((resolve) => {
        execFile(
            "ping",
            ["-n", "1", "-w", String(timeoutMs), host],
            { windowsHide: true, timeout: timeoutMs + 3000 },
            (_error, stdout) => {
                const reply = String(stdout)
                    .split(/\r?\n/)
                    .find((line) => /TTL=/i.test(line));
                const time = reply ? /[=<]\s*(\d+)\s*ms/i.exec(reply) : null;
                resolve(reply && time ? { up: true, ms: Number(time[1]) } : { up: false });
            },
        );
    });
}

/** Pings the host of every ping widget in the profile on its own interval. */
export class PingWatcher {
    private running = new Map<
        string,
        { key: string; timer: ReturnType<typeof setInterval>; check: () => void }
    >();

    constructor(
        private readonly store: WidgetStore,
        private readonly ping: (host: string) => Promise<PingResult> = pingHost,
    ) {}

    sync(config: DeckConfig): void {
        const wanted = new Map<string, { host: string; interval: number }>();
        for (const page of config.pages)
            for (const [cell, key] of Object.entries(page.keys))
                if (key.action.kind === "widget" && key.action.widget.type === "ping")
                    wanted.set(keyAddress(page.id, Number(cell)), key.action.widget);
        for (const [address, watch] of this.running) {
            const ping = wanted.get(address);
            if (!ping || watch.key !== `${ping.host}|${ping.interval}`) {
                clearInterval(watch.timer);
                this.running.delete(address);
            }
        }
        for (const [address, ping] of wanted) {
            if (this.running.has(address)) continue;
            let busy = false;
            // One ping at a time: a slow answer never stacks up behind itself.
            const check = (): void => {
                if (busy) return;
                busy = true;
                void this.ping(ping.host)
                    .then((result) => {
                        if (this.running.get(address)?.check === check)
                            this.store.set(address, { ...result, checkedAt: Date.now() }, false);
                    })
                    .finally(() => {
                        busy = false;
                    });
            };
            const timer = setInterval(check, ping.interval * 1000);
            timer.unref();
            this.running.set(address, { key: `${ping.host}|${ping.interval}`, timer, check });
            check();
        }
    }

    /** Ping now: what a tap on the key does. */
    now(address: string): void {
        this.running.get(address)?.check();
    }

    stop(): void {
        for (const watch of this.running.values()) clearInterval(watch.timer);
        this.running.clear();
    }
}
