import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/shared/config";
import type { DeckConfig } from "../src/shared/config";
import { formatDuration } from "../src/shared/widgets";
import { defaultWidget } from "../src/shared/widgets/registry";
import { wheelValues } from "../src/shared/widgets/timer";
import { diceLabels } from "../src/shared/widgets/dice";
import { encodeLivePatch } from "../src/shared/live-patch";
import { DICE_FEEL, DIE_FEEL, encodeWheelSpec, WHEEL_FEEL } from "../src/shared/wheel-spec";
import { packPose } from "../src/shared/die";
import { encodeSlide, SLIDE_FEEL } from "../src/shared/slide-spec";
import { encodeSweep } from "../src/shared/sweep-spec";
import type { SweepMotion } from "../src/shared/sweep-spec";

// A 32 × 32 key: RGB565, 2 bytes a pixel - room for a wheel's rows and a die.
const KEY = 32;
const BYTES = KEY * KEY * 2;

interface Copy {
    id: number;
    signature: number;
    /** The page's own pictures, exactly as sent. */
    keys: Uint8Array[];
    /** Widget keys' live pictures (LIVE), shown over their own. */
    live: Map<number, Uint8Array>;
    complete: boolean;
    /** Keys sliding text along, and the CRC of the text. */
    slides: Map<number, number>;
    /** Keys with a ring's arc moving, and the CRC of the arc. */
    sweeps: Map<number, number>;
}

const fixture = vi.hoisted(() => ({
    // Decky's own folder (app.getPath), fresh each run: what one run saves -
    // widget state, a running countdown - must not be there for the next.
    folder: `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/decky-fixture-${process.pid}-${Date.now()}`,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    events: new Map<string, (event: { preventDefault: () => void }) => void>(),
    contents: {
        mainFrame: {},
        send: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
        session: { setPermissionRequestHandler: () => {} },
    },
    config: null as unknown,
    link: null as null | { onEvent: ((event: unknown) => void) | null },
    // The deck, as the firmware keeps it: copies of pages by index and
    // signature, the one being built, the one on screen, and every commit.
    deck: {
        copies: [] as Copy[],
        pending: null as Copy | null,
        shown: null as Copy | null,
        commits: [] as { signature: number; keys: Uint8Array[] }[],
        commands: [] as string[],
        // A command the deck refuses, for a load that fails part way.
        refuse: null as string | null,
        looks: new Set<number>(),
        // The keys it turns itself: armed by WHEEL or WHEELAT.
        armed: new Set<number>(),
    },
    // What was asked of Windows: the volume, the microphone.
    host: [] as { op: string; fields: Record<string, unknown> }[],
}));

vi.mock("../src/main/system/windows-host", () => ({
    WindowsHost: class {
        request = async (op: string, fields: Record<string, unknown> = {}) => {
            fixture.host.push({ op, fields });
            return op === "audio"
                ? { speaker: { level: 40, muted: false }, microphone: { level: 70, muted: false } }
                : {};
        };
        hold = () => {};
        stop = () => {};
    },
}));

