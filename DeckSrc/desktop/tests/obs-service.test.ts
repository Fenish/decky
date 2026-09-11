import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/shared/config";
import type { DeckConfig } from "../src/shared/config";
import type { IntegrationStatus } from "../src/shared/integrations/integration";
import type { Widget } from "../src/shared/widgets";
import { WidgetStore } from "../src/main/widgets/widget-state";
import { FakeObs } from "./fake-obs";

// Windows' credential protection, stood in for: "encrypted" is reversible here.
vi.mock("electron", () => ({
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(`sealed:${text}`),
        decryptString: (sealed: Buffer) => sealed.toString().replace(/^sealed:/, ""),
    },
}));

const { ObsService } = await import("../src/main/integrations/obs/obs-service");

/** Home with a Recording key on key 0, or `keys` of its own. */
function profile(keys: Record<number, Widget> = { 0: { type: "obs-record" } }): DeckConfig {
    const config = createConfig();
    config.pages[0]!.keys = Object.fromEntries(
        Object.entries(keys).map(([cell, widget]) => [
            cell,
            {
                label: "",
                icon: "Circle",
                color: "#eee8da",
                behavior: "normal",
                action: { kind: "widget", widget },
            },
        ]),
    );
    return config;
}

/** OBS on this PC, as the finder sees it; `launch` starts it (no OBS to start without). */
interface Pc {
    installed: boolean;
    running: boolean;
    launch?: () => boolean;
}

const files: string[] = [];
function service(obs: FakeObs, pc: Pc = { installed: true, running: false }) {
    const path = join(tmpdir(), `decky-obs-${Math.random().toString(36).slice(2)}.json`);
    files.push(path, `${path}.widgets`);
    const store = new WidgetStore(`${path}.widgets`, () => {});
    const statuses: IntegrationStatus[] = [];
    const obsService = new ObsService(
        store,
        path,
        {
            installed: async () => pc.installed,
            running: async () => pc.running,
            launch: async () => pc.launch?.() ?? false,
        },
        (status) => statuses.push(status),
        obs.open,
    );
    return { obsService, store, statuses };
}

afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(files.splice(0).map((file) => rm(file, { force: true })));
});

