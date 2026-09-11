import { useEffect, useRef, useState } from "react";
import { isWidgetKey, keyAddress } from "../../../../shared/config";
import type { DeckConfig, KeyConfig } from "../../../../shared/config";
import type { DeckStatus, Warmup } from "../../../../shared/api";
import { deckTurned, nextChange } from "../../../../shared/widgets/registry";
import type { WidgetStates } from "../../../../shared/widgets";
import { widgetParts } from "../artwork/artwork";
import { deckLook } from "./wheel";

const lookOf = (key: KeyConfig) => ({
    background: key.background ?? "#000000",
    color: key.color,
    label: key.label,
});

/**
 * What loading brings up to date besides the pages: every widget key's
 * picture as it is now, on every page, with the text the deck slides on it
 * where it slides text (`slides`), and each look of the keys the deck turns
 * (dials and dice where the deck turns those, `dials`) once.
 */
export function widgetWarmup(
    config: DeckConfig,
    states: WidgetStates,
    width: number,
    height: number,
    dials: boolean,
    slides = false,
): Warmup {
    const warmup: Warmup = { widgets: [], looks: [] };
    const seen = new Set<string>();
    const now = Date.now();
    for (const page of config.pages)
        for (const [text, key] of Object.entries(page.keys)) {
            const cell = Number(text);
            if (key.action.kind !== "widget" || !isWidgetKey(page, cell)) continue;
            const widget = key.action.widget;
            const state = states[keyAddress(page.id, cell)];
            const { frame, slide } = widgetParts(key, widget, state, now, width, height, slides);
            warmup.widgets.push({ pageId: page.id, cell, frame, ...(slides ? { slide } : {}) });
            const turned = deckTurned(widget, state, now);
            if (!turned || (turned !== "drum" && !dials)) continue;
            const armed = deckLook(lookOf(key), widget, state, width, height);
            if (!armed) continue;
            const id = `${armed.spec.length}:${armed.spec.join(",")}`;
            if (!seen.has(id)) warmup.looks.push({ pageId: page.id, spec: armed.spec });
            seen.add(id);
        }
    return warmup;
}

/**
 * Keep the active page's widget keys current on the deck: as soon as the page
 * has landed (`landed` counts those moments), whenever widget state changes,
 * and exactly when each picture next changes by itself. Unchanged pictures
 * cost nothing: the main process compares before it sends.
 *
 * An adjustable countdown at rest is the deck's to draw and turn, when the
 * deck can (wheel=1): it gets its wheel's look and the time to show instead of
 * pictures, and turns it under the finger by itself.
 */
export function useWidgetLive(
    status: DeckStatus,
    config: DeckConfig,
    states: WidgetStates,
    landed: number,
): void {
    const live = status.connected && status.identity.live === true;
    const wheels = status.connected && status.identity.wheel === true;
    const dials = status.connected && status.identity.dial === true;
    // Text too long for its key goes to the deck to slide (slide=1).
    const slides = status.connected && status.identity.slide === true;
    // A cover picture that finished loading draws its key again.
    const [covers, setCovers] = useState(0);
    useEffect(() => {
        const loaded = (): void => setCovers((n) => n + 1);
        window.addEventListener("decky-art", loaded);
        return () => window.removeEventListener("decky-art", loaded);
    }, []);
    const width = status.connected ? status.identity.keyWidth : 0;
    const height = status.connected ? status.identity.keyHeight : 0;
    useEffect(() => {
        const page = config.pages.find((item) => item.id === config.activePageId);
        if (!live || !page) return;
        const cells = Object.keys(page.keys)
            .map(Number)
            .filter((cell) => isWidgetKey(page, cell));
        if (!cells.length) return;
        let stopped = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const send = (cell: number): void => {
            const key = page.keys[String(cell)];
            if (stopped || key?.action.kind !== "widget") return;
            const widget = key.action.widget;
            const state = states[keyAddress(page.id, cell)];
            const now = Date.now();
            const turned = deckTurned(widget, state, now);
            if (wheels && turned && (turned === "drum" || dials)) {
                const armed = deckLook(lookOf(key), widget, state, width, height);
                if (armed && armed.index >= 0) {
                    void window.deck
                        .wheelKey(page.id, cell, armed.spec, armed.values, armed.index)
                        .catch(() => {});
                    return;
                }
            }
            const { frame, slide } = widgetParts(key, widget, state, now, width, height, slides);
            void window.deck
                .liveKey(page.id, cell, frame, slides ? slide : undefined)
                .catch(() => {});
            const wait = nextChange(widget, state, now);
            if (wait !== null) timers.push(setTimeout(() => send(cell), wait + 15));
        };
        cells.forEach(send);
        return () => {
            stopped = true;
            timers.forEach(clearTimeout);
        };
    }, [live, wheels, dials, slides, config, states, landed, width, height, covers]);

    // Pages not shown, where the deck takes their pictures (warm=1): each widget
    // key again when its state changes, at most every HIDDEN_MS, and one that
    // changes by itself (a clock) on the slow tick. A page then opens as it is.
    const warm = live && status.connected && status.identity.warm === true;
    const hiddenSent = useRef(new Map<string, { at: number; token: string }>());
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!warm) return;
        const timer = setInterval(() => setTick((n) => n + 1), HIDDEN_TICK_MS);
        return () => clearInterval(timer);
    }, [warm]);
    // A new session, or a page landed: what the deck holds is for main to compare.
    useEffect(() => hiddenSent.current.clear(), [landed]);
    useEffect(() => {
        if (!warm) return;
        let stopped = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const now = Date.now();
        for (const page of config.pages) {
            if (page.id === config.activePageId) continue;
            for (const [text, key] of Object.entries(page.keys)) {
                const cell = Number(text);
                if (key.action.kind !== "widget" || !isWidgetKey(page, cell)) continue;
                const widget = key.action.widget;
                const address = keyAddress(page.id, cell);
                const state = states[address];
                const token = `${JSON.stringify(state ?? null)}:${nextChange(widget, state, now) === null ? "" : tick}`;
                const sent = hiddenSent.current.get(address);
                if (sent?.token === token) continue;
                const send = (): void => {
                    if (stopped) return;
                    const at = Date.now();
                    hiddenSent.current.set(address, { at, token });
                    const parts = widgetParts(key, widget, state, at, width, height, slides);
                    void window.deck
                        .liveKey(page.id, cell, parts.frame, slides ? parts.slide : undefined)
                        .catch(() => {});
                };
                const wait = sent ? sent.at + HIDDEN_MS - now : 0;
                if (wait <= 0) send();
                else timers.push(setTimeout(send, wait));
            }
        }
        return () => {
            stopped = true;
            timers.forEach(clearTimeout);
        };
    }, [warm, slides, config, states, tick, width, height, covers]);
}

const HIDDEN_MS = 5000;
const HIDDEN_TICK_MS = 30_000;
