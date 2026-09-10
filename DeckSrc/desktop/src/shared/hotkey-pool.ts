import type { Action, DeckConfig } from "./config";
import { keyAddress } from "./config";

/**
 * Every combination auto-assign may hand out, in the order it hands them.
 *
 * Only F13 to F24, because no keyboard has those keys: nothing on the machine
 * can already be using them, so an assigned combination cannot collide with a
 * shortcut the user already relies on. That is 12 keys against 8 modifier
 * states - none, and the seven combinations of Ctrl, Alt and Shift - so 96 in
 * total.
 *
 * Fewest modifiers first, because the user retypes whatever is assigned into
 * Discord or OBS by hand, and "F13" is less to get wrong than
 * "Ctrl+Alt+Shift+F13".
 */
export function hotkeyPool(): string[] {
    const keys = Array.from({ length: 12 }, (_, index) => `F${index + 13}`);
    const modifierSets: string[][] = [
        [],
        ["Ctrl"],
        ["Alt"],
        ["Shift"],
        ["Ctrl", "Alt"],
        ["Ctrl", "Shift"],
        ["Alt", "Shift"],
        ["Ctrl", "Alt", "Shift"],
    ];

    const pool: string[] = [];
    for (const modifiers of modifierSets) {
        for (const key of keys) {
            pool.push([...modifiers, key].join("+"));
        }
    }
    return pool;
}

/**
 * Put a combination in one canonical form, so "shift+ctrl+f13" and "Ctrl+Shift+F13"
 * are recognised as the same keys.
 */
export function normalizeHotkey(hotkey: string): string {
    const parts = hotkey
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0);
    const key = parts.pop() ?? "";
    const modifiers = ["ctrl", "alt", "shift"].filter((m) =>
        parts.some((part) => part === m || (m === "ctrl" && part === "control")),
    );
    return [...modifiers, key].join("+");
}

const POOL = new Set(hotkeyPool().map(normalizeHotkey));

/** Whether a combination is one auto-assign could have produced. */
export function inPool(hotkey: string): boolean {
    return POOL.has(normalizeHotkey(hotkey));
}

/**
 * The first combination in the pool nobody is using.
 *
 * @param taken Combinations already in use anywhere on the deck.
 * @returns A free combination, or null once all 96 are spoken for.
 */
export function nextFreeHotkey(taken: Iterable<string>): string | null {
    const used = new Set<string>();
    for (const hotkey of taken) {
        used.add(normalizeHotkey(hotkey));
    }

    for (const candidate of hotkeyPool()) {
        if (!used.has(normalizeHotkey(candidate))) {
            return candidate;
        }
    }
    return null;
}

/** Every hotkey an action sends, including the steps inside a macro. */
export function hotkeysOf(action: Action): string[] {
    if (action.kind === "hotkey") return [action.keys];
    if (action.kind === "macro")
        return action.steps.flatMap((step) => (step.kind === "hotkey" ? [step.keys] : []));
    return [];
}

/**
 * Every hotkey the deck already uses, except on one key.
 *
 * The key being edited is left out, so that its own saved combination counts as
 * free to it. Otherwise switching auto-assign off and on again would move a key
 * that already has F13 on to F14 - and the F13 the user typed into Discord would
 * quietly stop working.
 */
export function hotkeysInUse(
    config: DeckConfig,
    except?: { pageId: string; cell: number },
): string[] {
    const skip = except ? keyAddress(except.pageId, except.cell) : null;
    const used: string[] = [];
    for (const page of config.pages) {
        for (const [cell, key] of Object.entries(page.keys)) {
            if (keyAddress(page.id, Number(cell)) === skip) continue;
            used.push(...hotkeysOf(key.action));
        }
    }
    return used.filter((hotkey) => hotkey.length > 0);
}
