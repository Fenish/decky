/*---------------------------------------------------------------
 * The profiles on this PC: several setups, one in use. Each is a folder of
 * its own under profiles/, holding everything that belongs to that setup -
 * its pages, what its widgets have counted, the apps it talks to, and the
 * scripts its keys run:
 *
 *   profiles.json          the list, and which is in use
 *   profiles/<id>/
 *     profile.json         pages and keys
 *     widgets.json         counters, timers, the last dice roll
 *     integrations/        one file per app Decky talks to
 *     files/               scripts a key runs, as an imported profile brought them
 *
 * What belongs to the deck and not to a setup - its Wi-Fi pairing, update
 * state, the window's own settings - stays beside profiles.json, so switching
 * never unpairs anything.
 *--------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A profile as the list knows it. */
export interface ProfileEntry {
    id: string;
    name: string;
    /** When it was made, and when it was last switched to (epoch ms). */
    madeAt: number;
    usedAt: number;
}

interface ProfileList {
    active: string;
    profiles: ProfileEntry[];
}

/** The profile every PC starts with, and what it is called. */
const FIRST = { id: "default", name: "Default" };
/** As many as the window can sensibly list. */
export const PROFILES_MAX = 24;
export const NAME_MAX = 40;

/** A name fit to show: trimmed, one line, and never empty. */
export function profileName(value: unknown, fallback = "Profile"): string {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return text.slice(0, NAME_MAX) || fallback;
}

export class Profiles {
    private list: ProfileList = { active: FIRST.id, profiles: [] };

    /** `folder` is Decky's own folder (userData). */
    constructor(private readonly folder: string) {}

    private get listPath(): string {
        return join(this.folder, "profiles.json");
    }

    /** The profiles there are, the one used most lately first. */
    all(): ProfileEntry[] {
        return [...this.list.profiles].sort((a, b) => b.usedAt - a.usedAt);
    }

    get active(): ProfileEntry {
        return (
            this.list.profiles.find((item) => item.id === this.list.active) ??
            this.list.profiles[0]!
        );
    }

    has(id: string): boolean {
        return this.list.profiles.some((item) => item.id === id);
    }

    /** A profile's folder, and the paths inside it; the one in use by default. */
    folderOf(id = this.active.id): string {
        return join(this.folder, "profiles", id);
    }
    configPath(id?: string): string {
        return join(this.folderOf(id), "profile.json");
    }
    widgetsPath(id?: string): string {
        return join(this.folderOf(id), "widgets.json");
    }
    integrationPath(app: string, id?: string): string {
        return join(this.folderOf(id), "integrations", `${app}.json`);
    }
    /** Where the scripts an imported profile brought live. */
    filesFolder(id?: string): string {
        return join(this.folderOf(id), "files");
    }

    /**
     * Read the list, or make one. A Decky that has only ever had the one
     * profile keeps its files beside profiles.json: they are copied into the
     * first profile's folder and left where they were, so an older build still
     * opens the setup it knows.
     */
    async load(): Promise<void> {
        try {
            const list = readList(JSON.parse(await readFile(this.listPath, "utf8")));
            if (list) {
                this.list = list;
                return;
            }
        } catch {
            // None yet, or not a list: start one below.
        }
        const now = Date.now();
        this.list = { active: FIRST.id, profiles: [{ ...FIRST, madeAt: now, usedAt: now }] };
        await this.adopt(FIRST.id);
        await this.save();
    }

    /** The single profile a Decky before this one kept, as the first profile here. */
    private async adopt(id: string): Promise<void> {
        await mkdir(join(this.folderOf(id), "integrations"), { recursive: true });
        const copy = (from: string, to: string): Promise<void> =>
            copyFile(from, to).catch(() => {});
        await copy(join(this.folder, "decky.json"), this.configPath(id));
        await copy(join(this.folder, "widgets.json"), this.widgetsPath(id));
        const apps = await readdir(join(this.folder, "integrations")).catch(() => []);
        for (const file of apps)
            await copy(
                join(this.folder, "integrations", file),
                join(this.folderOf(id), "integrations", file),
            );
    }

    private async save(): Promise<void> {
        await mkdir(this.folder, { recursive: true });
        const temporary = `${this.listPath}.tmp`;
        await writeFile(temporary, `${JSON.stringify(this.list, null, 2)}\n`, "utf8");
        await rename(temporary, this.listPath);
    }

    /** A profile of its own, with whatever `fill` puts in its folder. */
    async add(name: string, fill?: (folder: string) => Promise<void>): Promise<ProfileEntry> {
        if (this.list.profiles.length >= PROFILES_MAX)
            throw new Error(`Decky keeps up to ${PROFILES_MAX} profiles.`);
        const entry: ProfileEntry = {
            id: randomUUID().slice(0, 8),
            name: profileName(name),
            madeAt: Date.now(),
            usedAt: 0,
        };
        await mkdir(join(this.folderOf(entry.id), "integrations"), { recursive: true });
        await fill?.(this.folderOf(entry.id));
        this.list.profiles.push(entry);
        await this.save();
        return entry;
    }

    async rename(id: string, name: string): Promise<void> {
        const entry = this.list.profiles.find((item) => item.id === id);
        if (!entry) throw new Error("No such profile.");
        entry.name = profileName(name, entry.name);
        await this.save();
    }

    /** Forget a profile and everything in its folder. The last one stays. */
    async remove(id: string): Promise<void> {
        if (this.list.profiles.length < 2) throw new Error("Decky keeps at least one profile.");
        if (id === this.list.active) throw new Error("Switch to another profile first.");
        this.list.profiles = this.list.profiles.filter((item) => item.id !== id);
        await this.save();
        await rm(this.folderOf(id), { recursive: true, force: true }).catch(() => {});
    }

    /** Switch to a profile; the caller loads what its folder holds. */
    async use(id: string): Promise<ProfileEntry> {
        const entry = this.list.profiles.find((item) => item.id === id);
        if (!entry) throw new Error("No such profile.");
        entry.usedAt = Date.now();
        this.list.active = id;
        await this.save();
        return entry;
    }
}

/** The list as it was saved, or null when it is not one. */
function readList(saved: unknown): ProfileList | null {
    if (typeof saved !== "object" || saved === null) return null;
    const { active, profiles } = saved as Record<string, unknown>;
    if (typeof active !== "string" || !Array.isArray(profiles) || !profiles.length) return null;
    const read: ProfileEntry[] = [];
    for (const item of profiles.slice(0, PROFILES_MAX)) {
        if (typeof item !== "object" || item === null) continue;
        const { id, name, madeAt, usedAt } = item as Record<string, unknown>;
        if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,36}$/.test(id)) continue;
        read.push({
            id,
            name: profileName(name),
            madeAt: typeof madeAt === "number" ? madeAt : Date.now(),
            usedAt: typeof usedAt === "number" ? usedAt : 0,
        });
    }
    if (!read.length) return null;
    return {
        active: read.some((item) => item.id === active) ? active : read[0]!.id,
        profiles: read,
    };
}