describe("OBS for the keys that show it", () => {
    it("connects while a key shows an output, and puts what OBS says in its state", async () => {
        const obs = new FakeObs();
        obs.answers.GetRecordStatus = () => ({ outputActive: false, outputDuration: 0 });
        const { obsService, store } = service(obs);
        obsService.sync(profile());
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.health).toBe("ready"));
        expect(store.get("home:0")?.obs).toMatchObject({ active: false });
        expect(obsService.status()).toMatchObject({
            id: "obs",
            health: "ready",
            version: "31.0.2",
        });
        // OBS starts recording some other way: the key follows, its time from now.
        obs.event("RecordStateChanged", {
            outputActive: true,
            outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        });
        await vi.waitFor(() =>
            expect(store.get("home:0")?.obs).toMatchObject({ active: true, ms: 0 }),
        );
        obsService.stop();
    });

    it("follows OBS's events in order, even when a status it answers is stale", async () => {
        const obs = new FakeObs();
        // Asked while a stop goes through, OBS can answer from before it: its
        // requests are answered on a pool of threads, so out of order.
        obs.answers.GetRecordStatus = () => ({ outputActive: true, outputDuration: 5_000 });
        const { obsService, store } = service(obs);
        obsService.sync(profile());
        await vi.waitFor(() =>
            expect(store.get("home:0")?.obs).toMatchObject({ health: "ready", active: true }),
        );
        obs.event("RecordStateChanged", {
            outputActive: true,
            outputState: "OBS_WEBSOCKET_OUTPUT_STOPPING",
        });
        obs.event("RecordStateChanged", {
            outputActive: false,
            outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED",
        });
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.active).toBe(false));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(store.get("home:0")?.obs?.active).toBe(false);
        // Paused, the time holds; resumed, it runs on; reconnecting shows.
        obs.event("RecordStateChanged", {
            outputActive: true,
            outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        });
        obs.event("RecordStateChanged", {
            outputActive: true,
            outputState: "OBS_WEBSOCKET_OUTPUT_PAUSED",
        });
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.paused).toBe(true));
        obs.event("RecordStateChanged", {
            outputActive: true,
            outputState: "OBS_WEBSOCKET_OUTPUT_RESUMED",
        });
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.paused).toBe(false));
        obsService.stop();
    });

    it("says why when OBS cannot be reached: not installed, closed, or its server off", async () => {
        const standings: [boolean, boolean, string][] = [
            [false, false, "missing"],
            [true, false, "closed"],
            [true, true, "off"],
        ];
        for (const [installed, running, health] of standings) {
            const obs = new FakeObs();
            obs.reachable = false;
            const { obsService, store } = service(obs, { installed, running });
            obsService.sync(profile());
            await vi.waitFor(() => expect(store.get("home:0")?.obs?.health).toBe(health));
            obsService.stop();
        }
    });

    it("says a password was refused, and waits for a new one", async () => {
        const obs = new FakeObs();
        obs.password = "right";
        const { obsService, store } = service(obs);
        obsService.sync(profile());
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.health).toBe("denied"));
        obsService.stop();
    });

    it("counts down before starting, and a second touch calls it off", async () => {
        const obs = new FakeObs();
        obs.answers.GetRecordStatus = () => ({ outputActive: false });
        const { obsService, store } = service(obs);
        obsService.sync(profile());
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.health).toBe("ready"));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        const failed = vi.fn();
        expect(obsService.touch("home:0", "record", failed)).toMatch(/^Starting in 5 seconds/);
        expect(store.get("home:0")?.arming).toMatchObject({ start: true });
        vi.advanceTimersByTime(4000);
        expect(obsService.touch("home:0", "record", failed)).toBe("Called off.");
        expect(store.get("home:0")?.arming).toBeUndefined();
        vi.advanceTimersByTime(5000);
        expect(obs.requests()).not.toContain("StartRecord");
        // Left to run out, OBS is asked to start.
        obsService.touch("home:0", "record", failed);
        vi.advanceTimersByTime(5000);
        expect(obs.requests()).toContain("StartRecord");
        expect(store.get("home:0")?.arming).toBeUndefined();
        expect(failed).not.toHaveBeenCalled();
        obsService.stop();
    });

    it("keeps its settings as asked, a secret left out as saved, and refuses a bad address", async () => {
        const obs = new FakeObs();
        const { obsService } = service(obs);
        await obsService.load();
        await obsService.save({ address: "localhost:4455", password: "hunter2" });
        await expect(obsService.save({ address: "no port", password: null })).rejects.toThrow(
            /host:port/,
        );
        const status = await obsService.save({ address: "127.0.0.1:4456", password: null });
        expect(status.values).toEqual({ address: "127.0.0.1:4456" });
        expect(status.saved).toEqual({ password: true });
        obsService.stop();
    });

    it("starts OBS when asked, and follows it once its server answers", async () => {
        const obs = new FakeObs();
        obs.reachable = false;
        const pc: Pc = {
            installed: true,
            running: false,
            launch: () => (pc.running = true),
        };
        const { obsService, statuses } = service(obs, pc);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        const opened = obsService.open();
        // OBS runs at once, but its WebSocket server starts a moment later.
        await vi.advanceTimersByTimeAsync(1000);
        expect(obsService.status().health).toBe("off");
        obs.reachable = true;
        await vi.advanceTimersByTimeAsync(1000);
        await expect(opened).resolves.toEqual({ ok: true, message: "Connected to OBS 31.0.2." });
        expect(statuses.at(-1)?.health).toBe("ready");
        obsService.stop();
    });

    it("starts no second OBS, and says when there is none to start", async () => {
        const launch = vi.fn(() => true);
        const running = service(new FakeObs(), { installed: true, running: true, launch });
        await expect(running.obsService.open()).resolves.toMatchObject({ ok: true });
        expect(launch).not.toHaveBeenCalled();
        running.obsService.stop();
        const none = service(new FakeObs(), { installed: false, running: false });
        await expect(none.obsService.open()).resolves.toMatchObject({
            ok: false,
            message: expect.stringMatching(/no OBS to start/),
        });
        none.obsService.stop();
    });

    it("lets go of OBS when no key shows it", async () => {
        const obs = new FakeObs();
        obs.answers.GetRecordStatus = () => ({ outputActive: false });
        const { obsService, store } = service(obs);
        obsService.sync(profile());
        await vi.waitFor(() => expect(store.get("home:0")?.obs?.health).toBe("ready"));
        const opened = obs.sent.filter((m) => m.op === 1).length;
        obsService.sync(profile({}));
        obs.event("RecordStateChanged");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(obs.sent.filter((m) => m.op === 1)).toHaveLength(opened);
        expect(obs.requests().filter((r) => r === "GetRecordStatus")).toHaveLength(1);
        obsService.stop();
    });
});
