/*---------------------------------------------------------------
 * Ping widgets: the round trip to a host, checked on each widget's own
 * interval and kept as its state.
 *--------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { Socket } from "node:net";
import { keyAddress } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { WidgetStore } from "./widget-state";

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
