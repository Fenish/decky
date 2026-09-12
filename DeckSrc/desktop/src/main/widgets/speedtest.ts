/*---------------------------------------------------------------
 * The speed test behind a speed test key, over Speedtest.net's own servers -
 * the ones their apps use, so there is one near wherever you are.
 *
 * A run goes as their web client's does: their config says where you are,
 * their list says where the servers are, the nearest few are pinged and the
 * quickest wins, and then the line is filled one way and then the other for
 * SPEED_MS each. Speed is measured over the bytes that moved, the first
 * WARMUP_MS left out so TCP's slow start is not counted as the line's speed.
 *
 * Nothing here is Ookla's code; it is their published endpoints, asked the
 * way their client asks. The XML is read for the few attributes that matter
 * rather than parsed in full.
 *--------------------------------------------------------------*/

import http from "node:http";
import https from "node:https";
import { keyAddress } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import { SPEED_MS } from "../../shared/widgets/speedtest";
import type { SpeedRun } from "../../shared/widgets/speedtest";
import type { WidgetStore } from "./widget-state";

const CONFIG_URL = "https://www.speedtest.net/speedtest-config.php";
/**
 * Their list, from the mirrors their client tries, in their order: c. first,
 * which answers with the servers around you. The www ones hand out a short
 * list of whatever, so a line in Istanbul can be offered Liechtenstein - they
 * are here for when the first is down, and a list whose nearest server is
 * further than NEAR_KM is not taken until the others have been asked.
 */
const SERVER_LISTS = [
    "https://c.speedtest.net/speedtest-servers-static.php",
    "https://www.speedtest.net/speedtest-servers-static.php",
    "https://www.speedtest.net/speedtest-servers.php",
    "http://c.speedtest.net/speedtest-servers-static.php",
];
/** A list with a server this near is near enough; no other mirror is asked. */
const NEAR_KM = 300;
/** Their servers answer a browser; a bare Node user agent is often refused. */
const AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
/** How many of the nearest servers are pinged, and how often each. */
const CANDIDATES = 5;
const PINGS = 3;
/** Left out of the measurement while TCP finds the line's pace. */
const WARMUP_MS = 1500;
/** Transfers running at once, each way. */
const STREAMS = { down: 6, up: 4 };
/** The pictures a running key gets while the dial moves. */
const REPORT_MS = 120;
/** How far the dial moves towards the speed just measured, so it glides. */
const EASE = 0.35;
/** Servers tried in turn when one answers a ping but serves nothing. */
const TRIES = 3;
/** Failed requests in a row that mean this server is no use. */
const GIVE_UP = 4;
/** A request that has not answered in this long is a dead server. */
const REPLY_MS = 5000;
/** Each upload request carries this much, so a slow line still reports often. */
const POST_BYTES = 2 * 1024 * 1024;
/** The download files to ask for, largest last: a fast line never runs out. */
const IMAGES = [1000, 1500, 2000, 2500, 3000, 3500, 4000];

/** Where the tester is, and where a server is. */
export interface Place {
    lat: number;
    lon: number;
}

export interface SpeedServer extends Place {
    /** Their `upload.php`, which the other files sit beside. */
    url: string;
    name: string;
    country: string;
    sponsor: string;
    km: number;
    ping?: number;
}

/** Every `<tag ... />` in an XML document, as its attributes. */
export function attributesOf(xml: string, tag: string): Record<string, string>[] {
    const found: Record<string, string>[] = [];
    for (const element of xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))) {
        const fields: Record<string, string> = {};
        for (const pair of element[1]!.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
            fields[pair[1]!.toLowerCase()] = pair[2]!;
        found.push(fields);
    }
    return found;
}

