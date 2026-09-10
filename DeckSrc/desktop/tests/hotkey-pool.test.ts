import { describe, expect, it } from "vitest";
import { createConfig, validateConfig, type Action } from "../src/shared/config";
import {
    hotkeyPool,
    hotkeysInUse,
    inPool,
    nextFreeHotkey,
    normalizeHotkey,
} from "../src/shared/hotkey-pool";
import { toSendKeys } from "../src/main/actions/hotkeys";
import { defaultStep } from "../src/renderer/src/features/editor/actions";

const key = (action: Action) => ({ label: "", icon: "keyboard", color: "#ffffff", action });

describe("auto-assigned hotkeys", () => {
    it("offers 96 distinct combinations, fewest modifiers first", () => {
        const pool = hotkeyPool();
        expect(pool).toHaveLength(96);
        expect(new Set(pool.map(normalizeHotkey)).size).toBe(96);
        expect(pool.slice(0, 3)).toEqual(["F13", "F14", "F15"]);
        expect(pool[12]).toBe("Ctrl+F13");
        expect(pool[95]).toBe("Ctrl+Alt+Shift+F24");
    });

    it("only offers combinations the sender can actually type", () => {
        expect(hotkeyPool().filter((hotkey) => toSendKeys(hotkey) === null)).toEqual([]);
    });

    it("skips taken combinations regardless of case or modifier order", () => {
        expect(nextFreeHotkey([])).toBe("F13");
        expect(nextFreeHotkey(["f13", "F14"])).toBe("F15");
        expect(nextFreeHotkey([...hotkeyPool().slice(0, 12), "shift+ctrl+f13"])).toBe("Ctrl+F13");
        expect(nextFreeHotkey(hotkeyPool())).toBeNull();
    });

    it("recognises pool members however they are written", () => {
        expect(inPool("shift+ctrl+f13")).toBe(true);
        expect(inPool("Ctrl+Shift+M")).toBe(false);
        expect(inPool("F12")).toBe(false);
    });

    it("counts hotkeys in macros, and treats the edited key's own as free", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = key({ kind: "hotkey", keys: "F13", auto: true });
        c.pages[0]!.keys[1] = key({
            kind: "macro",
            steps: [
                { kind: "hotkey", keys: "F14" },
                { kind: "delay", ms: 500 },
            ],
        });
        expect(hotkeysInUse(c).sort()).toEqual(["F13", "F14"]);
        // Editing key 0: its own F13 must not count, or re-enabling auto-assign
        // would move it to F15 and break whatever the user set up in Discord.
        expect(hotkeysInUse(c, { pageId: "home", cell: 0 })).toEqual(["F14"]);
        expect(nextFreeHotkey(hotkeysInUse(c, { pageId: "home", cell: 0 }))).toBe("F13");
    });

    it("starts a new hotkey step auto-assigned to the next free key", () => {
        expect(defaultStep("hotkey", ["F13"])).toEqual({ kind: "hotkey", keys: "F14", auto: true });
        expect(defaultStep("hotkey", hotkeyPool())).toEqual({
            kind: "hotkey",
            keys: "",
            auto: true,
        });
    });

    it("saves the auto flag, keeps older hotkeys valid, and rejects a bad flag", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = key({ kind: "hotkey", keys: "F13", auto: true });
        c.pages[0]!.keys[1] = key({ kind: "hotkey", keys: "Ctrl+Shift+M" });
        expect(() => validateConfig(c)).not.toThrow();

        (c.pages[0]!.keys[0]!.action as { auto: unknown }).auto = "yes";
        expect(() => validateConfig(c)).toThrow();
    });

    it("refuses to save an auto key once the pool ran out and left it empty", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = key({ kind: "hotkey", keys: "", auto: true });
        expect(() => validateConfig(c)).toThrow();
    });
});
