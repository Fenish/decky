import { describe, expect, it, vi } from "vitest";
const { openExternal, send } = vi.hoisted(() => ({
    openExternal: vi.fn(async () => {}),
    send: vi.fn(() => null),
}));
vi.mock("electron", () => ({ shell: { openExternal } }));
vi.mock("../src/main/actions/hotkeys", () => ({
    HotkeySender: class {
        send = send;
        stop = vi.fn();
    },
}));
import { ActionRunner } from "../src/main/actions/runner";
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