vi.mock("electron", () => ({
    app: {
        setName: () => {},
        setAppUserModelId: () => {},
        requestSingleInstanceLock: () => true,
        on: (name: string, fn: (event: { preventDefault: () => void }) => void) =>
            fixture.events.set(name, fn),
        whenReady: async () => {},
        getPath: () => fixture.folder,
        quit: () => {},
    },
    BrowserWindow: class {
        webContents = fixture.contents;
        on = () => {};
        once = () => {};
        loadFile = async () => {};
        loadURL = async () => {};
        isDestroyed = () => false;
    },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => [] },
    Tray: class {
        setToolTip = () => {};
        setContextMenu = () => {};
        on = () => {};
        destroy = () => {};
    },
    nativeImage: { createFromPath: () => ({}) },
    dialog: { showErrorBox: () => {} },
    shell: { openExternal: async () => {} },
    ipcMain: {
        handle: (name: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
            fixture.handlers.set(name, fn),
    },
}));
vi.mock("../src/main/config/store", () => ({
    loadConfig: async () => fixture.config,
    saveConfig: async () => {},
}));
vi.mock("../src/main/programs/catalog", () => ({
    getProgramIcon: () => {},
    listPrograms: () => [],
}));
vi.mock("../src/main/actions/runner", () => ({
    ActionRunner: class {
        run = async () => ({ ok: true, message: "Done" });
        cancel = () => {};
        prepare = () => {};
        stop = () => {};
    },
}));
vi.mock("../src/main/device/serial", async () => {
    const actual = await vi.importActual<typeof import("../src/main/device/serial")>(
        "../src/main/device/serial",
    );
    const { decodeLivePatch } = await vi.importActual<typeof import("../src/shared/live-patch")>(
        "../src/shared/live-patch",
    );
    const { deck } = fixture;
    const find = (id: number, signature: number): Copy | undefined =>
        deck.copies.find((copy) => copy.id === id && copy.signature === signature && copy.complete);
    const ok = (message: string) => ({ ok: true, message });
    return {
        ...actual,
        DeckLink: class {
            openPath = "TEST";
            onEvent: ((event: unknown) => void) | null = null;
            static listPorts = async () => [{ path: "TEST" }];
            constructor() {
                // The first is the deck's link; a second only probes USB.
                fixture.link ??= this;
            }
            identify = async () => ({
                portPath: "TEST",
                protocol: 7,
                serial: "fixture",
                cells: 15,
                columns: 5,
                rows: 3,
                keyWidth: KEY,
                keyHeight: KEY,
                pages: 64,
                cacheSlots: 8,
                live: true,
                drag: true,
                wheel: true,
                dial: true,
                warm: true,
                block: 4096,
                slide: true,
                sweep: true,
            });
            stillAttached = async () => true;
            useBlock = async (bytes: number) => {
                deck.commands.push(`BLOCK ${bytes}`);
                return true;
            };
            close = async () => {};
            command = async (line: string) => {
                deck.commands.push(line);
                if (deck.refuse && line.startsWith(deck.refuse))
                    return { ok: false, message: "ERR refused" };
                const [name, ...args] = line.split(" ");
                const [id, signature] = args.map(Number) as [number, number];
                switch (name) {
                    case "CACHE": {
                        if (find(id, signature)) return ok(`OK page ${id} cached=1`);
                        // Built from the page's copy on screen, or its newest.
                        const base =
                            deck.shown?.id === id
                                ? deck.shown
                                : deck.copies.findLast((copy) => copy.id === id && copy.complete);
                        // A new version starts with its base's own pictures,
                        // and its live ones with the text sliding over them;
                        // `live=` names those keys.
                        const live = new Map(
                            [...(base?.live ?? [])].map(([cell, picture]) => [
                                cell,
                                picture.slice(),
                            ]),
                        );
                        deck.pending = {
                            id,
                            signature,
                            complete: false,
                            slides: new Map(
                                [...(base?.slides ?? [])].filter(([cell]) => live.has(cell)),
                            ),
                            sweeps: new Map(
                                [...(base?.sweeps ?? [])].filter(([cell]) => live.has(cell)),
                            ),
                            live,
                            keys: base
                                ? base.keys.map((key) => key.slice())
                                : Array.from({ length: 15 }, () => new Uint8Array(BYTES)),
                        };
                        const mask = [...live.keys()].reduce((bits, cell) => bits | (1 << cell), 0);
                        return ok(
                            `OK page ${id} cached=0 copied=${base ? 1 : 0} base=${base?.signature ?? 0} live=${mask}`,
                        );
                    }
                    case "BLANK":
                        deck.pending!.keys[id] = new Uint8Array(BYTES);
                        deck.pending!.live.delete(id);
                        deck.pending!.slides.delete(id);
                        deck.pending!.sweeps.delete(id);
                        return ok("OK blank");
                    case "COMMIT": {
                        const copy = deck.pending!;
                        copy.complete = true;
                        deck.pending = null;
                        deck.copies = deck.copies.filter(
                            (other) => other.id !== copy.id || other === deck.shown,
                        );
                        deck.copies.push(copy);
                        // What the card saves: the page as committed.
                        deck.commits.push({
                            signature: copy.signature,
                            keys: copy.keys.map((key) => key.slice()),
                        });
                        return ok(`OK committed ${copy.id} stored=0`);
                    }
                    case "STATE": {
                        const copy = find(id, signature);
                        if (!copy) return { ok: false, message: "ERR invalid page state" };
                        deck.shown = copy;
                        return ok("OK state");
                    }
                    // Arming with a look the deck keeps, by CRC.
                    case "WHEELAT":
                        if (!deck.looks.has(Number(args[4])))
                            return { ok: false, message: "ERR wheel unknown" };
                        deck.armed.add(Number(args[2]));
                        return ok("OK wheel");
                    // Only a key it turns can roll.
                    case "WHEELROLL":
                        return deck.armed.has(Number(args[2]))
                            ? ok("OK roll")
                            : { ok: false, message: "ERR invalid wheel" };
                    // A new session: no text slides, no live pictures.
                    case "HELLO":
                        deck.copies.forEach((copy) => {
                            copy.slides.clear();
                            copy.sweeps.clear();
                            copy.live.clear();
                        });
                        return ok("OK hello");
                    // No bytes: the key's live picture goes, and its text.
                    case "LIVE": {
                        const copy = find(id, signature);
                        if (!copy) return { ok: false, message: "ERR invalid live patch" };
                        copy.live.delete(Number(args[2]));
                        copy.slides.delete(Number(args[2]));
                        copy.sweeps.delete(Number(args[2]));
                        return ok("OK live");
                    }
                    // No text: what the key had goes.
                    case "SLIDE": {
                        const copy = find(id, signature);
                        if (!copy) return { ok: false, message: "ERR invalid slide" };
                        copy.slides.delete(Number(args[2]));
                        return ok("OK slide");
                    }
                    case "SWEEP": {
                        const copy = find(id, signature);
                        if (!copy) return { ok: false, message: "ERR invalid sweep" };
                        copy.sweeps.delete(Number(args[2]));
                        return ok("OK sweep");
                    }
                    default:
                        return ok("OK");
                }
            };
            push = async (cell: number, payload: Uint8Array, _progress: unknown, header = "") => {
                if (header.startsWith("WHEEL ")) {
                    deck.commands.push(header);
                    const crc = Number(header.split(" ")[6]);
                    if (actual.crc32(payload) !== crc)
                        return { ok: false, message: "ERR checksum mismatch" };
                    deck.looks.add(crc);
                    if (header.split(" ")[3] !== "-1") deck.armed.add(Number(header.split(" ")[3]));
                    return ok("OK wheel");
                }
                if (header.startsWith("LIVE ")) {
                    deck.commands.push(header);
                    const [id, signature, target, base] = header.split(" ").slice(1).map(Number);
                    const copy = find(id!, signature!);
                    if (!copy) return { ok: false, message: "ERR invalid live patch" };
                    // Against what the key shows; into its live picture.
                    const shownNow = copy.live.get(target!) ?? copy.keys[target!]!;
                    if (base && actual.crc32(shownNow) !== base)
                        return { ok: false, message: "ERR live base" };
                    const next = shownNow.slice();
                    if (!decodeLivePatch(next, payload, KEY, KEY))
                        return { ok: false, message: "ERR live payload" };
                    copy.live.set(target!, next);
                    return ok("OK live");
                }
                // A key of the page being built, as a patch to what it holds.
                if (header.startsWith("PATCH ")) {
                    deck.commands.push(header);
                    const next = deck.pending!.keys[cell]!.slice();
                    if (!decodeLivePatch(next, payload, KEY, KEY))
                        return { ok: false, message: "ERR image patch" };
                    deck.pending!.keys[cell] = next;
                    deck.pending!.live.delete(cell);
                    deck.pending!.slides.delete(cell);
                    deck.pending!.sweeps.delete(cell);
                    return ok("OK image");
                }
                if (header.startsWith("SLIDE ")) {
                    deck.commands.push(header);
                    const [id, signature, target, , crc] = header.split(" ").slice(1).map(Number);
                    const copy = find(id!, signature!);
                    if (!copy) return { ok: false, message: "ERR invalid slide" };
                    if (actual.crc32(payload) !== crc)
                        return { ok: false, message: "ERR checksum mismatch" };
                    copy.slides.set(target!, crc!);
                    return ok("OK slide");
                }
                if (header.startsWith("SWEEP ")) {
                    deck.commands.push(header);
                    const [id, signature, target, , crc] = header.split(" ").slice(1).map(Number);
                    const copy = find(id!, signature!);
                    if (!copy) return { ok: false, message: "ERR invalid sweep" };
                    if (actual.crc32(payload) !== crc)
                        return { ok: false, message: "ERR checksum mismatch" };
                    copy.sweeps.set(target!, crc!);
                    return ok("OK sweep");
                }
                if (header.startsWith("ALT ")) return ok("OK alternate");
                deck.commands.push(`PUSH ${cell}`);
                deck.pending!.keys[cell] = Uint8Array.from(payload);
                deck.pending!.live.delete(cell);
                deck.pending!.slides.delete(cell);
                deck.pending!.sweeps.delete(cell);
                return ok("OK image");
            };
        },
    };
});

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
    return fixture.handlers.get(channel)!(
        { sender: fixture.contents, senderFrame: fixture.contents.mainFrame },
        ...args,
    );
}
const black = (): Uint8Array[] => Array.from({ length: 15 }, () => new Uint8Array(BYTES));
const face = new Uint8Array(BYTES).fill(0x11);
const tick = Uint8Array.from({ length: BYTES }, (_, i) => (i * 7 + 1) & 255);
// What the deck's screen shows: each key's live picture, else its own.
const shown = (): number[][] =>
    fixture.deck.shown!.keys.map((key, cell) =>
        Array.from(fixture.deck.shown!.live.get(cell) ?? key),
    );
