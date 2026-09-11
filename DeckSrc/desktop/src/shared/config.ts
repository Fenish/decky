import { validProgramTarget } from "./programs";
import type { Widget } from "./widgets";
import { retireWidget, validWidget } from "./widgets/registry";
export const CELL_COUNT = 15;
export const BACK_CELL = 10;
export type Step =
    /**
     * `auto` marks a combination the app chose from F13-F24 rather than one
     * the user typed. Absent means chosen by hand, which is what every hotkey
     * saved before the switch existed was.
     */
    | { kind: "hotkey"; keys: string; auto?: boolean }
    | { kind: "program"; path: string; name?: string }
    | { kind: "website"; url: string }
    | { kind: "script"; path: string; background?: boolean; wait?: boolean; timeoutMs?: number }
    | { kind: "delay"; ms: number };
export type Action =
    | Step
    | { kind: "macro"; steps: Step[] }
    | { kind: "page"; pageId: string }
    /** A key whose picture keeps changing; see shared/widgets.ts. */
    | { kind: "widget"; widget: Widget };
export interface Artwork {
    source: string;
    zoom: number;
    x: number;
    y: number;
    rotation: number;
    brightness: number;
}
export interface KeyAppearance {
    label: string;
    icon: string;
    color: string;
    background?: string;
    labelGap?: number;
    artwork?: Artwork;
}
export interface KeyConfig extends KeyAppearance {
    action: Action;
    behavior?: "normal" | "toggle";
    activeAppearance?: KeyAppearance;
}
export type KeyStates = Record<string, boolean>;
export function keyAddress(pageId: string, cell: number): string {
    return `${pageId}:${cell}`;
}
export function appearanceOf(key: KeyConfig, on = false): KeyAppearance {
    const source =
        on && key.behavior === "toggle" && key.activeAppearance ? key.activeAppearance : key;
    return {
        label: source.label,
        icon: source.icon,
        color: source.color,
        background: source.background,
        labelGap: source.labelGap,
        artwork: source.artwork,
    };
}
export function displayedKey(key: KeyConfig | undefined, on: boolean): KeyConfig | undefined {
    return key ? { ...key, ...appearanceOf(key, on) } : undefined;
}
/** Whether a key is a widget; a nested page's Back key never is. */
export function isWidgetKey(page: DeckPage, cell: number): boolean {
    return (
        page.keys[String(cell)]?.action.kind === "widget" && !(page.parentId && cell === BACK_CELL)
    );
}
export interface DeckPage {
    id: string;
    name: string;
    parentId: string | null;
    keys: Record<string, KeyConfig>;
}
export interface DeckConfig {
    version: 2;
    pages: DeckPage[];
    activePageId: string;
    reducedMotion: boolean;
}
export function createConfig(): DeckConfig {
    return {
        version: 2,
        activePageId: "home",
        reducedMotion: false,
        pages: [{ id: "home", name: "Home", parentId: null, keys: {} }],
    };
}
export function validWebsite(url: string): boolean {
    try {
        return ["https:", "http:"].includes(new URL(url).protocol);
    } catch {
        return false;
    }
}
const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
const string = (v: unknown, max = 256): v is string =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    !Array.from(v).some((c) => c.charCodeAt(0) < 32);
const validLabel = (v: unknown): v is string =>
    typeof v === "string" && v.length <= 40 && !Array.from(v).some((c) => c.charCodeAt(0) < 32);
/** Whether a step's settings are valid, for each kind of step. */
const STEP_CHECKS: { [K in Step["kind"]]: (v: Record<string, unknown>) => boolean } = {
    hotkey: (v) => string(v.keys, 64) && (v.auto === undefined || typeof v.auto === "boolean"),
    website: (v) => string(v.url, 2048) && validWebsite(v.url),
    program: (v) =>
        validProgramTarget(v.path) &&
        (v.name === undefined ||
            (typeof v.name === "string" &&
                v.name.length <= 160 &&
                !Array.from(v.name).some((c) => c.charCodeAt(0) < 32))),
    script: (v) =>
        string(v.path, 1024) &&
        /^(?:[a-z]:[\\/]|\/)/i.test(v.path) &&
        /\.ps1$/i.test(v.path) &&
        (v.background === undefined || typeof v.background === "boolean") &&
        (v.wait === undefined || typeof v.wait === "boolean") &&
        (v.timeoutMs === undefined ||
            (Number.isInteger(v.timeoutMs) &&
                Number(v.timeoutMs) >= 0 &&
                Number(v.timeoutMs) <= 2147483647)),
    delay: (v) => Number.isInteger(v.ms) && Number(v.ms) >= 50 && Number(v.ms) <= 30000,
};
/** Whether an action's settings are valid, for each kind of action; `ids` are the profile's pages. */
const ACTION_CHECKS: {
    [K in Action["kind"]]: (v: Record<string, unknown>, ids: Set<string>) => boolean;
} = {
    ...STEP_CHECKS,
    macro: (v) =>
        Array.isArray(v.steps) &&
        v.steps.length > 0 &&
        v.steps.length <= 32 &&
        v.steps.every(validStep),
    page: (v, ids) => ids.has(String(v.pageId)),
    widget: (v) => validWidget(v.widget),
};
/** The table's entry for a kind read from outside - a saved profile - if it has one. */
function checkFor<T>(checks: Record<string, T>, kind: unknown): T | undefined {
    return typeof kind === "string" && Object.hasOwn(checks, kind) ? checks[kind] : undefined;
}
function validStep(v: unknown): v is Step {
    return record(v) && (checkFor(STEP_CHECKS, v.kind)?.(v) ?? false);
}
/** Widgets Decky once had and no longer does. */
const RETIRED_WIDGETS = new Set(["network"]);
/**
 * Drop what widgets no longer have, so a profile saved with it still loads:
 * a retired widget's key empties, and other widgets lose the settings their
 * kind no longer has (retire() in shared/widgets/). Changes `value` in place
 * and leaves the rest to validateConfig.
 */
