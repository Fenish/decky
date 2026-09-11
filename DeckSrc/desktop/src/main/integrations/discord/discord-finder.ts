/*---------------------------------------------------------------
 * Discord on this PC: whether it is installed (Stable, PTB or Canary, each
 * in its own folder under %LOCALAPPDATA%), whether it runs, and starting it
 * - through its own Update.exe, as its shortcuts do.
 *--------------------------------------------------------------*/

import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface DiscordFinder {
    installed(): Promise<boolean>;
    running(): Promise<boolean>;
    /** Start the first Discord found; false when there is none. */
    launch(): Promise<boolean>;
}

/** Each Discord a PC can have: its folder under %LOCALAPPDATA%, and its program. */
const EDITIONS = [
    { folder: "Discord", program: "Discord.exe" },
    { folder: "DiscordPTB", program: "DiscordPTB.exe" },
    { folder: "DiscordCanary", program: "DiscordCanary.exe" },
];

const updater = (folder: string): string =>
    join(process.env.LOCALAPPDATA ?? "", folder, "Update.exe");

async function found(): Promise<(typeof EDITIONS)[number] | null> {
    for (const edition of EDITIONS) {
        try {
            await access(updater(edition.folder));
            return edition;
        } catch {
            // Not this one.
        }
    }
    return null;
}

export const DISCORD_FINDER: DiscordFinder = {
    installed: async () => (await found()) !== null,
    async running() {
        try {
            const { stdout } = await run("tasklist", ["/NH", "/FO", "CSV"], { windowsHide: true });
            return EDITIONS.some((edition) => stdout.includes(`"${edition.program}"`));
        } catch {
            return false;
        }
    },
    async launch() {
        const edition = await found();
        if (!edition) return false;
        // Started while it runs, Discord comes up as it was left.
        spawn(updater(edition.folder), ["--processStart", edition.program], {
            detached: true,
            stdio: "ignore",
        })
            .on("error", () => {})
            .unref();
        return true;
    },
};
