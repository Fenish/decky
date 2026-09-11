/*---------------------------------------------------------------
 * What a widget does beyond its own state when its key is pressed or
 * swiped: mute, play or pause, ping now, roll the dice. Widgets whose press
 * only changes their state have no action; their kind's press() does it
 * (src/shared/widgets/).
 *--------------------------------------------------------------*/

import type { Reply } from "../../../shared/api";
import type { Widget } from "../../../shared/widgets";
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
    /** Say in the window that what the action started failed. */
    failed(error: unknown): void;
}

/** The key a widget is on. */
export interface WidgetKey {
    pageId: string;
    cell: number;
    address: string;
}

export interface WidgetAction<W extends Widget> {
    /** A tap, or a hold: what happens, said in the reply. */
    press(context: WidgetActionContext, widget: W, key: WidgetKey, hold: boolean): Reply;
    /** A swipe of `steps` along its key, where the deck does not turn it itself. */
    swipe?(context: WidgetActionContext, widget: W, key: WidgetKey, steps: number): void;
}
