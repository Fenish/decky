/*---------------------------------------------------------------
 * Every widget type's kind, and what the rest of the app asks of any
 * widget, answered by its kind. A type in the Widget union with no kind
 * here does not compile.
 *--------------------------------------------------------------*/

import type { Widget, WidgetState, WidgetType } from "../widgets";
import { clockKind } from "./clock";
import { countdownKind } from "./countdown";
import { counterKind } from "./counter";
import { cryptoKind } from "./crypto";
import { diceKind } from "./dice";
import {
    discordCallKind,
    discordChannelKind,
    discordInputKind,
    discordNotificationsKind,
    discordOutputKind,
} from "./discord";
import { mediaKind } from "./media";
import { micKind } from "./mic";
import { noteKind } from "./note";
import { obsRecordKind, obsStreamKind } from "./obs";
import { pingKind } from "./ping";
import { pomodoroKind } from "./pomodoro";
import { systemKind } from "./system";
import { timerKind } from "./timer";
import { volumeKind } from "./volume";
import type { IntegrationId } from "../integrations/integration";
import type { DeckTurn, WidgetKind } from "./widget-kind";

type WidgetKinds = { [T in WidgetType]: WidgetKind<Extract<Widget, { type: T }>> };

/** In the order the widget picker lists them. */
export const WIDGET_KINDS: WidgetKinds = {
    clock: clockKind,
    timer: timerKind,
    pomodoro: pomodoroKind,
    countdown: countdownKind,
    media: mediaKind,
    volume: volumeKind,
    mic: micKind,
    system: systemKind,
    ping: pingKind,
    crypto: cryptoKind,
    counter: counterKind,
    dice: diceKind,
    note: noteKind,
    "obs-record": obsRecordKind,
    "obs-stream": obsStreamKind,
    "discord-channel": discordChannelKind,
    "discord-call": discordCallKind,
    "discord-input": discordInputKind,
    "discord-output": discordOutputKind,
    "discord-notifications": discordNotificationsKind,
};

/** A widget's kind. */
export function kindOf<W extends Widget>(widget: W): WidgetKind<W> {
    return WIDGET_KINDS[widget.type] as unknown as WidgetKind<W>;
}

/** Handlers for some widget types, each taking its widget as that type, then `Args`. */
export type WidgetHandlers<Args extends unknown[], R> = {
    [T in WidgetType]?: (widget: Extract<Widget, { type: T }>, ...args: Args) => R;
};

/** Run the widget's handler in `handlers`, if its type has one. */
export function handleWidget<Args extends unknown[], R>(
    handlers: WidgetHandlers<Args, R>,
    widget: Widget,
    ...args: Args
): R | undefined {
    const handler = handlers[widget.type] as ((widget: Widget, ...args: Args) => R) | undefined;
    return handler?.(widget, ...args);
}

/** The kind a type read from outside - a saved profile - names, if it names one. */
function kindNamed(type: unknown): WidgetKind<Widget> | undefined {
    return typeof type === "string" && Object.hasOwn(WIDGET_KINDS, type)
        ? (WIDGET_KINDS[type as WidgetType] as unknown as WidgetKind<Widget>)
        : undefined;
}

/**
 * The widgets to pick from, with other words people search for them by, and
 * the app they belong to, if any: its page in Apps lists them.
 */
export const WIDGET_CHOICES: {
    type: WidgetType;
    label: string;
    icon: string;
    words: string;
    group?: IntegrationId;
}[] = Object.values(WIDGET_KINDS).map(({ type, label, icon, words, group }) => ({
    type,
    label,
    icon,
    words,
    ...(group ? { group } : {}),
}));

export function defaultWidget(type: WidgetType, now = Date.now()): Widget {
    return WIDGET_KINDS[type].defaults(now);
}

export function validWidget(v: unknown): v is Widget {
    if (typeof v !== "object" || v === null) return false;
    const w = v as Record<string, unknown>;
    return kindNamed(w.type)?.valid(w) ?? false;
}

/**
 * Bring a saved widget up to date (its kind's retire()), in place. False when
 * Decky has no such widget any more.
 */
export function retireWidget(widget: Record<string, unknown>): boolean {
    const kind = kindNamed(widget.type);
    kind?.retire?.(widget);
    return kind !== undefined;
}

/**
 * Milliseconds until the widget's picture next changes, or null when only an
 * event (a press, a check, an edit) can change it.
 */
export function nextChange(
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
): number | null {
    return kindOf(widget).nextChange?.(widget, state, now) ?? null;
}

/**
 * How the deck turns a widget's key by itself, if it does: a drum (an
 * adjustable countdown at rest; a coin, yes or no, or a list), a dial
 * (volume), or a die it throws.
 */
export function deckTurned(
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
): DeckTurn | null {
    return kindOf(widget).deckTurned?.(widget, state, now) ?? null;
}

/** Whether a finger turns the widget's key on the deck, so a swipe is neither a tap nor a hold. */
export function fingerTurns(widget: Widget): boolean {
    return kindOf(widget).fingerTurns?.(widget) ?? false;
}