/** Where their config says this PC is. */
export function parseClient(xml: string): Place | null {
    const client = attributesOf(xml, "client")[0];
    const lat = Number(client?.lat);
    const lon = Number(client?.lon);
    return client && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Their server list, nearest to `here` first. */
export function parseServers(xml: string, here: Place): SpeedServer[] {
    const servers: SpeedServer[] = [];
    for (const item of attributesOf(xml, "server")) {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!item.url || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        servers.push({
            url: item.url,
            lat,
            lon,
            name: item.name ?? "",
            country: item.country ?? "",
            sponsor: item.sponsor ?? "",
            km: distanceKm(here, { lat, lon }),
        });
    }
    return servers.sort((a, b) => a.km - b.km);
}

/** How far apart two places are, over the earth. */
export function distanceKm(from: Place, to: Place): number {
    const radians = (degrees: number): number => (degrees * Math.PI) / 180;
    const dLat = radians(to.lat - from.lat);
    const dLon = radians(to.lon - from.lon);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Megabits a second from bytes moved over a stretch of time. */
export function megabits(bytes: number, ms: number): number {
    return ms > 0 ? (bytes * 8) / (ms * 1000) : 0;
}

/** A file beside a server's upload.php, never from a cache. */
function beside(server: string, file: string, mark: number): string {
    const target = new URL(file, server);
    target.searchParams.set("x", String(mark));
    return target.href;
}

/** The name a key shows for a server: where it is, and whose it is. */
export function serverName(server: SpeedServer): string {
    return [server.name, server.country].filter(Boolean).join(", ") || server.sponsor;
}

/**
 * What a run needs of the network. The real one is below; tests hand it
 * their own, so a run can be measured without a line to measure.
 */
export interface SpeedTransport {
    /** A short document, and how long the round trip took. `hops` counts redirects. */
    text(url: string, stop: AbortSignal, hops?: number): Promise<{ body: string; ms: number }>;
    /** Fetch and throw away, counting bytes as they arrive, until `stop`. */
    pull(url: string, stop: AbortSignal, count: (bytes: number) => void): Promise<void>;
    /** Post `bytes` of nothing in particular, counting them as they go. */
    push(
        url: string,
        bytes: number,
        stop: AbortSignal,
        count: (bytes: number) => void,
    ): Promise<void>;
}

const KEEP = {
    "http:": new http.Agent({ keepAlive: true, maxSockets: 64 }),
    "https:": new https.Agent({ keepAlive: true, maxSockets: 64 }),
};

/** A request to either kind of URL, with the headers their servers expect. */
function open(
    url: string,
    method: "GET" | "POST",
    stop: AbortSignal,
    headers: http.OutgoingHttpHeaders = {},
): http.ClientRequest {
    const target = new URL(url);
    const secure = target.protocol === "https:";
    return (secure ? https : http).request(target, {
        method,
        agent: KEEP[secure ? "https:" : "http:"],
        signal: stop,
        headers: { "user-agent": AGENT, accept: "*/*", ...headers },
    });
}

/** A body nobody reads: characters a form post may carry. */
const FILLER = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz".repeat(1820)); // 64 KB-ish

export const httpTransport: SpeedTransport = {
    text: (url, stop, hops = 0) =>
        new Promise((resolve, reject) => {
            const at = Date.now();
            const request = open(url, "GET", stop);
            request.setTimeout(REPLY_MS, () => request.destroy(new Error("No answer.")));
            request.on("error", reject);
            request.on("response", (response) => {
                const status = response.statusCode ?? 0;
                const moved = response.headers.location;
                // Their config has moved between http and https before now.
                if (status >= 300 && status < 400 && moved && hops < 3) {
                    response.resume();
                    httpTransport
                        .text(new URL(moved, url).href, stop, hops + 1)
                        .then(resolve, reject);
                    return;
                }
                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(new Error(`Answered ${status}.`));
                    return;
                }
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                    if (body.length < 512 * 1024) body += chunk;
                });
                response.on("end", () => resolve({ body, ms: Date.now() - at }));
                response.on("error", reject);
            });
            request.end();
        }),
    pull: (url, stop, count) =>
        new Promise((resolve, reject) => {
            const request = open(url, "GET", stop);
            request.setTimeout(REPLY_MS, () => request.destroy(new Error("No answer.")));
            const done = (): void => resolve();
            request.on("error", (error) => (stop.aborted ? done() : reject(error)));
            request.on("response", (response) => {
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(new Error(`Answered ${status}.`));
                    return;
                }
                response.on("data", (chunk: Buffer) => count(chunk.length));
                response.on("end", done);
                response.on("error", () => done());
            });
            request.end();
        }),
    push: (url, bytes, stop, count) =>
        new Promise((resolve, reject) => {
            const request = open(url, "POST", stop, {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": String(bytes),
            });
            request.setTimeout(REPLY_MS * 4, () => request.destroy(new Error("No answer.")));
            const done = (): void => resolve();
            request.on("error", (error) => (stop.aborted ? done() : reject(error)));
            request.on("response", (response) => {
                response.resume();
                response.on("end", done);
            });
            // "content1=" and then filler, written a chunk at a time: each
            // chunk counts once the socket has taken it.
            let left = bytes;
            const write = (): void => {
                while (left > 0 && !stop.aborted) {
                    const size = Math.min(left, FILLER.length);
                    const chunk =
                        left === bytes ? Buffer.from("content1=") : FILLER.subarray(0, size);
                    left -= chunk.length;
                    const room = request.write(chunk, () => count(chunk.length));
                    if (!room) {
                        request.once("drain", write);
                        return;
                    }
                }
                request.end();
            };
            write();
        }),
};