const cache = (frames: Uint8Array[]) =>
    call("pages:cache", [{ pageId: "home", frames, toggleFrames: [] }]);
const press = (cell: number, down: boolean) =>
    fixture.link!.onEvent!({ kind: "key", page: 0, cell, down, at: Date.now() });
const move = (cell: number, y: number) =>
    fixture.link!.onEvent!({ kind: "move", page: 0, cell, y, at: Date.now() });
const settle = (cell: number, index: number) =>
    fixture.link!.onEvent!({ kind: "wheel", page: 0, cell, index, at: Date.now() });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wheelLines = () => fixture.deck.commands.filter((line) => line.startsWith("WHEEL"));
// One pixel wide and fully drawn: enough for the deck to take a font.
const glyphs = (chars: string) =>
    [...chars].map((char) => ({ char, width: 1, alpha: new Uint8Array(4).fill(255) }));
const DICE = { type: "dice", mode: "list", options: "a, b, c, d, e, f" } as const;

afterAll(async () => {
    fixture.events.get("before-quit")?.({ preventDefault: () => {} });
    await rm(fixture.folder, { recursive: true, force: true });
});

describe("widget keys on the deck", () => {
    it("never leave a moved widget's picture where it was", async () => {
        const config: DeckConfig = createConfig();
        const widget = (kind: "digital" | "analog") => ({
            label: "",
            icon: "Clock",
            color: "#eee8da",
            behavior: "normal" as const,
            action: {
                kind: "widget" as const,
                widget: { ...defaultWidget("clock"), style: kind } as never,
            },
        });
        config.pages[0]!.keys = { 0: widget("digital"), 2: widget("analog") };
        config.pages[0]!.keys[4] = {
            ...widget("digital"),
            action: { kind: "widget", widget: { type: "counter", start: 0, step: 1 } },
        };
        config.pages[0]!.keys[6] = {
            ...widget("digital"),
            action: {
                kind: "widget",
                widget: { type: "timer", mode: "countdown", seconds: 300, adjustable: true },
            },
        };
        config.pages[0]!.keys[8] = {
            ...widget("digital"),
            action: { kind: "widget", widget: { type: "volume", style: "arc" } },
        };
        config.pages[0]!.keys[10] = {
            ...widget("digital"),
            action: { kind: "widget", widget: DICE },
        };
        config.pages[0]!.keys[12] = {
            ...widget("digital"),
            action: { kind: "widget", widget: { type: "dice", mode: "die", options: "" } },
        };
        fixture.config = config;
        await import("../src/main/index");
        await vi.waitFor(() => expect(fixture.handlers.has("pages:cache")).toBe(true));
        await call("deck:status");

        // A digital clock's own picture is its background: black, like no key.
        const first = black();
        first[2] = face;
        await cache(first);
        expect(shown()).toEqual(first.map((key) => Array.from(key)));
        await call("deck:live", "home", 0, tick);
        await call("deck:live", "home", 2, tick);
        expect(shown()[0]).toEqual(Array.from(tick));

        // Moved, it leaves the page's pictures - and signature - unchanged.
        await call("keys:move", { pageId: "home", cell: 0 }, { pageId: "home", cell: 1 });
        await cache(first);
        expect(shown()[0]).toEqual(Array.from(new Uint8Array(BYTES)));
        expect(shown()[2]).toEqual(Array.from(tick));
        // A tick drawn before the move does not land where the clock was.
        expect(await call("deck:live", "home", 0, tick)).toMatchObject({
            message: "That key is not a widget.",
        });
        await call("deck:live", "home", 1, tick);
        expect(shown()[1]).toEqual(Array.from(tick));
        expect(shown()[0]).toEqual(Array.from(new Uint8Array(BYTES)));

        // The analog clock moves: a new version, built on the deck from the
        // copy on screen. Only the two keys that changed go - the digital
        // clock's is the same, and it goes on showing its time - and the
        // analog clock's last picture is not left where it was.
        await call("keys:move", { pageId: "home", cell: 2 }, { pageId: "home", cell: 3 });
        const second = black();
        second[3] = face;
        const from = fixture.deck.commands.length;
        await cache(second);
        const building = fixture.deck.commands.slice(from);
        expect(
            building
                .filter((line) => /^(PUSH|PATCH|BLANK) /.test(line))
                .map((l) => l.split(" ")[0] + l.split(" ")[1]),
        ).toEqual(["BLANK2", "PATCH3"]);
        expect(shown()).toEqual(second.map((key, cell) => Array.from(cell === 1 ? tick : key)));
        // A patch for the clock goes against its time, still on the deck.
        const later = Uint8Array.from({ length: BYTES }, (_, i) => (i * 5 + 3) & 255);
        const sent = fixture.deck.commands.length;
        await call("deck:live", "home", 1, later);
        expect(fixture.deck.commands.slice(sent)).toEqual([
            expect.stringMatching(/^LIVE 0 \d+ 1 [1-9]/),
        ]);
        expect(shown()[1]).toEqual(Array.from(later));
        // Every committed page holds exactly the pictures it was sent.
        const { crc32 } = await import("../src/main/device/serial");
        for (const commit of fixture.deck.commits)
            expect(crc32(Buffer.concat(commit.keys))).toBe(commit.signature);
    });

    it("holds the moment a press lasts long enough, not when it is let go", async () => {
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        press(4, true);
        press(4, false);
        expect(await states()).toMatchObject({ "home:4": { value: 1 } });
        press(4, true);
        await new Promise((resolve) => setTimeout(resolve, 700));
        // Still held: the counter is already back at its start.
        expect((await states())["home:4"]).toBeUndefined();
        press(4, false);
        expect((await states())["home:4"]).toBeUndefined();
    });

    it("turns a countdown's wheel with a swipe, and taps only without one", async () => {
        // The deck was told which keys a finger turns as soon as the page landed:
        // not the die, which any touch throws.
        expect(fixture.deck.commands).toContain(`DRAG ${(1 << 6) | (1 << 8) | (1 << 10)}`);
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        // Up 30 px: two steps, 5:00 to 7:00. It lasted past a hold, and neither
        // tapped (started) nor held.
        press(6, true);
        move(6, 60);
        move(6, 45);
        expect((await states())["home:6"]).toEqual({ picked: { seconds: 360, over: 300 } });
        move(6, 30);
        await new Promise((resolve) => setTimeout(resolve, 700));
        press(6, false);
        expect((await states())["home:6"]).toEqual({ picked: { seconds: 420, over: 300 } });
        // A finger that stays put taps: it starts, from the picked time.
        press(6, true);
        move(6, 60);
        move(6, 62);
        press(6, false);
        expect((await states())["home:6"]).toMatchObject({
            running: true,
            picked: { seconds: 420 },
        });
        // Running, a swipe changes nothing - and does not pause it either.
        press(6, true);
        move(6, 60);
        move(6, 10);
        press(6, false);
        expect((await states())["home:6"]).toMatchObject({
            running: true,
            picked: { seconds: 420 },
        });
    });

    it("hands a countdown at rest to the deck to turn, and keeps the time it lands on", async () => {
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        // Back at rest: a hold resets it and keeps the picked time.
        press(6, true);
        await sleep(700);
        press(6, false);
        expect((await states())["home:6"]).toEqual({ picked: { seconds: 420, over: 300 } });
        const values = wheelValues({ type: "timer", mode: "countdown", seconds: 300 });
        const spec = encodeWheelSpec({
            kind: "drum",
            row: 4,
            center: 4,
            clipTop: 0,
            clipBottom: KEY,
            color: 0xffff,
            feel: WHEEL_FEEL,
            backdrop: encodeLivePatch(null, new Uint8Array(BYTES), KEY, KEY),
            sizes: [
                {
                    height: 4,
                    glyphs: [..."0123456789:"].map((char) => ({
                        char,
                        width: 1,
                        alpha: new Uint8Array(4).fill(255),
                    })),
                },
            ],
            labels: values.map((seconds) => ({ size: 0, text: formatDuration(seconds * 1000) })),
        });
        // A look the deck does not keep yet: it says so, and gets it whole.
        await call("deck:wheel", "home", 6, spec, values, values.indexOf(420));
        expect(wheelLines().map((line) => line.split(" ")[0])).toEqual(["WHEELAT", "WHEEL"]);
        // Armed the same again, nothing goes.
        await call("deck:wheel", "home", 6, spec, values, values.indexOf(420));
        expect(wheelLines()).toHaveLength(2);
        // The deck's wheel came to rest on 10:00: the countdown's time now, and
        // arming it there - what the app does next - is already true.
        settle(6, values.indexOf(600));
        expect((await states())["home:6"]).toEqual({ picked: { seconds: 600, over: 300 } });
        await call("deck:wheel", "home", 6, spec, values, values.indexOf(600));
        expect(wheelLines()).toHaveLength(2);
        // A swipe on a wheel the deck turns steps nothing here, and taps nothing.
        press(6, true);
        move(6, 60);
        move(6, 10);
        press(6, false);
        expect((await states())["home:6"]).toEqual({ picked: { seconds: 600, over: 300 } });
        // A tap starts it; its first picture takes the key back from the wheel.
        press(6, true);
        move(6, 60);
        press(6, false);
        expect((await states())["home:6"]).toMatchObject({ running: true });
        await sleep(5);
        expect(await call("deck:live", "home", 6, tick)).toMatchObject({ ok: true });
        expect(await call("deck:wheel", "home", 6, spec, values, 0)).toMatchObject({
            message: "The countdown is running.",
        });
        // A look that does not match its times is refused before it is sent.
        await expect(call("deck:wheel", "home", 6, spec, values.slice(1), 0)).rejects.toThrow(
            /Invalid wheel/,
        );
    });

    it("sets the PC's volume as a finger turns the dial on the deck", async () => {
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        // The volume as Windows has it, read once the page landed.
        await vi.waitFor(async () =>
            expect((await states())["home:8"]).toEqual({ level: 40, muted: false }),
        );
        const blank = new Uint8Array(BYTES);
        const dial = encodeWheelSpec({
            kind: "dial",
            min: 0,
            max: 100,
            unitPx: 1.2,
            textY: 4,
            color: 0xffff,
            backdrop: encodeLivePatch(null, blank, KEY, KEY),
            fill: encodeLivePatch(blank, new Uint8Array(BYTES).fill(0x7e), KEY, KEY),
            map: new Uint8Array(KEY * KEY).fill(128),
            size: { height: 4, glyphs: glyphs("0123456789") },
        });
        const before = wheelLines().length;
        expect(await call("deck:wheel", "home", 8, dial, [], 40)).toMatchObject({ ok: true });
        expect(
            wheelLines()
                .slice(before)
                .map((line) => line.split(" ")[0]),
        ).toEqual(["WHEELAT", "WHEEL"]);
        // Turned to 55: Windows follows, and so does the key.
        fixture.link!.onEvent!({ kind: "value", page: 0, cell: 8, value: 55, at: Date.now() });
        await vi.waitFor(async () =>
            expect((await states())["home:8"]).toEqual({ level: 55, muted: false }),
        );
        expect(fixture.host.filter((asked) => asked.op === "level")).toEqual([
            { op: "level", fields: { flow: 0, level: 55, unmute: true } },
        ]);
        // The app's next look is where the deck's dial already is: nothing goes.
        await call("deck:wheel", "home", 8, dial, [], 55);
        expect(wheelLines()).toHaveLength(before + 2);
    });

    it("spins a list on the deck, always forward, and keeps the choice it lands on", async () => {
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        const values = diceLabels(DICE);
        const drum = encodeWheelSpec({
            kind: "drum",
            row: 4,
            center: 4,
            clipTop: 0,
            clipBottom: KEY,
            color: 0xffff,
            feel: DICE_FEEL,
            backdrop: encodeLivePatch(null, new Uint8Array(BYTES), KEY, KEY),
            sizes: [{ height: 4, glyphs: glyphs("ABCDEF") }],
            labels: values.map((face) => ({ size: 0, text: "ABCDEF"[face]! })),
        });
        const rolls = () =>
            fixture.deck.commands
                .filter((line) => line.startsWith("WHEELROLL"))
                .map((line) => Number(line.split(" ")[4]));
        // At rest on the first choice, a turn of them in.
        await call("deck:wheel", "home", 10, drum, values, 6);
        const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
        try {
            // A tap picks the fourth: two turns at least, to the next of it.
            press(10, true);
            press(10, false);
            await vi.waitFor(() => expect(rolls()).toEqual([21]));
            // Tapped again while it spins, it rolls on from there, never back.
            press(10, true);
            press(10, false);
            await vi.waitFor(() => expect(rolls()).toEqual([21, 33]));
        } finally {
            random.mockRestore();
        }
        settle(10, 33);
        expect((await states())["home:10"]).toEqual({ value: 3 });
        // The app puts it back a turn in, on the same choice; the deck keeps
        // the look, so one line arms it there.
        const before = wheelLines().length;
        await call("deck:wheel", "home", 10, drum, values, 3 + 6);
        expect(wheelLines().slice(before)).toEqual([
            expect.stringMatching(/^WHEELAT 0 \d+ 10 9 \d+$/),
        ]);
    });

    it("throws a die on the deck with a tap, and keeps how it landed", async () => {
        const states = async () => (await call("widgets:states")) as Record<string, unknown>;
        const die = encodeWheelSpec({
            kind: "die",
            size: 12,
            color: 0xffff,
            pip: 0,
            feel: DIE_FEEL,
            backdrop: encodeLivePatch(null, new Uint8Array(BYTES), KEY, KEY),
        });
        const middle = packPose({ face: 0, x: 64, y: 64, yaw: 0 });
        const before = wheelLines().length;
        expect(await call("deck:wheel", "home", 12, die, [], middle)).toMatchObject({ ok: true });
        expect(
            wheelLines()
                .slice(before)
                .map((line) => line.split(" ")[0]),
        ).toEqual(["WHEELAT", "WHEEL"]);
        // A tap throws it; where it lands is the deck's to say.
        press(12, true);
        press(12, false);
        await vi.waitFor(() =>
            expect(fixture.deck.commands.at(-1)).toMatch(/^WHEELROLL 0 \d+ 12 0$/),
        );
        expect((await states())["home:12"]).toBeUndefined();
        const landed = packPose({ face: 4, x: 30, y: 90, yaw: 123 });
        settle(12, landed);
        expect((await states())["home:12"]).toEqual({ value: 4, rest: landed });
        // Armed where it lies already: nothing goes.
        const sent = wheelLines().length;
        await call("deck:wheel", "home", 12, die, [], landed);
        expect(wheelLines()).toHaveLength(sent);
        // Should the deck drop it (older firmware, its look pushed out by
        // another), a tap still rolls - in the app - and the look goes again.
        fixture.deck.armed.delete(12);
        fixture.deck.looks.clear();
        press(12, true);
        press(12, false);
        await vi.waitFor(async () =>
            expect((await states())["home:12"]).toMatchObject({ value: expect.any(Number) }),
        );
        expect((await states())["home:12"]).not.toHaveProperty("rest");
        const again = wheelLines().length;
        await call("deck:wheel", "home", 12, die, [], landed);
        expect(
            wheelLines()
                .slice(again)
                .map((line) => line.split(" ")[0]),
        ).toEqual(["WHEELAT", "WHEEL"]);
        expect(fixture.deck.armed.has(12)).toBe(true);
        // A pose that is not one is refused before it is sent.
        await expect(call("deck:wheel", "home", 12, die, [], 7)).rejects.toThrow(/Invalid wheel/);
    });

    it("loads every page's widgets as they are, and their looks, before the page is shown", async () => {
        const config = (await call("config:get")) as DeckConfig;
        const next: DeckConfig = structuredClone(config);
        next.pages.push({
            id: "tools",
            name: "Tools",
            parentId: "home",
            keys: {
                0: {
                    label: "",
                    icon: "Clock",
                    color: "#eee8da",
                    action: { kind: "widget", widget: { type: "counter", start: 0, step: 1 } },
                },
            },
        });
        await call("config:save", next);
        const look = encodeWheelSpec({
            kind: "die",
            size: 12,
            color: 0xffff,
            pip: 0,
            feel: DIE_FEEL,
            backdrop: encodeLivePatch(null, new Uint8Array(BYTES).fill(3), KEY, KEY),
        });
        const counter = new Uint8Array(BYTES).fill(0x42);
        const from = fixture.deck.commands.length;
        const reply = await call(
            "pages:cache",
            [
                { pageId: "home", frames: black(), toggleFrames: [] },
                { pageId: "tools", frames: black(), toggleFrames: [] },
            ],
            {
                widgets: [
                    { pageId: "tools", cell: 0, frame: counter },
                    // Not a widget: left alone.
                    { pageId: "tools", cell: 1, frame: counter },
                ],
                looks: [{ pageId: "tools", spec: look }],
            },
        );
        expect(reply).toMatchObject({ ok: true });
        const sent = fixture.deck.commands.slice(from);
        const live = sent.findIndex((line) => /^LIVE 1 \d+ 0 /.test(line));
        const ahead = sent.findIndex((line) => /^WHEEL 1 \d+ -1 /.test(line));
        const shown = sent.findIndex((line) => line.startsWith("STATE 0"));
        // The hidden page's widget, then the look ahead, then the page shown.
        expect(live).toBeGreaterThanOrEqual(0);
        expect(ahead).toBeGreaterThan(live);
        expect(shown).toBeGreaterThan(ahead);
        expect(sent.filter((line) => line.startsWith("LIVE 1"))).toHaveLength(1);
        const copy = fixture.deck.copies.find((item) => item.id === 1)!;
        expect(Array.from(copy.live.get(0)!)).toEqual(Array.from(counter));
        // Afterwards the hidden page keeps being brought up to date, where the
        // deck takes it (warm=1).
        const later = new Uint8Array(BYTES).fill(0x24);
        expect(await call("deck:live", "tools", 0, later)).toMatchObject({ ok: true });
        expect(Array.from(copy.live.get(0)!)).toEqual(Array.from(later));
    });

    it("hands the deck text too long for a key to slide: after its picture, when it changes, on each copy", async () => {
        const { crc32 } = await import("../src/main/device/serial");
        const text = (fill: number) =>
            encodeSlide({
                feel: SLIDE_FEEL,
                lines: [
                    {
                        ...{ x: 4, y: 10, w: 20, h: 8, width: 40, color: 0xffff },
                        alpha: new Uint8Array(40 * 8).fill(fill),
                    },
                ],
            });
        const names = (from: number) =>
            fixture.deck.commands.slice(from).map((line) => line.split(" ")[0]);
        const title = text(200);
        const picture = new Uint8Array(BYTES).fill(0x51);
        let from = fixture.deck.commands.length;
        expect(await call("deck:live", "home", 4, picture, { slide: title })).toMatchObject({
            ok: true,
        });
        // The picture first: the old picture never shows under the new text.
        expect(names(from)).toEqual(["LIVE", "SLIDE"]);
        expect(fixture.deck.shown!.slides.get(4)).toBe(crc32(title));

        // The same text again costs nothing; a new picture under it goes alone.
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, picture, { slide: title });
        expect(names(from)).toEqual([]);
        await call("deck:live", "home", 4, new Uint8Array(BYTES).fill(0x52), { slide: title });
        expect(names(from)).toEqual(["LIVE"]);
        // Where the app says nothing of text, it is left as it is.
        await call("deck:live", "home", 4, picture);
        expect(fixture.deck.shown!.slides.get(4)).toBe(crc32(title));
        // New text replaces it; none takes it away.
        const next = text(90);
        await call("deck:live", "home", 4, picture, { slide: next });
        expect(fixture.deck.shown!.slides.get(4)).toBe(crc32(next));
        await call("deck:live", "home", 4, picture, { slide: null });
        expect(fixture.deck.commands.at(-1)).toMatch(/^SLIDE 0 \d+ 4 0 0$/);
        expect(fixture.deck.shown!.slides.has(4)).toBe(false);
        // Text the deck would refuse is refused here.
        await expect(
            call("deck:live", "home", 4, picture, { slide: Uint8Array.from([1, 1, 0]) }),
        ).rejects.toThrow(/Invalid sliding text/);

        // A new version of the page carries the key's picture and the text
        // sliding over it, so neither goes again - and loading hands a hidden
        // page's text over with its picture.
        await call("deck:live", "home", 4, picture, { slide: title });
        const changed = black();
        changed[14] = face;
        from = fixture.deck.commands.length;
        const reply = await call(
            "pages:cache",
            [
                { pageId: "home", frames: changed, toggleFrames: [] },
                { pageId: "tools", frames: black(), toggleFrames: [] },
            ],
            {
                widgets: [
                    { pageId: "tools", cell: 0, frame: picture, overlays: { slide: title } },
                    // Text the deck would refuse: that widget is left out.
                    {
                        pageId: "tools",
                        cell: 0,
                        frame: picture,
                        overlays: { slide: Uint8Array.from([9]) },
                    },
                ],
                looks: [],
            },
        );
        expect(reply).toMatchObject({ ok: true });
        const loading = fixture.deck.commands.slice(from);
        const hidden = loading.findIndex((line) => /^SLIDE 1 \d+ 0 /.test(line));
        expect(hidden).toBeGreaterThan(loading.findIndex((line) => /^LIVE 1 \d+ 0 /.test(line)));
        expect(loading.filter((line) => line.startsWith("SLIDE"))).toHaveLength(1);
        expect(fixture.deck.shown!.slides.get(4)).toBe(crc32(title));
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, picture, { slide: title });
        expect(names(from)).toEqual([]);
        // A key's picture dropped takes its text: a new picture brings both back.
        await call("deck:live", "home", 4, new Uint8Array(BYTES).fill(0x63), { slide: null });
        expect(fixture.deck.shown!.slides.has(4)).toBe(false);
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, picture, { slide: title });
        expect(names(from)).toEqual(["LIVE", "SLIDE"]);
    });

    it("hands the deck a ring's arc to move: once while its motion holds, in this PC's clock", async () => {
        const { crc32 } = await import("../src/main/device/serial");
        const arc = (motion: SweepMotion) =>
            encodeSweep({
                ...{ x: 16, y: 16, r: 9, width: 2, color: "#ffffff", alpha: 1 },
                ...{ glow: 0, reach: 0, motion },
                motion,
            });
        const names = (from: number) =>
            fixture.deck.commands.slice(from).map((line) => line.split(" ")[0]);
        const digits = (fill: number) => new Uint8Array(BYTES).fill(fill);
        const running = arc({ zero: Date.now() - 4000, turn: 60_000, round: true });
        let from = fixture.deck.commands.length;
        const before = Date.now();
        await call("deck:live", "home", 4, digits(0x71), { sweep: running });
        // The picture with its track, then the arc - its line ending with the
        // clock it moves by, as it was sent.
        expect(names(from)).toEqual(["LIVE", "SWEEP"]);
        const line = fixture.deck.commands.at(-1)!.split(" ");
        expect(line.slice(4, 6)).toEqual([String(running.length), String(crc32(running))]);
        expect(Number(line[6])).toBeGreaterThanOrEqual(before);
        expect(Number(line[6])).toBeLessThanOrEqual(Date.now());
        expect(fixture.deck.shown!.sweeps.get(4)).toBe(crc32(running));

        // Each second's digits go alone: the arc's motion has not changed.
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, digits(0x72), { sweep: running });
        await call("deck:live", "home", 4, digits(0x73), { sweep: running });
        expect(names(from)).toEqual(["LIVE", "LIVE"]);
        // Paused, it is held: a new arc.
        const paused = arc({ share: 0.4 });
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, digits(0x74), { sweep: paused });
        expect(names(from)).toEqual(["LIVE", "SWEEP"]);
        // Gone, it goes before the picture that has none: never over it.
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, digits(0x75), { sweep: null });
        expect(fixture.deck.commands.slice(from)[0]).toMatch(/^SWEEP 0 \d+ 4 0 0 0$/);
        expect(names(from)).toEqual(["SWEEP", "LIVE"]);
        expect(fixture.deck.shown!.sweeps.has(4)).toBe(false);
        // One the deck would refuse is refused here.
        await expect(
            call("deck:live", "home", 4, digits(0x75), { sweep: running.slice(0, 20) }),
        ).rejects.toThrow(/Invalid ring/);

        // A new version of the page carries the arc with the key's picture.
        await call("deck:live", "home", 4, digits(0x76), { sweep: running });
        const changed = black();
        changed[14] = face;
        await call("pages:cache", [
            { pageId: "home", frames: changed, toggleFrames: [] },
            { pageId: "tools", frames: black(), toggleFrames: [] },
        ]);
        expect(fixture.deck.shown!.sweeps.get(4)).toBe(crc32(running));
        from = fixture.deck.commands.length;
        await call("deck:live", "home", 4, digits(0x76), { sweep: running });
        expect(names(from)).toEqual([]);
    });

    it("sends a page's new version as its changed keys alone, each a small patch", async () => {
        const config = (await call("config:get")) as DeckConfig;
        const home = config.pages.find((page) => page.id === "home")!;
        const widgets = Object.keys(home.keys)
            .map(Number)
            .filter((cell) => home.keys[String(cell)]?.action.kind === "widget");
        const cache = (frames: Uint8Array[]) =>
            call("pages:cache", [
                { pageId: "home", frames, toggleFrames: [] },
                { pageId: "tools", frames: black(), toggleFrames: [] },
            ]);
        // Every widget live on the deck, as they are in normal use.
        const base = black();
        await cache(base);
        for (const cell of widgets)
            await call("deck:live", "home", cell, new Uint8Array(BYTES).fill(0x30 + cell));
        // One key's own picture changes (a style setting, say): only it goes,
        // as a patch against what the deck holds, and every widget still
        // shows its picture.
        const edited = base.slice();
        edited[widgets[0]!] = Uint8Array.from({ length: BYTES }, (_, i) => (i < 64 ? 0x7f : 0));
        const from = fixture.deck.commands.length;
        await cache(edited);
        const building = fixture.deck.commands
            .slice(from)
            .filter((line) => /^(PUSH|PATCH|BLANK) /.test(line));
        expect(building).toHaveLength(1);
        expect(building[0]).toMatch(new RegExp(`^PATCH ${widgets[0]} \\d+ `));
        // A small patch: the changed rows, not the key.
        expect(Number(building[0]!.split(" ")[2])).toBeLessThan(BYTES / 4);
        for (const cell of widgets.slice(1))
            expect(shown()[cell]).toEqual(Array.from(new Uint8Array(BYTES).fill(0x30 + cell)));
        const { crc32 } = await import("../src/main/device/serial");
        const last = fixture.deck.commits.at(-1)!;
        expect(crc32(Buffer.concat(last.keys))).toBe(last.signature);
    });
});

