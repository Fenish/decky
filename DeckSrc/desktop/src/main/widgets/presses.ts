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
import { designsOf } from "../../shared/widgets/registry";
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

/** How long after the last touch a design picked on the key is kept. */
export const KEEP_MS = 3000;

export class WidgetPresses {
    private readonly widgetPresses = new Map<string, WidgetPress>();
    private readonly taps = new TapRuns();
    private readonly context: WidgetActionContext;
    /** Keys with a design being picked on them: which one, and when it is kept. */
    private readonly choosing = new Map<
        string,
        { pageId: string; cell: number; index: number; keep: ReturnType<typeof setTimeout> }
    >();
    /** A design picked on a key: kept in the profile (set by the app's wiring). */
    onDesign: ((pageId: string, cell: number, widget: Widget) => void | Promise<void>) | null =
        null;

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
            speed: readings.speed,
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
        // Held down, a widget with more than one design offers them on the key,
        // a dot each, and every tap after that moves to the next. A widget whose
        // hold already does something keeps it (Now playing goes back a track).
        if (gesture === "tap" && this.chooseNext(address)) return { ok: true, message: "Design." };
        if (
            gesture === "hold" &&
            !action?.gestures.hold &&
            this.startChoosing(pageId, cell, widget)
        )
            return { ok: true, message: "Pick a design." };
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

    /**
     * A hold on a widget with designs: the key shows the one it has with a dot
     * for each, and waits for taps. False for a widget with nothing to pick.
     */
    private startChoosing(pageId: string, cell: number, widget: Widget): boolean {
        const { list, index } = designsOf(widget);
        if (list.length < 2) return false;
        this.showChoice(pageId, cell, Math.max(0, index), list.length);
        return true;
    }

    /** A tap while a design is being picked: the next one. True when that is what it did. */
    private chooseNext(address: string): boolean {
        const picking = this.choosing.get(address);
        if (!picking) return false;
        const widget = this.profile.currentWidget(picking.pageId, picking.cell);
        const count = widget ? designsOf(widget).list.length : 0;
        if (!widget || count < 2) {
            this.stopChoosing(address);
            return false;
        }
        this.showChoice(picking.pageId, picking.cell, (picking.index + 1) % count, count);
        return true;
    }

    /** The key shows design `index` of `count`, and keeps it once the touches stop. */
    private showChoice(pageId: string, cell: number, index: number, count: number): void {
        const address = keyAddress(pageId, cell);
        const picking = this.choosing.get(address);
        if (picking) clearTimeout(picking.keep);
        this.choosing.set(address, {
            pageId,
            cell,
            index,
            keep: setTimeout(() => this.keepChoice(address), KEEP_MS),
        });
        this.widgetStore.set(
            address,
            { ...this.widgetStore.get(address), choosing: { index, count } },
            false,
        );
    }

    /**
     * The design picked goes into the profile, and the key is a key again -
     * once it is saved, so the key does not flick back to the design it had
     * for as long as saving takes.
     */
    private keepChoice(address: string): void {
        const picking = this.choosing.get(address);
        if (!picking) return;
        const widget = this.profile.currentWidget(picking.pageId, picking.cell);
        const design = widget ? designsOf(widget).list[picking.index] : undefined;
        const saved = design && this.onDesign?.(picking.pageId, picking.cell, design);
        void Promise.resolve(saved).then(
            () => this.stopChoosing(address, picking),
            () => this.stopChoosing(address, picking),
        );
    }

    /**
     * No design is being picked on this key any more. `only` stops just that
     * one: a hold that began while the last was being saved stands.
     */
    private stopChoosing(address: string, only?: object): void {
        const picking = this.choosing.get(address);
        if (!picking || (only && picking !== only)) return;
        clearTimeout(picking.keep);
        this.choosing.delete(address);
        const { choosing: _picked, ...rest } = this.widgetStore.get(address) ?? {};
        this.widgetStore.set(address, rest, false);
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
