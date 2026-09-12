/*---------------------------------------------------------------
 * A profile as one file: what it carries, what it refuses to carry, and what
 * the inspector says is inside before anything is written.
 *--------------------------------------------------------------*/

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfig } from "../src/shared/config";
import type { DeckConfig, KeyConfig } from "../src/shared/config";
import {
    packBundle,
    placeFiles,
    profileFiles,
    readProfileFiles,
    retiredWidgets,
    unpackBundle,
} from "../src/main/profile/bundle";
import type { ProfileBundle } from "../src/main/profile/bundle";
import { reportOf } from "../src/main/profile/report";

let folder = "";
beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "decky-bundle-"));
});
afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

const key = (action: KeyConfig["action"]): KeyConfig => ({
    label: "",
    icon: "Play",
    color: "#eee8da",
    action,
});

/** A profile with a script, a program, a macro and a widget on its keys. */
async function setup(): Promise<{ config: DeckConfig; script: string }> {
    const script = join(folder, "hello.ps1");
    await writeFile(script, "Write-Host hello", "utf8");
    const config = createConfig();
    config.pages[0]!.keys = {
        0: key({ kind: "script", path: script }),
        1: key({ kind: "program", path: "C:\\Windows\\notepad.exe" }),
        2: key({
            kind: "macro",
            steps: [
                { kind: "delay", ms: 100 },
                { kind: "script", path: script },
            ],
        }),
        3: key({
            kind: "widget",
            widget: {
                type: "clock",
                style: "digital",
                hour12: false,
                seconds: false,
                date: false,
                timeZone: "",
            },
        }),
    };
    return { config, script };
}

const bundleOf = (config: DeckConfig, files: ProfileBundle["files"] = []): ProfileBundle => ({
    meta: { name: "Work", madeAt: 1_700_000_000_000, app: "0.2.0" },
    profile: config,
    integrations: { obs: { address: "localhost:4455" }, discord: {} },
    files,
});

describe("what a profile carries", () => {
    it("finds the files its keys use, and knows which travel", async () => {
        const { config, script } = await setup();
        const files = profileFiles(config);
        expect(files).toContainEqual({ path: script, carried: true });
        expect(files).toContainEqual({ path: "C:\\Windows\\notepad.exe", carried: false });
        // The script is named once, though two keys run it.
        expect(files.filter((file) => file.path === script)).toHaveLength(1);
        const read = await readProfileFiles(config);
        expect(read.files).toHaveLength(1);
        expect(Buffer.from(read.files[0]!.body, "base64").toString("utf8")).toBe(
            "Write-Host hello",
        );
        expect(read.missing).toEqual([]);
    });

    it("says which files it could not take, and still travels", async () => {
        const { config } = await setup();
        config.pages[0]!.keys[4] = key({ kind: "script", path: join(folder, "gone.ps1") });
        const read = await readProfileFiles(config);
        expect(read.files).toHaveLength(1);
        expect(read.missing).toEqual([join(folder, "gone.ps1")]);
    });
});

describe("the file itself", () => {
    it("comes back as it went in, and is not readable as text", async () => {
        const { config } = await setup();
        const bundle = bundleOf(config, (await readProfileFiles(config)).files);
        const bytes = packBundle(bundle);
        expect(bytes.subarray(0, 8).toString("ascii")).toBe("DECKYPRF");
        // Nothing of the profile shows through: it is encrypted, not just zipped.
        expect(bytes.toString("latin1")).not.toContain("hello.ps1");
        const back = unpackBundle(bytes);
        expect(back.meta).toEqual(bundle.meta);
        expect(back.profile).toEqual(config);
        expect(back.integrations.obs).toEqual({ address: "localhost:4455" });
        expect(back.files).toHaveLength(1);
    });

    it("refuses what is not one, and what has been meddled with", () => {
        expect(() => unpackBundle(Buffer.from("nonsense at all"))).toThrow(/not a Decky profile/);
        const bytes = packBundle(bundleOf(createConfig()));
        bytes[bytes.length - 1] ^= 0xff;
        expect(() => unpackBundle(bytes)).toThrow(/damaged/);
        const newer = packBundle(bundleOf(createConfig()));
        newer[8] = 9;
        expect(() => unpackBundle(newer)).toThrow(/newer Decky/);
    });

    it("keeps a widget this Decky no longer has out, and counts it", () => {
        const config = createConfig();
        config.pages[0]!.keys = {
            0: key({
                kind: "widget",
                widget: {
                    type: "clock",
                    style: "digital",
                    hour12: false,
                    seconds: false,
                    date: false,
                    timeZone: "",
                },
            }),
        };
        // A profile from a Decky that still had this widget.
        const raw = structuredClone(config) as unknown as DeckConfig;
        (raw.pages[0]!.keys[1] as unknown) = {
            label: "",
            icon: "Play",
            color: "#eee8da",
            action: { kind: "widget", widget: { type: "lava-lamp", colour: "red" } },
        };
        expect(retiredWidgets(raw)).toEqual([{ type: "lava-lamp", count: 1 }]);
        const back = unpackBundle(packBundle(bundleOf(raw)));
        expect(back.retired).toEqual([{ type: "lava-lamp", count: 1 }]);
        expect(Object.keys(back.profile.pages[0]!.keys)).toEqual(["0"]);
        expect(reportOf(back).widgets).toContainEqual({
            type: "lava-lamp",
            label: "lava-lamp",
            count: 1,
            retired: true,
        });
    });
});

