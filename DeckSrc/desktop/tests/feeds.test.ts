import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "../src/shared/config";
import type { DeckConfig } from "../src/shared/config";
import { deckTurned, validWidget } from "../src/shared/widgets/registry";
import { trackPosition } from "../src/shared/widgets/media";
import { formatPrice } from "../src/shared/widgets/crypto";
import { diceLabels, listOptions } from "../src/shared/widgets/dice";
import type { Widget } from "../src/shared/widgets";
import { CpuMeter, HISTORY, keep, WidgetFeeds } from "../src/main/widgets/feeds";
import { ARROW_MS, pairOf, PriceStream, readTicker } from "../src/main/widgets/crypto-feed";
import type { Socket } from "../src/main/widgets/crypto-feed";
import { WidgetStore } from "../src/main/widgets/widget-state";
import type { HostEvent, WindowsHost } from "../src/main/system/windows-host";

describe("how readings read", () => {
    it("writes prices whole, short or precise as they need", () => {
        expect(formatPrice(76_904.2)).toBe("$76,904");
        expect(formatPrice(3_737_990)).toBe("$3.74M");
        expect(formatPrice(12.5)).toBe("$12.50");
        expect(formatPrice(0.123456)).toBe("$0.1235");
    });
    it("moves a playing track on by the clock, and holds a paused one", () => {
        const track = {
            title: "",
            artist: "",
            playing: true,
            position: 10_000,
            duration: 60_000,
            at: 1000,
        };
        expect(trackPosition(track, 6000)).toBe(15_000);
        expect(trackPosition(track, 999_999)).toBe(60_000);
        expect(trackPosition({ ...track, playing: false }, 6000)).toBe(10_000);
    });
});

describe("dice", () => {
    it("takes up to 8 short choices, and rolls over its faces again and again", () => {
        expect(listOptions(" Pizza ,, Burger,\nSushi , A very long option indeed")).toEqual([
            "Pizza",
            "Burger",
            "Sushi",
            "A very long op",
        ]);
        expect(listOptions("1,2,3,4,5,6,7,8,9")).toHaveLength(8);
        const die = diceLabels({ type: "dice", mode: "die", options: "" });
        expect(die).toHaveLength(120);
        expect(die.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
        expect(diceLabels({ type: "dice", mode: "list", options: "a, b, c, d" })).toHaveLength(120);
        expect(validWidget({ type: "dice", mode: "list", options: "only one" })).toBe(false);
        expect(validWidget({ type: "dice", mode: "coin", options: "" })).toBe(true);
    });
});

describe("keys the deck turns itself", () => {
    it("are the volume, a die, dice drums, and an adjustable countdown at rest", () => {
        const countdown = {
            type: "timer",
            mode: "countdown",
            seconds: 60,
            adjustable: true,
        } as const;
        expect(deckTurned({ type: "volume", style: "arc" }, undefined, 0)).toBe("dial");
        expect(deckTurned({ type: "dice", mode: "die", options: "" }, undefined, 0)).toBe("die");
        expect(deckTurned({ type: "dice", mode: "coin", options: "" }, undefined, 0)).toBe("drum");
        expect(deckTurned(countdown, undefined, 0)).toBe("drum");
        expect(deckTurned(countdown, { running: true, since: 0, elapsed: 0 }, 5000)).toBeNull();
        expect(deckTurned({ ...countdown, adjustable: false }, undefined, 0)).toBeNull();
        expect(deckTurned({ type: "media", style: "cover" }, undefined, 0)).toBeNull();
    });
});

describe("readings", () => {
    it("reads a price and the day's change, streamed or asked for", () => {
        expect(pairOf("the-open-network")).toBe("TONUSDT");
        expect(pairOf("nothing")).toBeUndefined();
        // The stream's miniTicker: last and a day ago.
        expect(
            readTicker({
                stream: "btcusdt@miniTicker",
                data: { s: "BTCUSDT", c: "77045.65", o: "78378.46" },
            }),
        ).toEqual({ symbol: "BTCUSDT", price: 77045.65, change: expect.closeTo(-1.7, 2) });
        // The REST ticker says its own change.
        expect(
            readTicker({ symbol: "ETHUSDT", lastPrice: "2454.5", priceChangePercent: "-0.88" }),
        ).toEqual({ symbol: "ETHUSDT", price: 2454.5, change: -0.88 });
        expect(readTicker({ code: -1121, msg: "Invalid symbol." })).toBeNull();
        expect(readTicker(null)).toBeNull();
    });
    it("works out the CPU in use between two looks", () => {
        let reading = [{ times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } }];
        const meter = new CpuMeter(() => reading as never);
        expect(meter.sample("a")).toBeNull();
        reading = [{ times: { user: 400, nice: 0, sys: 100, idle: 1300, irq: 0 } }];
        // 400 of the last 800 were work.
        expect(meter.sample("a")).toBe(50);
    });
    it("keeps a minute of samples", () => {
        let list: number[] = [];
        for (let i = 0; i < 70; i++) list = keep(list, i);
        expect(list).toHaveLength(HISTORY);
        expect(list[0]).toBe(10);
    });
});

