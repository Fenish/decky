import { describe, expect, it } from "vitest";
import { duplicateKey, moveKey } from "../src/shared/key-layout";
import { createConfig } from "../src/shared/config";
import { KeyStateStore } from "../src/main/actions/key-state";
import { hotkeyPool } from "../src/shared/hotkey-pool";
const key = {
    label: "",
    icon: "Mic",
    color: "#ffffff",
    background: "#203040",
    behavior: "toggle" as const,
    action: { kind: "hotkey" as const, keys: "F13" },
};
describe("key duplication and moving", () => {
    it("duplicates all settings into the next empty slot without sharing mutable objects", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = structuredClone(key);
        const copy = duplicateKey(c, { pageId: "home", cell: 0 });
        expect(copy.cell).toBe(1);
        expect(copy.key).toEqual(key);
        expect(copy.key).not.toBe(c.pages[0]!.keys[0]);
        expect(c.pages[0]!.keys[1]).toBeUndefined();
    });
    it("gives a duplicated auto-assigned hotkey its own free key", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            ...structuredClone(key),
            action: { kind: "hotkey", keys: "F13", auto: true },
        };
        c.pages[0]!.keys[5] = {
            ...structuredClone(key),
            action: { kind: "hotkey", keys: "F14", auto: true },
        };
        const copy = duplicateKey(c, { pageId: "home", cell: 0 });
        // F13 is the original's and F14 is taken by another key, so F15.
        expect(copy.key.action).toEqual({ kind: "hotkey", keys: "F15", auto: true });
        expect(copy.config.pages[0]!.keys[0]!.action).toEqual({
            kind: "hotkey",
            keys: "F13",
            auto: true,
        });
    });
    it("reassigns every auto step in a duplicated macro, and keeps hand-set keys", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            ...structuredClone(key),
            action: {
                kind: "macro",
                steps: [
                    { kind: "hotkey", keys: "F13", auto: true },
                    { kind: "hotkey", keys: "Ctrl+Shift+M", auto: false },
                    { kind: "hotkey", keys: "F14", auto: true },
                ],
            },
        };
        const copy = duplicateKey(c, { pageId: "home", cell: 0 });
        expect(copy.key.action).toEqual({
            kind: "macro",
            steps: [
                { kind: "hotkey", keys: "F15", auto: true },
                { kind: "hotkey", keys: "Ctrl+Shift+M", auto: false },
                { kind: "hotkey", keys: "F16", auto: true },
            ],
        });
    });
    it("refuses to duplicate an auto hotkey once every automatic key is taken", () => {
        const c = createConfig();
        c.pages.push({ id: "full", name: "Full", parentId: "home", keys: {} });
        // 96 auto keys spread over pages, then one more to copy.
        const pool = hotkeyPool();
        pool.forEach((hotkey, i) => {
            const pageId = `p${Math.floor(i / 14)}`;
            if (!c.pages.some((p) => p.id === pageId))
                c.pages.push({ id: pageId, name: pageId, parentId: "home", keys: {} });
            c.pages.find((p) => p.id === pageId)!.keys[i % 14 === 10 ? 14 : i % 14] = {
                ...structuredClone(key),
                action: { kind: "hotkey", keys: hotkey, auto: true },
            };
        });
        c.pages.find((p) => p.id === "full")!.keys[0] = {
            ...structuredClone(key),
            action: { kind: "hotkey", keys: "F13", auto: true },
        };
        expect(() => duplicateKey(c, { pageId: "full", cell: 0 })).toThrow(/automatic keys/);
    });
    it("moves into empty slots and swaps occupied keys without losing either", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = structuredClone(key);
        c.pages[0]!.keys[1] = { ...key, label: "Second" };
        const moved = moveKey(c, { pageId: "home", cell: 0 }, { pageId: "home", cell: 3 });
        expect(moved.config.pages[0]!.keys[0]).toBeUndefined();
        expect(moved.config.pages[0]!.keys[3]).toEqual(key);
        const swapped = moveKey(c, { pageId: "home", cell: 0 }, { pageId: "home", cell: 1 });
        expect(swapped.swapped).toBe(true);
        expect(swapped.config.pages[0]!.keys[0]!.label).toBe("Second");
        expect(swapped.config.pages[0]!.keys[1]!.label).toBe("");
    });
    it("protects the Back cell and reports full pages", () => {
        const c = createConfig();
        c.pages.push({
            id: "obs",
            name: "OBS",
            parentId: "home",
            keys: { 0: structuredClone(key) },
        });
        expect(() => moveKey(c, { pageId: "obs", cell: 0 }, { pageId: "obs", cell: 10 })).toThrow(
            /Back/,
        );
        c.pages[0]!.keys = Object.fromEntries(
            Array.from({ length: 15 }, (_, cell) => [cell, structuredClone(key)]),
        );
        expect(() => duplicateKey(c, { pageId: "home", cell: 0 })).toThrow(/full/);
    });
    it("moves toggle state with the original key", () => {
        const states = new KeyStateStore();
        states.complete("home", 0, key, true);
        const snapshot = states.snapshot();
        states.move(snapshot, { pageId: "home", cell: 0 }, { pageId: "home", cell: 2 }, false);
        expect(states.snapshot()["home:2"]).toBe(true);
        expect(states.snapshot()["home:0"]).toBeUndefined();
    });
});
