/*---------------------------------------------------------------
 * A kind of widget: everything about one widget type that both processes
 * need, and all of it pure. Each type has its own file beside this one, and
 * registry.ts names them all.
 *--------------------------------------------------------------*/

import type { Widget, WidgetState } from "../widgets";

/** What a press does to a widget's state, and what to report. */
export interface PressResult {
    state: WidgetState | undefined;
    message: string;
}

/** How the deck turns a widget's key by itself: a drum, a dial, or a die it throws. */
export type DeckTurn = "drum" | "dial" | "die";

export interface WidgetKind<W extends Widget> {
    type: W["type"];
    /** How the widget picker shows it, and other words people search for it by. */
    label: string;
    icon: string;
    words: string;
    /** Its settings when it is first put on a key. */
    defaults(now: number): W;
    /** Whether saved settings are valid for it; `value` already has its type. */
    valid(value: Record<string, unknown>): boolean;
    /**
     * Drop settings it no longer has from a saved profile, so the profile
     * still loads. Changes `value` in place.
     */
    retire?(value: Record<string, unknown>): void;
    /**
     * Milliseconds until its picture next changes, or null when only an event
     * (a press, a check, an edit) can change it. Absent means always null.
     */
    nextChange?(widget: W, state: WidgetState | undefined, now: number): number | null;
    /** What a tap or a hold does to its state, for widgets a press changes. */
    press?(widget: W, state: WidgetState | undefined, hold: boolean, now: number): PressResult;
    /**
     * Its state after a finger swiped `steps` along its key, for widgets a
     * swipe changes; null when this one does not.
     */
    swipe?(widget: W, state: WidgetState | undefined, steps: number): WidgetState | null;
    /** How the deck turns its key by itself, if it does. */
    deckTurned?(widget: W, state: WidgetState | undefined, now: number): DeckTurn | null;
    /** Whether a finger turns its key: a swipe on it is then neither a tap nor a hold. */
    fingerTurns?(widget: W): boolean;
}

/** A whole number from `min` to `max`. */
export const whole = (v: unknown, min: number, max: number): boolean =>
    Number.isInteger(v) && Number(v) >= min && Number(v) <= max;

/** Text of at most `max` characters, with no control characters but line breaks. */
export const text = (v: unknown, max: number, allowEmpty = false): boolean =>
    typeof v === "string" &&
    (allowEmpty || v.trim().length > 0) &&
    v.length <= max &&
    !Array.from(v).some((c) => c.charCodeAt(0) < 32 && c !== "\n");
