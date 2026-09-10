import { describe, expect, it } from "vitest";
import { scriptArguments } from "../src/main/actions/scripts";
import { createConfig, validateConfig } from "../src/shared/config";
import { defaultStep } from "../src/renderer/src/features/editor/actions";
describe("script lifecycle settings", () => {
    it("defaults to background execution, waiting and a 30 second timeout", () => {
        expect(defaultStep("script")).toEqual({
            kind: "script",
            path: "",
            background: true,
            wait: true,
            timeoutMs: 30000,
        });
    });
    it("builds visible launchers with safe paths and without waiting for independent scripts", () => {
        const path = "C:\\Tools\\O'Brien\\ssh.ps1";
        const waited = scriptArguments(path, false, true);
        const detached = scriptArguments(path, false, false);
        const waitedText = Buffer.from(waited[3]!, "base64").toString("utf16le");
        const detachedText = Buffer.from(detached[3]!, "base64").toString("utf16le");
        expect(waitedText).toContain("-WindowStyle Normal -Wait");
        expect(waitedText).toContain("O''Brien");
        expect(detachedText).not.toContain("-Wait");
        expect(detachedText).toContain("exit 0");
        expect(scriptArguments(path, true, false)).toEqual([
            "-NoProfile",
            "-NonInteractive",
            "-File",
            path,
        ]);
    });
    it("accepts unlimited or independent scripts and rejects invalid timeouts", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            label: "SSH",
            icon: "Terminal",
            color: "#ffffff",
            action: {
                kind: "script",
                path: "C:\\Tools\\ssh.ps1",
                background: false,
                wait: false,
                timeoutMs: 0,
            },
        };
        expect(() => validateConfig(c)).not.toThrow();
        const action = c.pages[0]!.keys[0]!.action;
        if (action.kind === "script") action.timeoutMs = -1;
        expect(() => validateConfig(c)).toThrow();
    });
});
