/*---------------------------------------------------------------
 * Teaching Windows what a .deckyprofile is: its icon, and that a
 * double-click opens it with this Decky.
 *
 * The installer registers it too (fileAssociations in package.json), so this
 * is what keeps it right afterwards - Decky moved, reinstalled elsewhere, or
 * run as a copy of its folder. Everything goes under HKCU, so it needs no
 * administrator and touches nobody else on the PC; and nothing is written
 * when what is there already points at this Decky.
 *--------------------------------------------------------------*/

import { execFile } from "node:child_process";

/** The file type's name in the registry, and what people see it called. */
const TYPE = "Decky.Profile";
const SHOWN = "Decky profile";
const EXTENSION = ".deckyprofile";
const CLASSES = "HKCU\\Software\\Classes";

/** How the registry is read and written; tests hand their own in. */
export interface Registry {
    read(key: string): Promise<string>;
    write(key: string, value: string): Promise<void>;
}

/** `reg.exe`, which is on every Windows and needs nothing installed. */
export const REG: Registry = {
    read: (key) =>
        new Promise((resolve) => {
            execFile("reg", ["query", key, "/ve"], (error, out) => {
                // A key that is not there reads as nothing to compare against.
                resolve(error ? "" : (/REG_SZ\s+(.*)/.exec(out)?.[1] ?? "").trim());
            });
        }),
    write: (key, value) =>
        new Promise((resolve, reject) => {
            execFile("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"], (error) =>
                error ? reject(error) : resolve(),
            );
        }),
};

/**
 * What every key should say, for this Decky and this icon. `%1` is the file
 * double-clicked, which arrives as an argument (index.ts reads it).
 */
export function profileTypeKeys(exe: string, icon: string): { key: string; value: string }[] {
    return [
        { key: `${CLASSES}\\${EXTENSION}`, value: TYPE },
        { key: `${CLASSES}\\${TYPE}`, value: SHOWN },
        { key: `${CLASSES}\\${TYPE}\\DefaultIcon`, value: icon },
        { key: `${CLASSES}\\${TYPE}\\shell\\open\\command`, value: `"${exe}" "%1"` },
    ];
}

/**
 * Make sure Windows opens a .deckyprofile with this Decky. True when
 * something was written; false when it already said so. Never throws: a
 * registry that will not have it is not a reason for Decky not to start.
 */
export async function registerProfileType(
    exe: string,
    icon: string,
    registry: Registry = REG,
): Promise<boolean> {
    let written = false;
    try {
        for (const { key, value } of profileTypeKeys(exe, icon)) {
            if ((await registry.read(key)) === value) continue;
            await registry.write(key, value);
            written = true;
        }
    } catch {
        return written;
    }
    return written;
}
