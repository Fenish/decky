/*---------------------------------------------------------------
 * The speed test: reading Speedtest.net's config and server list, picking
 * the nearest quick server, and measuring the line both ways - against a
 * made-up line, so the test measures the code and not the room's Wi-Fi.
 *--------------------------------------------------------------*/

import { describe, expect, it, vi } from "vitest";
import type { WidgetState, WidgetStates } from "../src/shared/widgets";
import type { WidgetStore } from "../src/main/widgets/widget-state";
import {
    attributesOf,
    distanceKm,
    megabits,
    parseClient,
    parseServers,
    serverName,
    SpeedTester,
} from "../src/main/widgets/speedtest";
import type { SpeedTransport } from "../src/main/widgets/speedtest";

const CONFIG = `<?xml version="1.0"?><settings>
  <client ip="88.230.1.2" lat="41.0138" lon="28.9497" isp="Turk Telekom" ispdlavg="0"/>
</settings>`;

const SERVERS = `<?xml version="1.0"?><settings><servers>
  <server url="http://ist1.example.com/speedtest/upload.php" lat="41.0053" lon="28.9770" name="Istanbul" country="Turkey" sponsor="Near" id="1"/>
  <server url="http://fra1.example.com/speedtest/upload.php" lat="50.1109" lon="8.6821" name="Frankfurt" country="Germany" sponsor="Far" id="2"/>
  <server url="http://ank1.example.com/speedtest/upload.php" lat="39.9334" lon="32.8597" name="Ankara" country="Turkey" sponsor="Middle" id="3"/>
</servers></settings>`;

/** A store that only remembers, as the tester uses it. */
function store(): { store: WidgetStore; states: WidgetStates; runs: WidgetState["speed"][] } {
    const states: WidgetStates = {};
    const runs: WidgetState["speed"][] = [];
    return {
        states,
        runs,
        store: {
            get: (address: string) => states[address],
            set: (address: string, state: WidgetState | undefined) => {
                if (state === undefined) delete states[address];
                else states[address] = state;
                runs.push(state?.speed);
            },
            save: () => {},
        } as unknown as WidgetStore,
    };
}

/**
 * A line that answers: `pings` by server host, and `bytes` handed over every
 * `every` ms in each direction.
 */
function line(
    options: {
        pings?: Record<string, number>;
        bytes?: number;
        every?: number;
        /** Hosts whose files never arrive: they answer a ping and nothing else. */
        mute?: string[];
        /** One request in this many is dropped, as a busy server drops them. */
        dropEvery?: number;
        /** What each mirror lists, when they do not all list the same. */
        lists?: Record<string, string>;
    } = {},
) {
    const {
        pings = { ist1: 8, ank1: 20, fra1: 60 },
        bytes = 200_000,
        every = 5,
        mute = [],
        dropEvery = 0,
        lists,
    } = options;
    const asked: string[] = [];
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const host = (url: string) => new URL(url).hostname.split(".")[0]!;
    let calls = 0;
    const moving = (url: string) => {
        calls++;
        if (mute.includes(host(url))) throw new Error("Answered 404.");
        if (dropEvery && calls % dropEvery === 0) throw new Error("read ECONNRESET");
    };
    const transport: SpeedTransport = {
        text: async (url) => {
            asked.push(url);
            if (url.includes("speedtest-config")) return { body: CONFIG, ms: 30 };
            if (url.includes("speedtest-servers")) {
                const listed = lists?.[new URL(url).hostname];
                if (lists && listed === undefined) throw new Error("Answered 500.");
                return { body: listed ?? SERVERS, ms: 40 };
            }
            const ms = pings[host(url)];
            if (ms === undefined) throw new Error("No route to host.");
            await wait(1);
            return { body: "test=test\n", ms };
        },
        pull: async (url, stop, count) => {
            asked.push(url);
            moving(url);
            await wait(every);
            if (!stop.aborted) count(bytes);
        },
        push: async (url, size, stop, count) => {
            asked.push(url);
            moving(url);
            await wait(every);
            if (!stop.aborted) count(Math.min(size, bytes));
        },
    };
    return { transport, asked };
}

describe("reading what Speedtest.net publishes", () => {
    it("takes the attributes it needs out of their XML", () => {
        expect(attributesOf(CONFIG, "client")).toHaveLength(1);
        expect(parseClient(CONFIG)).toEqual({ lat: 41.0138, lon: 28.9497 });
        expect(parseClient("<settings><client/></settings>")).toBeNull();
    });

    it("puts the servers nearest first, wherever you are", () => {
        const here = parseClient(CONFIG)!;
        const servers = parseServers(SERVERS, here);
        expect(servers.map((server) => server.name)).toEqual(["Istanbul", "Ankara", "Frankfurt"]);
        expect(Math.round(servers[0]!.km)).toBeLessThan(10);
        expect(serverName(servers[0]!)).toBe("Istanbul, Turkey");
    });

    it("measures the earth and the line", () => {
        // Istanbul to Frankfurt is about 1,870 km.
        expect(
            distanceKm({ lat: 41.0138, lon: 28.9497 }, { lat: 50.1109, lon: 8.6821 }),
        ).toBeGreaterThan(1700);
        expect(
            distanceKm({ lat: 41.0138, lon: 28.9497 }, { lat: 50.1109, lon: 8.6821 }),
        ).toBeLessThan(2000);
        // 1 MB in a second is 8 megabits a second.
        expect(megabits(1_000_000, 1000)).toBeCloseTo(8, 5);
    });
});