/**
 * The speed test the keys share: one run at a time, whichever key started it,
 * writing what it finds into that key's state as it goes.
 */
export class SpeedTester {
    private run: { address: string; stop: AbortController } | null = null;

    constructor(
        private readonly store: WidgetStore,
        private readonly transport: SpeedTransport = httpTransport,
        /** How long each transfer runs; tests measure over a moment instead. */
        private readonly length: number = SPEED_MS,
    ) {}

    /** Whether a run is going, on this key or another. */
    get busy(): boolean {
        return this.run !== null;
    }

    /** A tap on a speed test key: start a run, or stop the one it started. */
    toggle(address: string, failed: (error: unknown) => void): string {
        if (this.run?.address === address) {
            this.cancel();
            return "Speed test stopped.";
        }
        if (this.run) return "A speed test is already running.";
        const stop = new AbortController();
        this.run = { address, stop };
        void this.measure(address, stop.signal)
            .catch((error: unknown) => {
                if (!stop.signal.aborted) {
                    this.write(address, {
                        phase: "failed",
                        since: Date.now(),
                        at: Date.now(),
                        message: reason(error),
                    });
                    failed(error);
                }
            })
            .finally(() => {
                if (this.run?.stop === stop) this.run = null;
            });
        return "Speed test started.";
    }

    /** Stop the run, leaving the key saying so. */
    cancel(): void {
        const going = this.run;
        if (!going) return;
        this.run = null;
        going.stop.abort();
        this.write(going.address, {
            phase: "failed",
            since: Date.now(),
            at: Date.now(),
            message: "Stopped",
        });
    }

    /** A key that is no longer a speed test cannot be left running. */
    sync(config: DeckConfig): void {
        const address = this.run?.address;
        if (!address) return;
        const here = config.pages.some((page) =>
            Object.entries(page.keys).some(
                ([cell, key]) =>
                    keyAddress(page.id, Number(cell)) === address &&
                    key.action.kind === "widget" &&
                    key.action.widget.type === "speedtest",
            ),
        );
        if (!here) this.cancel();
    }

    stop(): void {
        this.run?.stop.abort();
        this.run = null;
    }

    private write(address: string, run: SpeedRun): void {
        this.store.set(address, { ...this.store.get(address), speed: run }, false);
    }

    /** Their config, their list, the nearest quick server, then both ways. */
    private async measure(address: string, stop: AbortSignal): Promise<void> {
        this.write(address, { phase: "ping", since: Date.now() });
        const config = await this.transport.text(CONFIG_URL, stop);
        const here = parseClient(config.body);
        if (!here) throw new Error("Speedtest.net did not say where you are.");
        let servers: SpeedServer[] = [];
        for (const list of SERVER_LISTS) {
            let listed: SpeedServer[] = [];
            try {
                listed = parseServers((await this.transport.text(list, stop)).body, here);
            } catch {
                continue;
            }
            // Whichever mirror knows of a server nearest to you.
            if (listed.length && (!servers.length || listed[0]!.km < servers[0]!.km))
                servers = listed;
            if (servers.length && servers[0]!.km <= NEAR_KM) break;
        }
        if (!servers.length) throw new Error("Speedtest.net listed no servers.");
        const quickest = await this.nearest(servers, stop);
        if (stop.aborted) return;
        // The quickest server that will actually serve the files: some in
        // their list answer a ping and nothing else.
        let server = quickest[0]!;
        let found: SpeedRun = { phase: "down", since: 0 };
        let down = 0;
        for (const candidate of quickest.slice(0, TRIES)) {
            server = candidate;
            found = {
                phase: "down",
                since: Date.now(),
                length: this.length,
                ping: candidate.ping,
                server: serverName(candidate),
            };
            this.write(address, found);
            down = await this.transfer(address, found, stop, (mark, count, over) => {
                const size = IMAGES[mark % IMAGES.length]!;
                return this.transport.pull(
                    beside(candidate.url, `random${size}x${size}.jpg`, mark),
                    over,
                    count,
                );
            });
            if (down > 0 || stop.aborted) break;
        }
        if (stop.aborted) return;
        if (down <= 0) throw new Error("No Speedtest.net server sent anything.");
        const rising: SpeedRun = { ...found, phase: "up", since: Date.now(), now: undefined, down };
        this.write(address, rising);
        const up = await this.transfer(address, rising, stop, (mark, count, over) =>
            this.transport.push(beside(server.url, "", mark), POST_BYTES, over, count),
        );
        if (stop.aborted) return;
        this.write(address, {
            ...rising,
            phase: "done",
            now: undefined,
            up,
            at: Date.now(),
        });
    }

