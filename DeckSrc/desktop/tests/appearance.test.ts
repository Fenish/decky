import { describe, expect, it } from "vitest";
import { appearanceOf, createConfig, validateConfig } from "../src/shared/config";
describe("optional labels and key backgrounds", () => {
    it("accepts blank labels and independent normal/toggled backgrounds", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            label: "",
            icon: "mic",
            color: "#ffffff",
            background: "#203040",
            artwork: {
                source: "data:image/png;base64,AAAA",
                zoom: 0.5,
                x: 0,
                y: 0,
                rotation: 0,
                brightness: 1,
            },
            behavior: "toggle",
            action: { kind: "hotkey", keys: "F13" },
            activeAppearance: { label: "", icon: "mic", color: "#ffffff", background: "#804020" },
        };
        expect(() => validateConfig(c)).not.toThrow();
        expect(appearanceOf(c.pages[0]!.keys[0]!, false).artwork?.zoom).toBe(0.5);
        expect(appearanceOf(c.pages[0]!.keys[0]!, false).background).toBe("#203040");
        expect(appearanceOf(c.pages[0]!.keys[0]!, true).background).toBe("#804020");
    });
    it("rejects malformed background colors and control characters in labels", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            label: "",
            icon: "mic",
            color: "#ffffff",
            background: "url(https://bad.example)",
            action: { kind: "hotkey", keys: "F13" },
        };
        expect(() => validateConfig(c)).toThrow(/background/);
        c.pages[0]!.keys[0]!.background = "#000000";
        c.pages[0]!.keys[0]!.label = "bad\nlabel";
        expect(() => validateConfig(c)).toThrow();
    });
});