function configWith(widgets: Record<number, Widget>): DeckConfig {
    const config = createConfig();
    for (const [cell, widget] of Object.entries(widgets))
        config.pages[0]!.keys[cell] = {
            label: "",
            icon: "Clock",
            color: "#eee8da",
            action: { kind: "widget", widget },
        };
    return config;
}

/** A WebSocket as the price stream uses one, driven by the test. */
function fakeSocket() {
    const opened: { url: string; socket: Socket }[] = [];
    const open = (url: string): Socket => {
        const socket: Socket = {
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            close: vi.fn(),
        };
        opened.push({ url, socket });
        return socket;
    };
    const say = (symbol: string, last: number, day: number) =>
        opened.at(-1)!.socket.onmessage?.({
            data: JSON.stringify({ data: { s: symbol, c: String(last), o: String(day) } }),
        });
    return { open, opened, say };
}

describe("feeds", () => {
    it("reads the PC, hears Windows and streams prices for the widgets on the profile", async () => {
        const asked: { op: string; fields: Record<string, unknown> }[] = [];
        let tell: ((event: HostEvent) => void) | undefined;
        const host = {
            request: vi.fn(async (op: string, fields: Record<string, unknown> = {}) => {
                asked.push({ op, fields });
                if (op === "audio") return { level: 40, muted: false, mic: { muted: true } };
                if (op === "media")
                    return {
                        title: "Song",
                        artist: "Band",
                        playing: true,
                        position: 1000,
                        duration: 9000,
                        updated: 5,
                    };
                return {};
            }),
            on: (listener: (event: HostEvent) => void) => (tell = listener),
            run: 1,
            stop: vi.fn(),
        } as unknown as WindowsHost;
        const fetched: string[] = [];
        const socket = fakeSocket();
        const store = new WidgetStore(join(tmpdir(), "decky-feeds-test.json"), () => {});
        const feeds = new WidgetFeeds(
            store,
            host,
            async (url) => {
                fetched.push(url);
                // The last day, hourly: 24 closed hours and the one under way.
                return Array.from({ length: 25 }, (_, i) => [0, "0", "0", "0", String(2000 + i)]);
            },
            socket.open,
        );
        feeds.sync(
            configWith({
                0: { type: "volume", style: "arc" },
                1: { type: "mic" },
                2: { type: "media", style: "cover" },
                3: { type: "system", show: "both", style: "graph", interval: 1 },
                5: { type: "crypto", coin: "ethereum", style: "chart" },
            }),
        );
        await vi.waitFor(() => {
            expect(store.get("home:0")).toEqual({ level: 40, muted: false });
            expect(store.get("home:1")).toEqual({ muted: true });
            expect(store.get("home:2")?.track).toMatchObject({
                title: "Song",
                playing: true,
                at: 5,
            });
            expect(store.get("home:3")?.ram).toHaveLength(1);
        });
        // Once read, Windows is asked to tell of every change itself.
        await vi.waitFor(() => expect(asked.map((a) => a.op)).toContain("watch-audio"));
        tell!({ event: "audio", flow: 0, level: 64, muted: false });
        tell!({ event: "audio", flow: 1, level: 50, muted: false });
        expect(store.get("home:0")).toEqual({ level: 64, muted: false });
        expect(store.get("home:1")).toEqual({ muted: false });
        // One stream for the coins shown; each price as it comes, on the day drawn.
        expect(socket.opened.map((item) => item.url)).toEqual([
            "wss://data-stream.binance.vision/stream?streams=ethusdt@miniTicker",
        ]);
        await vi.waitFor(() =>
            expect(fetched[0]).toContain("klines?symbol=ETHUSDT&interval=1h&limit=25"),
        );
        socket.say("ETHUSDT", 2500, 2400);
        expect(store.get("home:5")).toMatchObject({ price: 2500, previous: 2500 });
        expect(store.get("home:5")?.change).toBe(4.17);
        expect(store.get("home:5")?.history).toEqual([
            ...Array.from({ length: 24 }, (_, i) => 2000 + i),
            2500,
        ]);
        // Volume from a turning dial: values that come while one is set wait,
        // and only the newest goes next - and Windows' echoes of them meanwhile
        // do not pull the dial back.
        await Promise.all([feeds.setVolume(10), feeds.setVolume(20), feeds.setVolume(30)]);
        expect(asked.filter((a) => a.op === "volume").map((a) => a.fields.level)).toEqual([10, 30]);
        tell!({ event: "audio", flow: 0, level: 20, muted: false });
        expect(store.get("home:0")).toEqual({ level: 30, muted: false });
        // A tap mutes the mic on the key at once; Windows is asked after.
        let answer: () => void = () => {};
        (host.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
            (op: string, fields: Record<string, unknown>) => {
                asked.push({ op, fields });
                return new Promise((resolve) => (answer = () => resolve({})));
            },
        );
        const muting = feeds.toggleMute("home:1", true);
        expect(store.get("home:1")).toEqual({ muted: true });
        expect(asked.at(-1)).toEqual({ op: "micmute", fields: { muted: true } });
        answer();
        await muting;
        // Play and pause show at once too, the progress held where it is.
        await feeds.control("media-toggle");
        expect(store.get("home:2")?.track).toMatchObject({ playing: false });
        expect(asked.at(-1)?.op).toBe("media-toggle");
        feeds.stop();
        expect(host.stop).toHaveBeenCalled();
        expect(socket.opened[0]!.socket.close).toHaveBeenCalled();
    });
    it("points the ticker's arrow at the move over the last minute, not the last tick", () => {
        let now = 1_000_000;
        const socket = fakeSocket();
        const store = new WidgetStore(join(tmpdir(), "decky-prices-test.json"), () => {});
        const prices = new PriceStream(
            store,
            async () => [],
            socket.open,
            () => now,
        );
        prices.sync([{ address: "home:0", coin: "bitcoin" }]);
        socket.say("BTCUSDT", 100, 100);
        for (let second = 1; second <= 70; second++) {
            now += 1000;
            socket.say("BTCUSDT", 100 + second, 100);
        }
        // A minute ago it was 110; now 170.
        expect(store.get("home:0")).toMatchObject({ price: 170, previous: 110 });
        expect(ARROW_MS).toBe(60_000);
        prices.stop();
    });
    it("saves only what a person did, not what was read", async () => {
        const path = join(await mkdtemp(join(tmpdir(), "decky-")), "widgets.json");
        const store = new WidgetStore(path, () => {});
        store.set("home:0", { value: 4 });
        store.set("home:1", { level: 40, muted: false });
        store.set("home:2", { running: true, since: 1, elapsed: 0, cpu: [1, 2] });
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
            "home:0": { value: 4 },
            "home:2": { running: true, since: 1, elapsed: 0 },
        });
    });
});
