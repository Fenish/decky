import type { Reply } from "../../../shared/api";
import type { DiceWidget } from "../../../shared/widgets/dice";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** A tap or a hold rolls: on the deck where it spins or throws them, else in the app. */
export class DiceAction implements WidgetAction<DiceWidget> {
    press(context: WidgetActionContext, widget: DiceWidget, key: WidgetKey): Reply {
        return { ok: true, message: context.wheels.rollDice(key.pageId, key.cell, widget) };
    }
}
