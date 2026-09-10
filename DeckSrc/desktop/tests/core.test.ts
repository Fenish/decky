import { describe, expect, it } from "vitest";
import { createConfig, validateConfig } from "../src/shared/config";
import { crc32, parseEvent, parseIdentity } from "../src/main/device/serial";
import { toSendKeys } from "../src/main/actions/hotkeys";
import { loadConfig, saveConfig } from "../src/main/config/store";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("configuration safety and navigation", () => {
    it("accepts a new workspace", () => expect(() => validateConfig(createConfig())).not.toThrow());
    it("rejects unsafe URLs and incomplete actions", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            label: "Web",
            icon: "website",
            color: "#ffffff",
            action: { kind: "website", url: "javascript:alert(1)" },
        };
        expect(() => validateConfig(c)).toThrow();
        c.pages[0]!.keys[0]!.action = { kind: "macro", steps: [] };
        expect(() => validateConfig(c)).toThrow();
    });
    it("reserves Back and rejects circular parentage", () => {
        const c = createConfig();
        c.pages.push({
            id: "obs",
            name: "OBS",
            parentId: "home",
            keys: {
                10: {
                    label: "Mic",
                    icon: "mic",
                    color: "#ffffff",
                    action: { kind: "hotkey", keys: "F13" },
                },
            },
        });
        expect(() => validateConfig(c)).toThrow(/Back/);
        c.pages[1]!.keys = {};
        c.pages[1]!.parentId = "obs";
        expect(() => validateConfig(c)).toThrow();
    });
    it("rejects missing destinations and invalid cell addresses", () => {
        const c = createConfig();
        c.pages[0]!.keys[15] = {
            label: "Page",
            icon: "page",
            color: "#ffffff",
            action: { kind: "page", pageId: "missing" },
        };
        expect(() => validateConfig(c)).toThrow();
    });
    it("rejects external artwork and shell targets", () => {
        const c = createConfig();
        c.pages[0]!.keys[0] = {
            label: "Program",
            icon: "program",
            color: "#ffffff",
            action: { kind: "program", path: "calc.exe & bad.exe" },
        };
        expect(() => validateConfig(c)).toThrow();
    });
});
describe("wire protocol", () => {
    it("matches the standard CRC32 test vector", () =>
        expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926));
    it("accepts old and new device names and rejects impossible geometry", () => {
        const line = "OK id decky 2 a4cb8fcdd274 cells=15 cols=5 rows=3 w=118 h=123 pages=64";
        expect(parseIdentity(line, "COM5")?.protocol).toBe(2);
        expect(
            parseIdentity(line.replace("decky 2", "decky 3") + " cache=8", "COM5"),
        ).toMatchObject({ protocol: 3, cacheSlots: 8 });
        expect(parseIdentity(line.replace("decky 2", "streamdeck 1"), "COM5")?.protocol).toBe(1);
        expect(parseIdentity(line.replace("cells=15", "cells=100"), "COM5")).toBeNull();
    });
    it("separates key edges from replies and rejects out-of-range keys", () => {
        expect(parseEvent("EV 3 10 DOWN")).toMatchObject({
            kind: "key",
            page: 3,
            cell: 10,
            down: true,
        });
        expect(parseEvent("OK image")).toBeNull();
        expect(parseEvent("BOOT decky 3")).toMatchObject({ kind: "reset" });
        expect(parseEvent("EV 0 99 DOWN")).toBeNull();
    });
});
describe("hotkeys", () => {
    it("encodes modifiers without permitting helper injection", () => {
        expect(toSendKeys("Ctrl+Shift+M")).toBe("^+m");
        expect(toSendKeys("Alt+F24")).toBe("%{F24}");
        expect(toSendKeys("Win+R")).toBeNull();
        expect(toSendKeys("Ctrl+ArrowLeft")).toBe("^{LEFT}");
        expect(toSendKeys("F25")).toBeNull();
        expect(toSendKeys("Ctrl+M\nStart-Process calc")).toBeNull();
    });
});
describe("durable settings", () => {
    it("saves atomically and migrates existing shortcuts", async () => {
        const dir = await mkdtemp(join(tmpdir(), "decky-test-"));
        try {
            const path = join(dir, "decky.json");
            const legacy = join(dir, "bindings.json");
            await writeFile(
                legacy,
                JSON.stringify({ "0:1": { label: "Mute", kind: "shortcut", hotkey: "F13" } }),
            );
            const c = await loadConfig(path, legacy);
            expect(c.pages[0]!.keys[1]!.action).toEqual({ kind: "hotkey", keys: "F13" });
            await saveConfig(path, c);
            expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
            expect(await readdir(dir)).not.toContain("decky.json.tmp");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it("preserves corrupt settings instead of silently replacing them", async () => {
        const dir = await mkdtemp(join(tmpdir(), "decky-test-"));
        try {
            const path = join(dir, "decky.json");
            await writeFile(path, "broken");
            await expect(loadConfig(path, "missing")).rejects.toThrow(/recovery/);
            expect((await readdir(dir)).some((name) => name.includes("recovery"))).toBe(true);
            expect(await readFile(path, "utf8")).toBe("broken");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
