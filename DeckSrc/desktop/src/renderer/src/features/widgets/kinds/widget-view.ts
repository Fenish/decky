/*---------------------------------------------------------------
 * A widget's view: everything about one widget type that the renderer
 * does - how its key is drawn, its settings, the readings its style tiles
 * make up, and the look the deck turns. Each type has its folder beside this
 * file, and registry.ts names them all. What a widget is and what a press
 * does to it is its kind's (src/shared/widgets/).
 *--------------------------------------------------------------*/

import type { ReactNode } from "react";
import type { Widget, WidgetState } from "../../../../../shared/widgets";
import type { Area } from "../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../draw-widget";

/** What a widget's settings are drawn from, and where a change goes. */
export interface SettingsProps<W extends Widget> {
    widget: W;
    look: WidgetLook;
    onChange: (widget: Widget) => void;
    /** The time zones to pick from, looked up once for the whole panel. */
    zones: string[];
}

/** A key the deck turns by itself, as its look is built. */
export interface DeckKey<W extends Widget> {
    look: WidgetLook;
    widget: W;
    /** Whether it has its muted look (DeckLook.muted). */
    muted: boolean;
    width: number;
    height: number;
}

/**
 * How the deck shows a key it turns by itself: a drum, a dial, or a die
 * (the kind's deckTurned).
 */
export interface DeckLook<W extends Widget> {
    /** Its look (WHEEL): the same key always gives the same one. */
    build(key: DeckKey<W>): Uint8Array;
    /** Whether the state gives it its muted look. Absent means it has none. */
    muted?(state: WidgetState | undefined): boolean;
    /** What each of its labels stands for, and the one it rests on now. */
    place(widget: W, state: WidgetState | undefined): { values: number[]; index: number };
}

/**
 * One type's view. The widget modules import one another in a ring - a
 * type's settings draw style tiles through drawWidget, which asks the
 * registry for that type's view - so a view can be made before a module it
 * names has run. It names only functions declared with `function`, which are
 * there from the start, never another module's const; and only registry.ts
 * imports the views.
 */
export interface WidgetView<W extends Widget> {
    /**
     * Draw it in `area`, below the key's caption. Without `moment`, only what
     * its settings decide: its base picture (drawWidget).
     */
    draw(
        ctx: CanvasRenderingContext2D,
        widget: W,
        look: WidgetLook,
        area: Area,
        moment?: WidgetMoment,
    ): void;
    /**
     * Its fields in the settings panel, under the widget type. Called while
     * WidgetSettings renders, so it must not use hooks.
     */
    settings?(props: SettingsProps<W>): ReactNode;
    /** What the panel says under its fields; absent or empty for nothing. */
    hint?(widget: W): string;
    /** Readings made up for its style tiles, for widgets that read something. */
    sample?(now: number): WidgetState;
    /** Its look on the deck, for a key the deck turns by itself. */
    deckLook?: DeckLook<W>;
    /** When it starts to ring in the window, in epoch ms; null when it will not. */
    alarm?(widget: W, state: WidgetState | undefined): number | null;
}
