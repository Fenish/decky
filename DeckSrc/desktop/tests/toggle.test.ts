import { describe, expect, it } from "vitest";
import { KeyStateStore } from "../src/main/actions/key-state";
import { appearanceOf, createConfig, displayedKey, validateConfig } from "../src/shared/config";
import type { KeyConfig } from "../src/shared/config";
const toggle: KeyConfig = {
    label: "Mic",
    icon: "mic",
    color: "#ffffff",
    action: { kind: "hotkey", keys: "F13" },
    behavior: "toggle",
    activeAppearance: { label: "Muted", icon: "mic", color: "#ff9d81" },
};
describe("normal and toggle buttons", () => {
    it("only toggles on successful actions and returns to OFF on the next press", () => {
        const states = new KeyStateStore();
        expect(states.complete("home", 0, toggle, false)).toBe(false);
        expect(states.snapshot()).toEqual({});
        states.complete("home", 0, toggle, true);
        expect(states.snapshot()["home:0"]).toBe(true);
        states.complete("home", 0, toggle, true);
        expect(states.snapshot()["home:0"]).toBe(false);
        expect(states.complete("home", 1, { ...toggle, behavior: "normal" }, true)).toBe(false);
    });
    it("uses independent ON artwork without inheriting an OFF image", () => {
        const key = {
            ...toggle,
            artwork: {
                source: "data:image/png;base64,AAAA",
                zoom: 1,
                x: 0,
                y: 0,
                rotation: 0,
                brightness: 1,
            },
        };
        expect(appearanceOf(key, true).label).toBe("Muted");
        expect(displayedKey(key, true)?.artwork).toBeUndefined();
        expect(displayedKey(key, false)?.artwork).toBe(key.artwork);
    });
    it("keeps state when artwork changes, resets it when the action changes", () => {
        const before = createConfig();
        before.pages[0]!.keys[0] = toggle;
        const states = new KeyStateStore();
        states.complete("home", 0, toggle, true);
        const after = structuredClone(before);
        after.pages[0]!.keys[0]!.color = "#aabbcc";
        states.reconcile(before, after);
        expect(states.snapshot()["home:0"]).toBe(true);
        after.pages[0]!.keys[0]!.action = { kind: "hotkey", keys: "F14" };
        states.reconcile(before, after);
        expect(states.snapshot()["home:0"]).toBeUndefined();
    });
    it("validates both appearances and disallows toggle navigation", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = structuredClone(toggle);
        expect(() => validateConfig(c)).not.toThrow();
        c.pages[0]!.keys[0]!.activeAppearance!.color = "invalid";
        expect(() => validateConfig(c)).toThrow();
        c.pages[0]!.keys[0] = { ...toggle, action: { kind: "page", pageId: "home" } };
        expect(() => validateConfig(c)).toThrow(/normal/);
    });
});