describe("running a speed test", () => {
    it("pings the nearest servers, uses the quickest, and measures both ways", async () => {
        const kept = store();
        const { transport, asked } = line();
        // No warm-up to skip in a test this short: a long enough run to measure.
        const tester = new SpeedTester(kept.store, transport, 2600);
        expect(tester.toggle("home:4", () => {})).toBe("Speed test started.");
        await vi.waitFor(() => expect(kept.states["home:4"]?.speed?.phase).toBe("done"), {
            timeout: 15_000,
        });
        const run = kept.states["home:4"]!.speed!;
        // Istanbul answered quickest, and it is the one that was measured.
        expect(run.server).toBe("Istanbul, Turkey");
        expect(run.ping).toBe(8);
        expect(asked.some((url) => url.includes("ist1") && url.includes("random"))).toBe(true);
        expect(asked.some((url) => url.includes("fra1") && url.includes("random"))).toBe(false);
        expect(run.down).toBeGreaterThan(0);
        expect(run.up).toBeGreaterThan(0);
        // It went through both phases, saying how it was going as it went.
        const phases = kept.runs.map((item) => item?.phase);
        expect(phases[0]).toBe("ping");
        expect(phases).toContain("down");
        expect(phases).toContain("up");
        expect(kept.runs.some((item) => item?.phase === "down" && (item.now ?? 0) > 0)).toBe(true);
        // The arc the deck sweeps knows how long each transfer runs.
        expect(kept.runs.find((item) => item?.phase === "down")?.length).toBe(2600);
    }, 20_000);

    it("stops when its key is tapped again, and refuses a second at once", async () => {
        const kept = store();
        const tester = new SpeedTester(kept.store, line().transport, 5000);
        tester.toggle("home:4", () => {});
        expect(tester.toggle("home:5", () => {})).toBe("A speed test is already running.");
        expect(tester.toggle("home:4", () => {})).toBe("Speed test stopped.");
        expect(kept.states["home:4"]?.speed).toMatchObject({ phase: "failed", message: "Stopped" });
        expect(tester.busy).toBe(false);
    });

    it("takes the mirror that knows of a server near you", async () => {
        const kept = store();
        // The first mirror they ask offers Frankfurt to a line in Istanbul,
        // which is what sent a run to Liechtenstein; the next knows better.
        const far = SERVERS.replace(/<server url="http:\/\/(ist1|ank1)[^>]*>/g, "");
        const { transport } = line({
            lists: { "c.speedtest.net": far, "www.speedtest.net": SERVERS },
        });
        const tester = new SpeedTester(kept.store, transport, 1600);
        tester.toggle("home:4", () => {});
        await vi.waitFor(() => expect(kept.states["home:4"]?.speed?.phase).toBe("done"), {
            timeout: 15_000,
        });
        expect(kept.states["home:4"]?.speed?.server).toBe("Istanbul, Turkey");
    }, 20_000);

    it("moves to the next server when the nearest serves nothing", async () => {
        const kept = store();
        const { transport, asked } = line({ mute: ["ist1"] });
        const tester = new SpeedTester(kept.store, transport, 1600);
        tester.toggle("home:4", () => {});
        await vi.waitFor(() => expect(kept.states["home:4"]?.speed?.phase).toBe("done"), {
            timeout: 20_000,
        });
        const run = kept.states["home:4"]!.speed!;
        expect(asked.some((url) => url.includes("ist1") && url.includes("random"))).toBe(true);
        expect(run.server).toBe("Ankara, Turkey");
        expect(run.down).toBeGreaterThan(0);
    }, 25_000);

    it("keeps going when a server drops the odd connection", async () => {
        const kept = store();
        const { transport } = line({ dropEvery: 3 });
        const tester = new SpeedTester(kept.store, transport, 1800);
        tester.toggle("home:4", (error) => expect(error).toBeUndefined());
        await vi.waitFor(() => expect(kept.states["home:4"]?.speed?.phase).toBe("done"), {
            timeout: 20_000,
        });
        expect(kept.states["home:4"]?.speed?.down).toBeGreaterThan(0);
        expect(kept.states["home:4"]?.speed?.up).toBeGreaterThan(0);
    }, 25_000);

    it("says on the key when the line is not there", async () => {
        const kept = store();
        const dead: SpeedTransport = {
            text: async () => {
                throw new Error("getaddrinfo ENOTFOUND www.speedtest.net");
            },
            pull: async () => {},
            push: async () => {},
        };
        const failures: unknown[] = [];
        new SpeedTester(kept.store, dead, 100).toggle("home:4", (error) => failures.push(error));
        await vi.waitFor(() => expect(kept.states["home:4"]?.speed?.phase).toBe("failed"));
        expect(kept.states["home:4"]?.speed?.message).toBe("No connection");
        expect(failures).toHaveLength(1);
    });
});