describe("bringing one in", () => {
    it("puts its scripts in the profile's own folder and points the keys there", async () => {
        const { config, script } = await setup();
        const bundle = unpackBundle(
            packBundle(bundleOf(config, (await readProfileFiles(config)).files)),
        );
        const files = join(folder, "profiles", "abc", "files");
        const placed = await placeFiles(bundle, files);
        expect(await readdir(files)).toEqual(["hello.ps1"]);
        const kept = join(files, "hello.ps1");
        expect(await readFile(kept, "utf8")).toBe("Write-Host hello");
        // Both the key and the macro's step point at the copy, not at the
        // path it had on the PC it came from.
        const keys = placed.config.pages[0]!.keys;
        expect(keys[0]!.action).toMatchObject({ kind: "script", path: kept });
        expect(keys[2]!.action).toMatchObject({
            kind: "macro",
            steps: [{ kind: "delay" }, { kind: "script", path: kept }],
        });
        // A program is where it is installed: left alone.
        expect(keys[1]!.action).toMatchObject({ path: "C:\\Windows\\notepad.exe" });
        expect(script).not.toBe(kept);
    });

    it("writes nothing outside the folder it was given, whatever it is called", async () => {
        const config = createConfig();
        config.pages[0]!.keys = {
            0: key({ kind: "script", path: "C:\\keys\\one.ps1" }),
            1: key({ kind: "script", path: "D:\\other\\one.ps1" }),
        };
        const bundle: ProfileBundle = bundleOf(config, [
            { path: "C:\\keys\\one.ps1", body: Buffer.from("one").toString("base64") },
            { path: "D:\\other\\one.ps1", body: Buffer.from("two").toString("base64") },
        ]);
        // A name that tries to climb out, and a second file with the same name.
        bundle.files.push({
            path: "..\\..\\escape.ps1",
            body: Buffer.from("nope").toString("base64"),
        });
        const files = join(folder, "files");
        await placeFiles(bundle, files);
        const written = (await readdir(files)).sort();
        expect(written).toEqual(["escape.ps1", "one 2.ps1", "one.ps1"]);
        expect(await readdir(folder)).toEqual(["files"]);
    });
});

describe("what the inspector says", () => {
    it("lists the pages, the widgets, and everything a key would run", async () => {
        const { config, script } = await setup();
        const bundle = bundleOf(config, (await readProfileFiles(config)).files);
        const report = reportOf(bundle);
        expect(report).toMatchObject({ name: "Work", pages: 1, keys: 4, app: "0.2.0" });
        expect(report.widgets).toEqual([
            { type: "clock", label: "Clock", count: 1, retired: false },
        ]);
        expect(report.runs).toContainEqual({ path: script, kind: "script", carried: true });
        expect(report.runs).toContainEqual({
            path: "C:\\Windows\\notepad.exe",
            kind: "program",
            carried: false,
        });
        // The apps it is set up for, and that a password is not in the file.
        expect(report.apps).toContainEqual({
            id: "obs",
            name: "OBS Studio",
            settings: 1,
            secrets: true,
        });
        expect(report.files.count).toBe(1);
    });
});
