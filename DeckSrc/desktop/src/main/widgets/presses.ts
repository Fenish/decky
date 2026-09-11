/*---------------------------------------------------------------
 * Widget keys under a finger: a tap when it lifts - or two or three in a
 * row, where the widget tells them apart (tap-runs.ts) - a hold at HOLD_MS
 * while still down, and a swipe, which is none of these. A widget with an
 * action (actions/) does what its gestures say; any other changes its own
 * state, as its kind says.
 *--------------------------------------------------------------*/

import { keyAddress } from "../../shared/config";
import type { DeckPage } from "../../shared/config";
import type { Reply } from "../../shared/api";
import type { Widget } from "../../shared/widgets";
import type { MainWindow } from "../app/main-window";
import type { Profile } from "../profile/profile";
import { actionOf } from "./actions/registry";
import { tapsKnown } from "./actions/widget-action";
import type { Gesture, WidgetActionContext } from "./actions/widget-action";
import type { DeckWheels } from "./deck-wheels";
import type { WidgetReadings } from "./readings";
import { TapRuns } from "./tap-runs";
import { dialTimer, HOLD_MS, pressWidget, SWIPE_PX, WHEEL_STEP_PX } from "./widget-state";
import type { WidgetStore } from "./widget-state";

// Widget keys held down on the deck. `hold` turns the press into a hold when
// it fires, and is null once it has or the finger swiped. A swipe turns an
// adjustable countdown's wheel: `applied` steps so far from where it began.
interface WidgetPress {
    hold: ReturnType<typeof setTimeout> | null;
    startY?: number;
    applied: number;
    swiped: boolean;
}

export class WidgetPresses {
    private readonly widgetPresses = new Map<string, WidgetPress>();
    private readonly taps = new TapRuns();
    private readonly context: WidgetActionContext;

    constructor(
        private readonly profile: Profile,
        private readonly widgetStore: WidgetStore,
        readings: WidgetReadings,
        private readonly wheels: DeckWheels,
        window: MainWindow,
    ) {
        this.context = {
            widgetStore,
            pings: readings.pings,
            feeds: readings.feeds,
            integrations: readings.integrations,
            wheels,
            failed: (error) =>
                void window.send("action:activity", {
                    at: Date.now(),
                    label: "Widget",
                    ok: false,
                    message: String(error),
                }),
        };
    }

    /**
     * A gesture on a widget key. Widgets change their own state rather than
     * running an action, or act on the PC: mute, play or pause, open Task Manager.
     */
    useWidget(pageId: string, cell: number, widget: Widget, gesture: Gesture): Reply {
        const address = keyAddress(pageId, cell);
        const action = actionOf(widget);
        if (action) {
            const handler = action.gestures[gesture];
            if (!handler) return { ok: true, message: "Nothing happens." };
            return handler(this.context, widget, { pageId, cell, address });
        }
        const hold = gesture === "hold";
        const result = pressWidget(widget, this.widgetStore.get(address), hold, Date.now());
        if (!result.message) return { ok: true, message: "This widget has nothing to press." };
        this.widgetStore.set(address, result.state);
        return { ok: true, message: result.message };
    }

    /** A finger turned a widget's dial on the deck to `value`: its action follows. */
    widgetTurned(cell: number, value: number): void {
        if (!this.wheels.dialTurned(cell, value)) return;
        const pageId = this.profile.config.activePageId;
        const widget = this.profile.currentWidget(pageId, cell);
        const action = widget ? actionOf(widget) : undefined;
        if (widget && action?.turned)
            action.turned(
                this.context,
                widget,
                { pageId, cell, address: keyAddress(pageId, cell) },
                value,
            );
    }

    /**
     * A widget taps when it is let go, and holds the moment a press has lasted
     * HOLD_MS: a stopwatch shows its reset while the finger is still down. A
     * finger that swiped does neither. A press that becomes a hold or a swipe
     * drops the taps just before it.
     */
    widgetPress(page: DeckPage, cell: number, down: boolean): void {
        const address = keyAddress(page.id, cell);
        const press = this.widgetPresses.get(address);
        if (press?.hold) clearTimeout(press.hold);
        this.widgetPresses.delete(address);
        if (down) {
            this.taps.pressed(address);
            const next: WidgetPress = { hold: null, applied: 0, swiped: false };
            next.hold = setTimeout(() => {
                next.hold = null;
                this.taps.broken(address);
                const widget = this.profile.currentWidget(page.id, cell);
                if (widget) this.useWidget(page.id, cell, widget, "hold");
            }, HOLD_MS);
            this.widgetPresses.set(address, next);
            return;
        }
        if (!press) return;
        // The time a swipe picked was only in memory while the finger moved.
        if (press.swiped) {
            this.taps.broken(address);
            if (press.applied) this.widgetStore.save();
            return;
        }
        // A hold acted while the finger was down.
        const widget = this.profile.currentWidget(page.id, cell);
        if (!press.hold || !widget) return;
        this.taps.tapped(address, tapsKnown(actionOf(widget)), (gesture) => {
            // The widget as it is when the run ends: an edit meanwhile counts.
            const current = this.profile.currentWidget(page.id, cell);
            if (current) this.useWidget(page.id, cell, current, gesture);
        });
    }

    /**
     * A finger moving on a key the deck reports movement for. Past SWIPE_PX it is
     * a swipe; every WHEEL_STEP_PX from where it began turns an adjustable
     * countdown's wheel one step, up for more time, as a picker wheel rolls.
     */
    widgetMove(cell: number, y: number): void {
        const { config } = this.profile;
        const address = keyAddress(config.activePageId, cell);
        const press = this.widgetPresses.get(address);
        if (!press) return;
        if (press.startY === undefined) {
            press.startY = y;
            return;
        }
        const moved = press.startY - y;
        if (!press.swiped && Math.abs(moved) >= SWIPE_PX) {
            press.swiped = true;
            if (press.hold) clearTimeout(press.hold);
            press.hold = null;
        }
        // A wheel the deck turns itself needs nothing more from the finger here.
        if (this.wheels.turns(cell, config.activePageId)) return;
        const steps = Math.trunc(moved / WHEEL_STEP_PX);
        if (!press.swiped || steps === press.applied) return;
        const widget = this.profile.currentWidget(config.activePageId, cell);
        const step = steps - press.applied;
        press.applied = steps;
        const action = widget ? actionOf(widget) : undefined;
        if (widget && action?.swipe) {
            action.swipe(
                this.context,
                widget,
                { pageId: config.activePageId, cell, address },
                step,
            );
            return;
        }
        const next = widget ? dialTimer(widget, this.widgetStore.get(address), step) : null;
        if (next) this.widgetStore.set(address, next, false);
    }
}
