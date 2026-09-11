import type { DiceWidget } from "../../../shared/widgets/dice";
import type { GestureHandler, WidgetAction } from "./widget-action";

const roll: GestureHandler<DiceWidget> = (context, widget, key) => ({
    ok: true,
    message: context.wheels.rollDice(key.pageId, key.cell, widget),
});

/** A tap or a hold rolls: on the deck where it spins or throws them, else in the app. */
export class DiceAction implements WidgetAction<DiceWidget> {
    readonly gestures = { tap: roll, hold: roll };
}
