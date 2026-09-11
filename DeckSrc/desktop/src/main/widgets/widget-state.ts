/*---------------------------------------------------------------
 * Widget state: what a widget has done since it was set up.
 *
 * A counter's value and a timer's run survive a restart, so they are saved
 * beside the profile. A running timer is saved as when it started, so it
 * keeps counting by the real clock even while Decky is closed.
 *--------------------------------------------------------------*/

import { rename, readFile, writeFile } from "node:fs/promises";
import { keyAddress } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { KeyLocation } from "../../shared/key-layout";
import { KEPT_STATE } from "../../shared/widgets";
import type { Widget, WidgetState, WidgetStates } from "../../shared/widgets";
import { kindOf } from "../../shared/widgets/registry";
import type { PressResult } from "../../shared/widgets/widget-kind";

/** A press held this long is a hold: reset, skip, back to the start. */
export const HOLD_MS = 600;
/** A finger that moves this far is swiping: no tap when it lifts, no hold. */
export const SWIPE_PX = 10;
/** How far a finger moves on a wheel for one step. */
export const WHEEL_STEP_PX = 15;

/**
 * A swipe of `steps` along a widget key: its new state where its kind turns
 * a swipe into one (an adjustable countdown, timer.ts), else null.
 */
export function dialTimer(
    widget: Widget,
    state: WidgetState | undefined,
    steps: number,
): WidgetState | null {
    return kindOf(widget).swipe?.(widget, state, steps) ?? null;
}

/** What pressing a widget does to its state, and what to report: its kind's press(), if it has one. */
export function pressWidget(
    widget: Widget,
    state: WidgetState | undefined,
    hold: boolean,
    now: number,
): PressResult {
    return kindOf(widget).press?.(widget, state, hold, now) ?? { state, message: "" };
}

export class WidgetStore {
    private states: WidgetStates = {};
    private saving: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly path: string,
        private readonly changed: (states: WidgetStates) => void,
    ) {}

    async load(): Promise<void> {
        try {
            const saved = JSON.parse(await readFile(this.path, "utf8")) as unknown;
            if (typeof saved === "object" && saved !== null && !Array.isArray(saved))
                this.states = saved as WidgetStates;
        } catch {
            this.states = {};
        }
    }

    snapshot(): WidgetStates {
        return structuredClone(this.states);
    }

    get(address: string): WidgetState | undefined {
        return this.states[address];
    }

    set(address: string, state: WidgetState | undefined, persist = true): void {
        if (state === undefined) delete this.states[address];
        else this.states[address] = state;
        this.changed(this.snapshot());
        if (persist) this.save();
    }

    /** Keep state with the key it belongs to when keys move or swap. */
    move(from: KeyLocation, to: KeyLocation, swapped: boolean): void {
        const source = keyAddress(from.pageId, from.cell);
        const target = keyAddress(to.pageId, to.cell);
        if (source === target) return;
        const moving = this.states[source];
        const displaced = this.states[target];
        delete this.states[source];
        delete this.states[target];
        if (moving) this.states[target] = moving;
        if (swapped && displaced) this.states[source] = displaced;
        this.changed(this.snapshot());
        this.save();
    }

    /**
     * Forget state for keys that are no longer widgets. Moves are applied
     * first (move()), so a widget that changed places keeps its count.
     */
    reconcile(next: DeckConfig): void {
        let dropped = false;
        for (const address of Object.keys(this.states)) {
            const split = address.lastIndexOf(":");
            const pageId = address.slice(0, split);
            const cell = address.slice(split + 1);
            const action = next.pages.find((p) => p.id === pageId)?.keys[cell]?.action;
            if (action?.kind !== "widget") {
                delete this.states[address];
                dropped = true;
            }
        }
        if (dropped) {
            this.changed(this.snapshot());
            this.save();
        }
    }

    /** Save soon; `set(..., false)` only changes what is in memory. */
    save(): void {
        clearTimeout(this.saving);
        this.saving = setTimeout(() => {
            // Readings (pings, load, volume, prices) are read again on start;
            // only what a person did is kept.
            const kept = Object.fromEntries(
                Object.entries(this.states)
                    .map(([address, state]) => [
                        address,
                        Object.fromEntries(
                            Object.entries(state).filter(([field]) =>
                                (KEPT_STATE as readonly string[]).includes(field),
                            ),
                        ),
                    ])
                    .filter(([, state]) => Object.keys(state as object).length > 0),
            );
            const temporary = `${this.path}.tmp`;
            void writeFile(temporary, JSON.stringify(kept))
                .then(() => rename(temporary, this.path))
                .catch(() => {});
        }, 400);
    }
}
