import { BACK_CELL, CELL_COUNT } from "./config";
import type { Action, DeckConfig, KeyConfig, Step } from "./config";
import { hotkeysInUse, nextFreeHotkey } from "./hotkey-pool";
export interface KeyLocation {
    pageId: string;
    cell: number;
}
function pageAt(config: DeckConfig, location: KeyLocation) {
    const page = config.pages.find((item) => item.id === location.pageId);
    if (
        !page ||
        !Number.isInteger(location.cell) ||
        location.cell < 0 ||
        location.cell >= CELL_COUNT
    )
        throw new Error("Invalid key position.");
    if (page.parentId && location.cell === BACK_CELL)
        throw new Error("The Back key cannot be moved or replaced.");
    return page;
}
export function moveKey(
    config: DeckConfig,
    from: KeyLocation,
    to: KeyLocation,
): { config: DeckConfig; swapped: boolean } {
    const source = pageAt(config, from);
    const target = pageAt(config, to);
    const key = source.keys[from.cell];
    if (!key) throw new Error("Choose an assigned key to move.");
    if (from.pageId === to.pageId && from.cell === to.cell) return { config, swapped: false };
    const other = target.keys[to.cell];
    const pages = config.pages.map((page) => {
        if (page.id !== from.pageId && page.id !== to.pageId) return page;
        const keys = { ...page.keys };
        if (page.id === from.pageId) {
            if (other) keys[from.cell] = other;
            else delete keys[from.cell];
        }
        if (page.id === to.pageId) keys[to.cell] = key;
        return { ...page, keys };
    });
    return { config: { ...config, pages }, swapped: Boolean(other) };
}
/**
 * Give every auto-assigned hotkey in a copied action a combination of its own.
 *
 * A copy keeps everything else about the original, but an auto-assigned key is
 * a reservation, not a setting: two keys sharing F13 would both fire whatever
 * the user bound to F13 in Discord, and the copy would look independent while
 * being nothing of the sort. Hotkeys the user typed themselves are copied as
 * they are - that choice was theirs.
 */
function reassignAuto(action: Action, taken: string[]): Action {
    const fresh = (step: Step): Step => {
        if (step.kind !== "hotkey" || step.auto !== true) return step;
        const keys = nextFreeHotkey(taken);
        if (keys === null)
            throw new Error(
                "All 96 automatic keys (F13–F24) are in use. Free one, or turn auto-assign off on the original first.",
            );
        taken.push(keys);
        return { ...step, keys };
    };
    if (action.kind === "macro") return { ...action, steps: action.steps.map(fresh) };
    return action.kind === "page" || action.kind === "widget" ? action : fresh(action);
}
export function duplicateKey(
    config: DeckConfig,
    from: KeyLocation,
): { config: DeckConfig; cell: number; key: KeyConfig } {
    const page = pageAt(config, from);
    const source = page.keys[from.cell];
    if (!source) throw new Error("Choose an assigned key to duplicate.");
    const cell = Array.from(
        { length: CELL_COUNT },
        (_, index) => (from.cell + index + 1) % CELL_COUNT,
    ).find((index) => !page.keys[index] && !(page.parentId && index === BACK_CELL));
    if (cell === undefined) throw new Error("This page is full.");
    const copy = structuredClone(source);
    const key = { ...copy, action: reassignAuto(copy.action, hotkeysInUse(config)) };
    return {
        config: {
            ...config,
            pages: config.pages.map((item) =>
                item.id === page.id ? { ...item, keys: { ...item.keys, [cell]: key } } : item,
            ),
        },
        cell,
        key,
    };
}
