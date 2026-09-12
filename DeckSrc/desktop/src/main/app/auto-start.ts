/*---------------------------------------------------------------
 * Starting Decky with Windows. Settings' switch turns it on, and Windows is
 * asked what it is - Decky keeps no setting of its own, so a login item
 * removed elsewhere (Task Manager's Startup tab) is simply off here too.
 *
 * A Decky started that way waits in the tray: the deck comes up and the keys
 * work, without a window in the face of someone who has just logged in.
 *
 * It is on to begin with - a deck that only works once its app is opened by
 * hand is not much of a deck - and turning it off is remembered, so it is
 * never turned back on behind your back.
 *--------------------------------------------------------------*/

import { app } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The argument a login start carries, and what it means: no window yet. */
export const HIDDEN = "--hidden";

/** Whether this Decky was started by Windows at login. */
export function startedHidden(argv: readonly string[]): boolean {
    return argv.includes(HIDDEN);
}

/**
 * Whether Decky starts with Windows. Only a packaged Decky can say yes: a
 * development one would put the path of an Electron in node_modules into the
 * registry, which is nobody's idea of a login item.
 */
export function autoStart(): { on: boolean; available: boolean } {
    const available = app.isPackaged && process.platform === "win32";
    if (!available) return { on: false, available };
    return { on: app.getLoginItemSettings({ args: [HIDDEN] }).openAtLogin, available: true };
}

/** Turn it on or off, and say how it stands afterwards. */
export function setAutoStart(on: unknown): { on: boolean; available: boolean } {
    if (!autoStart().available) throw new Error("An installed Decky can start with Windows.");
    app.setLoginItemSettings({ openAtLogin: on === true, args: [HIDDEN] });
    return autoStart();
}

/** Where the first choice is remembered, so it is made only once. */
const MARK = "startup.json";

/**
 * The first time an installed Decky runs, it starts with Windows. After that
 * whatever it is set to stands, whether it was changed here or in Windows'
 * own startup list.
 */
export async function startWithWindowsAtFirst(folder: string): Promise<void> {
    if (!autoStart().available) return;
    const mark = join(folder, MARK);
    try {
        await readFile(mark, "utf8");
        return; // The choice has been made once already.
    } catch {
        // Never run installed before.
    }
    try {
        app.setLoginItemSettings({ openAtLogin: true, args: [HIDDEN] });
    } finally {
        await writeFile(mark, JSON.stringify({ chosen: true }), "utf8").catch(() => {});
    }
}
