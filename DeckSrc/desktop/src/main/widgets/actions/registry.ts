import type { Widget, WidgetType } from "../../../shared/widgets";
import { PriceAction } from "./crypto";
import { DiceAction } from "./dice";
import { MediaAction } from "./media";
import { MuteAction } from "./mute";
import { PingAction } from "./ping";
import { TaskManagerAction } from "./system";
import { VolumeAction } from "./volume";
import type { WidgetAction } from "./widget-action";

type WidgetActions = { [T in WidgetType]?: WidgetAction<Extract<Widget, { type: T }>> };

/** The widgets that act beyond their own state. */
export const WIDGET_ACTIONS: WidgetActions = {
    ping: new PingAction(),
    volume: new VolumeAction(),
    mic: new MuteAction(true),
    media: new MediaAction(),
    system: new TaskManagerAction(),
    crypto: new PriceAction(),
    dice: new DiceAction(),
};

/** A widget's action, if it has one. */
export function actionOf<W extends Widget>(widget: W): WidgetAction<W> | undefined {
    return WIDGET_ACTIONS[widget.type] as WidgetAction<W> | undefined;
}