export function retireWidgets(value: unknown): void {
    if (!record(value) || !Array.isArray(value.pages)) return;
    for (const page of value.pages) {
        if (!record(page) || !record(page.keys)) continue;
        for (const [cell, key] of Object.entries(page.keys)) {
            const action = record(key) ? key.action : undefined;
            if (!record(action) || action.kind !== "widget" || !record(action.widget)) continue;
            if (RETIRED_WIDGETS.has(String(action.widget.type))) delete page.keys[cell];
            else retireWidget(action.widget);
        }
    }
}
export function validateConfig(value: unknown): asserts value is DeckConfig {
    if (
        !record(value) ||
        value.version !== 2 ||
        !Array.isArray(value.pages) ||
        value.pages.length < 1 ||
        value.pages.length > 64 ||
        typeof value.reducedMotion !== "boolean"
    )
        throw new Error("Invalid Decky configuration.");
    const ids = new Set<string>();
    for (const page of value.pages) {
        if (
            !record(page) ||
            !string(page.id, 80) ||
            !/^[\w-]+$/.test(page.id) ||
            ids.has(page.id) ||
            !string(page.name, 40) ||
            !record(page.keys)
        )
            throw new Error("Invalid or duplicate page.");
        ids.add(page.id);
    }
    const pages = value.pages as DeckPage[];
    if (
        pages[0]!.id !== "home" ||
        pages[0]!.parentId !== null ||
        !ids.has(String(value.activePageId))
    )
        throw new Error("Home or active page is missing.");
    for (const page of pages) {
        if (
            page.id !== "home" &&
            (typeof page.parentId !== "string" ||
                !ids.has(page.parentId) ||
                page.parentId === page.id)
        )
            throw new Error("Invalid parent page.");
        const visited = new Set<string>([page.id]);
        let parent = page.parentId;
        while (parent !== null) {
            if (visited.has(parent)) throw new Error("Pages cannot contain a cycle.");
            visited.add(parent);
            parent = pages.find((p) => p.id === parent)?.parentId ?? null;
        }
        for (const [cell, key] of Object.entries(page.keys)) {
            if (
                !/^\d+$/.test(cell) ||
                Number(cell) >= CELL_COUNT ||
                (page.parentId !== null && Number(cell) === BACK_CELL) ||
                !record(key) ||
                !validLabel(key.label) ||
                !string(key.icon, 64) ||
                typeof key.color !== "string" ||
                !/^#[0-9a-f]{6}$/i.test(key.color)
            )
                throw new Error("Invalid key. Bottom-left is reserved for Back in folders.");
            const action = key.action;
            if (!record(action) || !(checkFor(ACTION_CHECKS, action.kind)?.(action, ids) ?? false))
                throw new Error("Complete the action settings before saving.");
            if (
                key.behavior !== undefined &&
                key.behavior !== "normal" &&
                key.behavior !== "toggle"
            )
                throw new Error("Invalid button behavior.");
            if (key.behavior === "toggle" && key.action.kind === "page")
                throw new Error("Page navigation uses normal buttons.");
            if (key.behavior === "toggle" && key.action.kind === "widget")
                throw new Error("Widgets use normal buttons.");
            for (const appearance of [
                key,
                ...(key.activeAppearance === undefined ? [] : [key.activeAppearance]),
            ]) {
                if (
                    !record(appearance) ||
                    !validLabel(appearance.label) ||
                    !string(appearance.icon, 64) ||
                    typeof appearance.color !== "string" ||
                    !/^#[0-9a-f]{6}$/i.test(appearance.color)
                )
                    throw new Error("Invalid toggle appearance.");
                if (
                    appearance.background !== undefined &&
                    (typeof appearance.background !== "string" ||
                        !/^#[0-9a-f]{6}$/i.test(appearance.background))
                )
                    throw new Error("Invalid key background color.");
                if (
                    appearance.labelGap !== undefined &&
                    (!Number.isInteger(appearance.labelGap) ||
                        Number(appearance.labelGap) < 0 ||
                        Number(appearance.labelGap) > 32)
                )
                    throw new Error("Invalid icon/text spacing.");
                if (appearance.artwork !== undefined) {
                    const a = appearance.artwork;
                    if (
                        !record(a) ||
                        typeof a.source !== "string" ||
                        a.source.length > 750000 ||
                        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.source) ||
                        ![a.zoom, a.x, a.y, a.rotation, a.brightness].every(
                            (n) => typeof n === "number" && Number.isFinite(n),
                        ) ||
                        Number(a.zoom) < 0.1 ||
                        Number(a.zoom) > 4 ||
                        Math.abs(Number(a.x)) > 100 ||
                        Math.abs(Number(a.y)) > 100 ||
                        Math.abs(Number(a.rotation)) > 180 ||
                        Number(a.brightness) < 0.2 ||
                        Number(a.brightness) > 2
                    )
                        throw new Error("Invalid artwork adjustments.");
                }
            }
        }
    }
    if (JSON.stringify(value).length > 24 * 1024 * 1024)
        throw new Error("Profile exceeds the 24 MB limit.");
}
