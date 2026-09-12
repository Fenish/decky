/*---------------------------------------------------------------
 * The profiles on this PC: the list, their folders, and what happens to the
 * one setup a Decky before this one kept.
 *--------------------------------------------------------------*/

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Profiles, profileName, PROFILES_MAX } from "../src/main/profile/profiles";

let folder = "";

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "decky-profiles-"));
});
afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

const read = (path: string) => readFile(path, "utf8");

describe("the profiles on this PC", () => {
    it("takes the one setup a Decky before this one kept as the first profile", async () => {
        await writeFile(join(folder, "decky.json"), '{"pages":[]}', "utf8");
        await writeFile(join(folder, "widgets.json"), '{"home:1":{"value":7}}', "utf8");
        await mkdir(join(folder, "integrations"), { recursive: true });
        await writeFile(join(folder, "integrations", "obs.json"), '{"address":"here"}', "utf8");
        const profiles = new Profiles(folder);
        await profiles.load();
        expect(profiles.active).toMatchObject({ id: "default", name: "Default" });
        expect(await read(profiles.configPath())).toBe('{"pages":[]}');
        expect(await read(profiles.widgetsPath())).toBe('{"home:1":{"value":7}}');
        expect(await read(profiles.integrationPath("obs"))).toBe('{"address":"here"}');
        // The old files stay where they are, so an older Decky still opens them.
        expect(existsSync(join(folder, "decky.json"))).toBe(true);
    });

    it("starts a profile of its own on a PC with nothing to adopt", async () => {
        const profiles = new Profiles(folder);
        await profiles.load();
        expect(profiles.all()).toHaveLength(1);
        expect(existsSync(join(profiles.folderOf(), "integrations"))).toBe(true);
        expect(existsSync(profiles.configPath())).toBe(false);
    });

    it("adds, renames, switches and forgets", async () => {
        const profiles = new Profiles(folder);
        await profiles.load();
        const work = await profiles.add("Work");
        await profiles.add("Stream");
        expect(profiles.all().map((item) => item.name)).toContain("Work");
        // Each has a folder of its own, and its own files inside it.
        expect(profiles.configPath(work.id)).not.toBe(profiles.configPath("default"));
        await profiles.rename(work.id, "  Work   setup  ");
        expect(profiles.all().find((item) => item.id === work.id)?.name).toBe("Work setup");
        // The one in use is the newest used, so the list opens where you left off.
        await profiles.use(work.id);
        expect(profiles.active.id).toBe(work.id);
        expect(profiles.all()[0]!.id).toBe(work.id);
        // What is in use cannot be forgotten, nor the last one left.
        await expect(profiles.remove(work.id)).rejects.toThrow(/Switch to another/);
        await profiles.use("default");
        await profiles.remove(work.id);
        expect(profiles.has(work.id)).toBe(false);
        expect(existsSync(profiles.folderOf(work.id))).toBe(false);
    });

    it("reads the list back as it was, and keeps its own counsel about nonsense", async () => {
        const profiles = new Profiles(folder);
        await profiles.load();
        const work = await profiles.add("Work");
        await profiles.use(work.id);
        const again = new Profiles(folder);
        await again.load();
        expect(again.active.id).toBe(work.id);
        expect(again.all()).toHaveLength(2);
        // A list that is not one, or names a profile that is not there.
        await writeFile(join(folder, "profiles.json"), '{"active":"gone","profiles":[]}', "utf8");
        const third = new Profiles(folder);
        await third.load();
        expect(third.all()).toHaveLength(1);
        await writeFile(
            join(folder, "profiles.json"),
            JSON.stringify({ active: "gone", profiles: [{ id: "kept", name: "Kept" }] }),
            "utf8",
        );
        const fourth = new Profiles(folder);
        await fourth.load();
        expect(fourth.active.id).toBe("kept");
    });

    it("keeps only so many", async () => {
        const profiles = new Profiles(folder);
        await profiles.load();
        for (let i = 1; i < PROFILES_MAX; i++) await profiles.add(`Profile ${i}`);
        await expect(profiles.add("One too many")).rejects.toThrow(/up to/);
    });

    it("takes a name a person can read", () => {
        expect(profileName("  Work   setup ")).toBe("Work setup");
        expect(profileName("")).toBe("Profile");
        expect(profileName(42, "Fallback")).toBe("Fallback");
        expect(profileName("x".repeat(80))).toHaveLength(40);
    });
});
