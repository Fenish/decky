/*---------------------------------------------------------------
 * OBS Studio on this PC: whether it is installed, whether it runs, and
 * starting it - what an OBS key says when Decky cannot reach OBS (not found,
 * closed, or open with its WebSocket server off), and what "Open OBS" does.
 *--------------------------------------------------------------*/

import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import { listPrograms } from "../../programs/catalog";

const run = promisify(execFile);

export interface ObsFinder {
    installed(): Promise<boolean>;
    running(): Promise<boolean>;
    /** Start the copy of OBS found; false when there is none. */
    launch(): Promise<boolean>;
}

/** A registry key's default value, in the 64- or 32-bit view; null without the key. */
async function registryValue(key: string, view: "64" | "32"): Promise<string | null> {
    try {
        const { stdout } = await run("reg", ["query", key, "/ve", `/reg:${view}`], {
            windowsHide: true,
        });
        return /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(stdout)?.[1] ?? "";
    } catch {
        return null;
    }
}

/** OBS started from its own folder, which it needs to find its files. */
async function startProgram(path: string): Promise<void> {
    await access(path);
    spawn(path, [], { cwd: dirname(path), detached: true, stdio: "ignore" }).unref();
}

/**
 * The ways OBS can be on this PC, most usual first: how to find that copy
 * (what `start` takes), and how to start it.
 */
const COPIES: { find: () => Promise<string | null>; start: (found: string) => Promise<void> }[] = [
    // OBS's own installer, which names its folder.
    {
        find: async () => {
            const folder = await registryValue("HKLM\\SOFTWARE\\OBS Studio", "64");
            return folder ? join(folder, "bin", "64bit", "obs64.exe") : null;
        },
        start: startProgram,
    },
    // OBS from Steam (app 1905180), which Steam registers in the 32-bit view.
    {
        find: async () =>
            (await registryValue(
                "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1905180",
                "32",
            )) === null
                ? null
                : "steam://rungameid/1905180",
        start: (url) => shell.openExternal(url),
    },
    // A Start Menu shortcut or App Paths entry for it (the program picker's list).
    {
        find: async () =>
            (await listPrograms()).find((program) => /\\obs64\.exe$/i.test(program.path))?.path ??
            null,
        start: startProgram,
    },
];

export const OBS_FINDER: ObsFinder = {
    async installed() {
        for (const copy of COPIES) if (await copy.find().catch(() => null)) return true;
        // A copy that runs from a folder (portable) is on the PC too.
        return OBS_FINDER.running();
    },
    async running() {
        try {
            const { stdout } = await run(
                "tasklist",
                ["/FI", "IMAGENAME eq obs64.exe", "/NH", "/FO", "CSV"],
                { windowsHide: true },
            );
            return /"obs64\.exe"/i.test(stdout);
        } catch {
            return false;
        }
    },
    async launch() {
        for (const copy of COPIES) {
            const found = await copy.find().catch(() => null);
            if (!found) continue;
            try {
                await copy.start(found);
                return true;
            } catch {
                // This copy is gone; another may be there.
            }
        }
        return false;
    },
};
