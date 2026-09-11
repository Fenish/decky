import { describe, expect, it, vi } from "vitest";
const { openExternal, send, start, stop } = vi.hoisted(() => ({
    openExternal: vi.fn(async () => {}),
    send: vi.fn(() => null),
    start: vi.fn(),
    stop: vi.fn(),
}));
vi.mock("electron", () => ({ shell: { openExternal } }));
vi.mock("../src/main/actions/hotkeys", () => ({
    HotkeySender: class {
        send = send;
        start = start;
        stop = stop;
    },
}));
import { ActionRunner } from "../src/main/actions/runner";
import { createConfig } from "../src/shared/config";
import type { DeckConfig } from "../src/shared/config";
describe("macro execution", () => {
    it("runs steps in order and stops after an error", async () => {
        const runner = new ActionRunner();
        openExternal.mockRejectedValueOnce(new Error("Browser launch failed"));
        const result = await runner.run({
            kind: "macro",
            steps: [
                { kind: "website", url: "https://example.com" },
                { kind: "hotkey", keys: "F13" },
            ],
        });
        expect(result.ok).toBe(false);
        expect(result.message).toContain("Browser launch failed");
        expect(send).not.toHaveBeenCalled();
    });
    it("lets other keys run while a macro waits, and cancels the waiting macro", async () => {
        const runner = new ActionRunner();
        const running = runner.run({
            kind: "macro",
            steps: [
                { kind: "delay", ms: 5000 },
                { kind: "hotkey", keys: "F13" },
            ],
        });
        expect((await runner.run({ kind: "hotkey", keys: "F14" })).ok).toBe(true);
        runner.cancel();
        expect(await running).toEqual({ ok: false, message: "Action stopped." });
        expect(send).toHaveBeenCalledWith("F14");
        expect(send).not.toHaveBeenCalledWith("F13");
    });
});
describe("the keystroke helper", () => {
    const withKey = (action: DeckConfig["pages"][number]["keys"][string]["action"]) => {
        const config = createConfig();
        config.pages[0]!.keys = {
            0: { label: "", icon: "Keyboard", color: "#ffffff", behavior: "normal", action },
        };
        return config;
    };

    it("starts before the first press where a key sends a hotkey, in a macro too", () => {
        start.mockClear();
        new ActionRunner().prepare(withKey({ kind: "website", url: "https://example.com" }));
        expect(start).not.toHaveBeenCalled();
        new ActionRunner().prepare(
            withKey({
                kind: "macro",
                steps: [
                    { kind: "delay", ms: 50 },
                    { kind: "hotkey", keys: "F13" },
                ],
            }),
        );
        expect(start).toHaveBeenCalledTimes(1);
    });

    it("stays up when running actions are stopped, and stops when Decky quits", () => {
        stop.mockClear();
        const runner = new ActionRunner();
        runner.cancel();
        expect(stop).not.toHaveBeenCalled();
        runner.stop();
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
