import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
    // Decky's own folder (app.getPath), fresh each run: what one run saves -
    // widget state, a running countdown - must not be there for the next.
    folder: `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/decky-fixture-${process.pid}-${Date.now()}`,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    events: new Map<string, (event: { preventDefault: () => void }) => void>(),
    commands: [] as string[],
    pushes: [] as number[],
    contents: {
        mainFrame: {},
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        session: { setPermissionRequestHandler: vi.fn() },
    },
    config: {
        version: 2,
        activePageId: "home",
        reducedMotion: true,
        pages: [
            {
                id: "home",
                name: "Home",
                parentId: null,
                keys: {
                    0: {
                        label: "Mute",
                        icon: "mic",
                        color: "#ffffff",
                        behavior: "toggle",
                        action: { kind: "hotkey", keys: "Ctrl+M" },
                    },
                    1: {
                        label: "Deafen",
                        icon: "volume",
                        color: "#ffffff",
                        behavior: "toggle",
                        action: { kind: "hotkey", keys: "Ctrl+D" },
                    },
                },
            },
        ],
    },
}));
vi.mock("electron", () => ({
    app: {
        setName: vi.fn(),
        setAppUserModelId: vi.fn(),
        requestSingleInstanceLock: () => true,
        on: (name: string, fn: (event: { preventDefault: () => void }) => void) =>
            fixture.events.set(name, fn),
        whenReady: async () => {},
        getPath: () => fixture.folder,
        quit: vi.fn(),
    },
    BrowserWindow: class {
        webContents = fixture.contents;
        on = vi.fn();
        once = vi.fn();
        loadFile = async () => {};
        loadURL = async () => {};
        isDestroyed = () => false;
    },
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: () => [] },
    Tray: class {
        setToolTip = vi.fn();
        setContextMenu = vi.fn();
        on = vi.fn();
        destroy = vi.fn();
    },
    nativeImage: { createFromPath: () => ({}) },
    dialog: { showErrorBox: vi.fn() },
    ipcMain: {
        handle: (name: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
            fixture.handlers.set(name, fn),
    },
}));
vi.mock("../src/main/config/store", () => ({
    loadConfig: async () => fixture.config,
    saveConfig: async () => {},
}));
vi.mock("../src/main/programs/catalog", () => ({ getProgramIcon: vi.fn(), listPrograms: vi.fn() }));
vi.mock("../src/main/actions/runner", () => ({
    ActionRunner: class {
        run = async () => ({ ok: true, message: "Done" });
        cancel = vi.fn();
        prepare = () => {};
        stop = () => {};
    },
}));
vi.mock("../src/main/device/serial", async () => {
    const actual = await vi.importActual<typeof import("../src/main/device/serial")>(
        "../src/main/device/serial",
    );
    return {
        ...actual,
        DeckLink: class {
            openPath = "TEST";
            onEvent = null;
            static listPorts = async () => [{ path: "TEST" }];
            identify = async () => ({
                portPath: "TEST",
                protocol: 4,
                serial: "fixture",
                cells: 15,
                columns: 5,
                rows: 3,
                keyWidth: 2,
                keyHeight: 2,
                pages: 64,
                cacheSlots: 8,
            });
            stillAttached = async () => true;
            close = async () => {};
            command = async (line: string) => {
                fixture.commands.push(line);
                return { ok: true, message: line.startsWith("CACHE") ? "OK page cached=1" : "OK" };
            };
            push = async (cell: number) => {
                fixture.pushes.push(cell);
                return { ok: true, message: "OK alternate" };
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
afterAll(async () => {
    fixture.events.get("before-quit")?.({ preventDefault: () => {} });
    await rm(fixture.folder, { recursive: true, force: true });
});
describe("independent toggle synchronization", () => {
    it("preloads both toggles once, then alternates every state with commands only", async () => {
        await import("../src/main/index");
        await vi.waitFor(() => expect(fixture.handlers.has("pages:cache")).toBe(true));
        await call("deck:status");
        const frames = Array.from({ length: 15 }, () => new Uint8Array(8));
        await call("pages:cache", [
            {
                pageId: "home",
                frames,
                toggleFrames: [
                    { cell: 0, frame: new Uint8Array(8) },
                    { cell: 1, frame: new Uint8Array(8) },
                ],
            },
        ]);
        expect(fixture.commands).toContain("HELLO 1 17");
        const pushes = fixture.pushes.length;
        const start = fixture.commands.length;
        for (let round = 0; round < 4; round++)
            for (const cell of [0, 1, 0, 1]) await call("action:run", "home", cell);
        expect(fixture.pushes).toHaveLength(pushes);
        const commands = fixture.commands.slice(start);
        expect(commands).toHaveLength(16);
        expect(commands.every((command) => command.startsWith("STATE 0 "))).toBe(true);
        expect(commands.map((command) => Number(command.split(" ").at(-1)))).toEqual(
            Array.from({ length: 4 }, () => [1, 3, 2, 0]).flat(),
        );
    });
});
