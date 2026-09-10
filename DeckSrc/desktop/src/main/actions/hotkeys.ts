/*---------------------------------------------------------------
 * Typing on the user's behalf.
 *
 * A deck key does not send a keystroke itself - it cannot, because the board's
 * USB pins carry the touch controller and it reaches the PC as a serial port,
 * never as a keyboard. So the keystroke is produced here instead, which is also
 * where the ceiling disappears: there is no F13-to-F24 limit on this side.
 *
 * Discord, OBS and the rest register *global* hotkeys through a low-level
 * keyboard hook, and that hook sees synthesised input just as it sees a real
 * key. So the target application does not have to be focused - which is the
 * whole point of a deck.
 *--------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * A key combination as the user described it, e.g. "Ctrl+Shift+M".
 *
 * Stored in this readable form rather than pre-translated, so that what is in
 * the settings file is the same thing the user typed into Discord.
 */
export type Hotkey = string;

/**
 * The helper, as one line of PowerShell.
 *
 * Kept inline rather than shipped as a .ps1 so there is no file to lose during
 * packaging, and no execution policy to argue with. It loads the assembly once
 * and then sends one combination per line it is given - a new process per press
 * would cost about half a second, against 38 ms this way.
 */
const HELPER_SCRIPT = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "while ($true) {",
    "  $line = [Console]::In.ReadLine();",
    "  if ($null -eq $line) { break }",
    "  if ($line.Length -gt 0) {",
    "    try { [System.Windows.Forms.SendKeys]::SendWait($line) } catch { }",
    "  }",
    "}",
].join(" ");

/** Names this accepts for keys that are not a single character. */
const NAMED_KEYS = new Map<string, string>([
    ["enter", "ENTER"],
    ["return", "ENTER"],
    ["tab", "TAB"],
    ["escape", "ESC"],
    ["esc", "ESC"],
    ["space", " "],
    ["backspace", "BACKSPACE"],
    ["delete", "DEL"],
    ["insert", "INSERT"],
    ["home", "HOME"],
    ["end", "END"],
    ["pageup", "PGUP"],
    ["pagedown", "PGDN"],
    ["up", "UP"],
    ["arrowup", "UP"],
    ["arrowdown", "DOWN"],
    ["arrowleft", "LEFT"],
    ["arrowright", "RIGHT"],
    ["down", "DOWN"],
    ["left", "LEFT"],
    ["right", "RIGHT"],
]);

/** Characters SendKeys reads as syntax, so a literal one has to be braced. */
const NEEDS_BRACES = new Set(["+", "^", "%", "~", "(", ")", "{", "}", "[", "]"]);

/**
 * Translate a readable combination into SendKeys' notation.
 *
 * Returns null for anything it cannot express, rather than sending the wrong
 * keystroke - a silently wrong hotkey is worse than one that refuses to be
 * saved, because it would be blamed on the deck.
 */
export function toSendKeys(hotkey: Hotkey): string | null {
    const parts = hotkey
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0);

    if (parts.length === 0) {
        return null;
    }

    let prefix = "";
    const modifiers = new Set<string>();

    while (parts.length > 1) {
        const part = parts[0]!;
        if (part === "ctrl" || part === "control") {
            modifiers.add("^");
        } else if (part === "shift") {
            modifiers.add("+");
        } else if (part === "alt") {
            modifiers.add("%");
        } else if (part === "win" || part === "meta" || part === "cmd") {
            // SendKeys has no notation for the Windows key at all. Saying so is
            // better than dropping it and sending the combination without it.
            return null;
        } else {
            break;
        }
        parts.shift();
    }

    // Order is irrelevant to SendKeys but fixed here so the same hotkey always
    // produces the same string, which makes it comparable in tests and logs.
    for (const symbol of ["^", "%", "+"]) {
        if (modifiers.has(symbol)) {
            prefix += symbol;
        }
    }

    if (parts.length !== 1) {
        return null;
    }
    const key = parts[0]!;

    const named = NAMED_KEYS.get(key);
    if (named !== undefined) {
        return `${prefix}{${named}}`;
    }

    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) {
        return `${prefix}{${key.toUpperCase()}}`;
    }

    if (key.length === 1) {
        return NEEDS_BRACES.has(key) ? `${prefix}{${key}}` : `${prefix}${key}`;
    }

    return null;
}

/**
 * Sends key combinations, through one helper process that stays running.
 */
export class HotkeySender {
    private helper: ChildProcessWithoutNullStreams | null = null;

    /** Whether this platform can synthesise keystrokes at all. */
    static get supported(): boolean {
        return process.platform === "win32";
    }

    /**
     * Send one combination.
     *
     * @returns An error message, or null when it went out.
     */
    send(hotkey: Hotkey): string | null {
        if (!HotkeySender.supported) {
            return "sending keystrokes is only implemented on Windows";
        }

        const encoded = toSendKeys(hotkey);
        if (encoded === null) {
            return `"${hotkey}" is not a combination this can send`;
        }

        const helper = this.ensureHelper();
        if (helper === null) {
            return "could not start the keystroke helper";
        }

        try {
            helper.stdin.write(`${encoded}\n`);
            return null;
        } catch {
            // A helper that has died takes the next press with it; drop it so
            // the one after that starts a fresh one.
            this.helper = null;
            return "the keystroke helper stopped";
        }
    }

    /** Shut the helper down. Safe to call when it was never started. */
    stop(): void {
        this.helper?.stdin.end();
        this.helper?.kill();
        this.helper = null;
    }

    private ensureHelper(): ChildProcessWithoutNullStreams | null {
        if (this.helper !== null && this.helper.exitCode === null && !this.helper.killed) {
            return this.helper;
        }

        try {
            const helper = spawn(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-Command", HELPER_SCRIPT],
                { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
            );

            helper.on("error", () => {
                if (this.helper === helper) this.helper = null;
            });
            helper.stdin.on("error", () => {
                if (this.helper === helper) this.helper = null;
            });
            helper.on("exit", () => {
                if (this.helper === helper) {
                    this.helper = null;
                }
            });
            // Nothing reads these, and an unread pipe eventually blocks the
            // child once its buffer fills.
            helper.stdout.resume();
            helper.stderr.resume();

            this.helper = helper;
            return helper;
        } catch {
            this.helper = null;
            return null;
        }
    }
}