describe("pages on the deck", () => {
    it("answers pictures drawn for a profile that changed meanwhile as stale, not as an error", async () => {
        const config = (await call("config:get")) as DeckConfig;
        const pages = config.pages.map((page) => ({
            pageId: page.id,
            frames: black(),
            toggleFrames: [],
        }));
        // A toggle key saved while pictures drawn without it waited to go.
        const next: DeckConfig = structuredClone(config);
        next.pages[0]!.keys[14] = {
            label: "Site",
            icon: "Globe",
            color: "#eee8da",
            behavior: "toggle",
            action: { kind: "website", url: "https://example.com" },
        };
        await call("config:save", next);
        expect(await call("pages:cache", pages)).toMatchObject({ ok: false, stale: true });
        // A page added meanwhile: the same.
        const more: DeckConfig = structuredClone(next);
        more.pages.push({ id: "late", name: "Late", parentId: "home", keys: {} });
        await call("config:save", more);
        expect(
            await call("pages:cache", [
                ...pages,
                { pageId: "home", frames: black(), toggleFrames: [] },
            ]).catch((error: unknown) => String(error)),
        ).toMatch(/Invalid cached page/);
        expect(await call("pages:cache", pages)).toMatchObject({ ok: false, stale: true });
        await call("config:save", config);
    });

    it("sends a widget's picture again when a new session drops what the deck held", async () => {
        const config = (await call("config:get")) as DeckConfig;
        const next: DeckConfig = structuredClone(config);
        next.pages.push({
            id: "fresh",
            name: "Fresh",
            parentId: "home",
            keys: {
                3: {
                    label: "",
                    icon: "Clock",
                    color: "#eee8da",
                    action: { kind: "widget", widget: { type: "counter", start: 0, step: 1 } },
                },
            },
        });
        next.activePageId = "fresh";
        await call("config:save", next);
        const saved = (await call("config:get")) as DeckConfig;
        const index = saved.pages.findIndex((page) => page.id === "fresh");
        const pages = saved.pages.map((page) => ({
            pageId: page.id,
            frames: black(),
            toggleFrames: [],
        }));
        const picture = new Uint8Array(BYTES).fill(0x5a);
        const warmup = { widgets: [{ pageId: "fresh", cell: 3, frame: picture }], looks: [] };
        const copy = () =>
            fixture.deck.copies.findLast((item) => item.id === index && item.complete)!;
        // A load that got as far as the widgets and then failed: the deck holds
        // the picture, and the load is unfinished, so the next one starts a new
        // session - which drops every live picture the deck holds.
        fixture.deck.refuse = "STATE";
        expect(await call("pages:cache", pages, warmup)).toMatchObject({ ok: false });
        expect(Array.from(copy().live.get(3)!)).toEqual(Array.from(picture));
        fixture.deck.refuse = null;
        const mark = fixture.deck.commands.length;
        expect(await call("pages:cache", pages, warmup)).toMatchObject({ ok: true });
        console.log(
            "RUN2",
            fixture.deck.commands.slice(mark).map((l) => l.split(" ").slice(0, 3).join(" ")),
        );
        // The same picture, unchanged since: it has to go again, or the key
        // would stay blank until whatever it shows changes.
        expect(Array.from(copy().live.get(3) ?? [])).toEqual(Array.from(picture));
        await call("config:save", config);
    });

    it("goes Back to the page a page was opened from, else to its parent", async () => {
        const config = (await call("config:get")) as DeckConfig;
        const next: DeckConfig = structuredClone(config);
        next.pages.push(
            { id: "debug", name: "Debug", parentId: "home", keys: {} },
            { id: "discord", name: "Discord", parentId: "home", keys: {} },
        );
        next.pages.find((page) => page.id === "debug")!.keys[0] = {
            label: "Discord",
            icon: "Folder",
            color: "#eee8da",
            action: { kind: "page", pageId: "discord" },
        };
        next.activePageId = "home";
        await call("config:save", next);
        const active = async () => ((await call("config:get")) as DeckConfig).activePageId;
        // Home → Debug → (its key) Discord → Back → Debug → Back → Home.
        await call("page:navigate", "debug");
        expect(await call("action:run", "debug", 0)).toMatchObject({ ok: true });
        expect(await active()).toBe("discord");
        expect(await call("action:run", "discord", 10)).toMatchObject({ message: "Back" });
        expect(await active()).toBe("debug");
        await call("page:back", "debug");
        expect(await active()).toBe("home");
        await call("config:save", config);
    });
});