    /** The nearest few servers that answered, quickest first (best of PINGS tries). */
    private async nearest(servers: SpeedServer[], stop: AbortSignal): Promise<SpeedServer[]> {
        const near = servers.slice(0, CANDIDATES);
        await Promise.all(
            near.map(async (server) => {
                for (let i = 0; i < PINGS; i++) {
                    if (stop.aborted) return;
                    try {
                        const { body, ms } = await this.transport.text(
                            beside(server.url, "latency.txt", Date.now() + i),
                            stop,
                        );
                        if (!body.startsWith("test=test")) return;
                        server.ping = Math.min(server.ping ?? Infinity, ms);
                    } catch {
                        return;
                    }
                }
            }),
        );
        const answered = near.filter((server) => server.ping !== undefined);
        if (!answered.length) throw new Error("No Speedtest.net server answered.");
        return answered.sort((a, b) => a.ping! - b.ping!);
    }

    /**
     * Fill the line one way for `length` with STREAMS transfers at a time,
     * telling the key how it is going. The speed is what moved after the
     * warm-up, over the time it took.
     */
    private async transfer(
        address: string,
        run: SpeedRun,
        stop: AbortSignal,
        once: (mark: number, count: (bytes: number) => void, over: AbortSignal) => Promise<void>,
    ): Promise<number> {
        const streams = run.phase === "down" ? STREAMS.down : STREAMS.up;
        const began = Date.now();
        let measured = 0;
        let measuring = 0;
        let told = 0;
        let since = 0;
        let shown = 0;
        // The key shows how fast it is going now, not the average since the
        // start: the last stretch's speed, eased towards so the dial glides
        // instead of jumping. The figure the run keeps is the average.
        const count = (bytes: number): void => {
            const now = Date.now();
            if (now < began + WARMUP_MS) return;
            if (!measuring) {
                measuring = now;
                since = now;
            }
            measured += bytes;
            if (now - told < REPORT_MS) return;
            const lately = measured - shown;
            const rate = megabits(lately, now - since);
            shown = measured;
            since = now;
            told = now;
            run.now = run.now === undefined ? rate : run.now + (rate - run.now) * EASE;
            this.write(address, { ...run });
        };
        // The phase has its own stop: the transfers going when the time is up
        // are cut off there, and what had arrived by then is what counts. The
        // run being cancelled ends it the same way.
        const over = new AbortController();
        const timer = setTimeout(() => over.abort(), this.length);
        const onStop = (): void => over.abort();
        stop.addEventListener("abort", onStop);
        let mark = 0;
        let failures = 0;
        // A server that drops one connection of six has not failed the run:
        // the stream takes the next file. Only a server that gives nothing at
        // all ends the phase, and the run then tries the next server.
        const stream = async (): Promise<void> => {
            while (!over.signal.aborted && failures < GIVE_UP) {
                try {
                    await once(mark++, count, over.signal);
                    failures = 0;
                } catch {
                    failures++;
                }
            }
        };
        try {
            await Promise.all(Array.from({ length: streams }, stream));
        } finally {
            clearTimeout(timer);
            over.abort();
            stop.removeEventListener("abort", onStop);
        }
        return measuring && measured ? megabits(measured, Date.now() - measuring) : 0;
    }
}

/** What to say went wrong, without a stack. */
function reason(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/.test(text)
        ? "No connection"
        : text.slice(0, 60);
}
