/*---------------------------------------------------------------
 * What a widget does beyond its own state when its key is pressed, swiped
 * or turned: mute, set a level, play or pause, ping now, roll the dice.
 * Widgets whose press only changes their state have no action; their kind's
 * press() does it (src/shared/widgets/).
 *--------------------------------------------------------------*/

import type { Reply } from "../../../shared/api";
import type { Widget } from "../../../shared/widgets";
import type { IntegrationServices } from "../../integrations/integration";
import type { DeckWheels } from "../deck-wheels";
import type { WidgetFeeds } from "../feeds";
import type { PingWatcher } from "../ping";
import type { WidgetStore } from "../widget-state";

/** What a widget's action can use. */
export interface WidgetActionContext {
    widgetStore: WidgetStore;
    pings: PingWatcher;
    feeds: WidgetFeeds;
    wheels: DeckWheels;
    /** The apps Decky talks to, by id. */
    integrations: IntegrationServices;
    /** Say in the window that what the action started failed. */
    failed(error: unknown): void;
}

/** The key a widget is on. */
export interface WidgetKey {
    pageId: string;
    cell: number;
    address: string;
}

/** What a finger did on a key: a tap, two or three taps in a row, or a hold. */
export type Gesture = "tap" | "double" | "triple" | "hold";

/** Taps in a row, by how many: more than an action knows count as its last. */
export const TAPS: readonly Gesture[] = ["tap", "double", "triple"];

/** How many taps in a row an action tells apart: 1 when it has no double or triple. */
export function tapsKnown<W extends Widget>(action: WidgetAction<W> | undefined): number {
    let known = 1;
    for (let count = 2; count <= TAPS.length; count++)
        if (action?.gestures[TAPS[count - 1]!]) known = count;
    return known;
}

/** A gesture's effect, said in the reply. */
export type GestureHandler<W extends Widget> = (
    context: WidgetActionContext,
    widget: W,
    key: WidgetKey,
) => Reply;

export interface WidgetAction<W extends Widget> {
    /**
     * What each gesture does; one it lacks does nothing. With `double` or
     * `triple`, a tap waits a moment for another (TAP_GAP_MS) before it acts;
     * without, it acts at once.
     */
    gestures: { [G in Gesture]?: GestureHandler<W> };
    /** A swipe of `steps` along its key, where the deck does not turn it itself. */
    swipe?(context: WidgetActionContext, widget: W, key: WidgetKey, steps: number): void;
    /** Its dial on the deck, turned by a finger to `value`. */
    turned?(context: WidgetActionContext, widget: W, key: WidgetKey, value: number): void;
}
