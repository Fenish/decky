import type { Widget, WidgetType } from "../../../shared/widgets";
import { PriceAction } from "./crypto";
import { DiceAction } from "./dice";
import { joinOrLeave, leaveCall, nextDevice, openInbox } from "./discord";
import { MediaAction } from "./media";
import { ObsAction } from "./obs";
import { PingAction } from "./ping";
import { SoundAction } from "./sound";
import { TaskManagerAction } from "./system";
import type { WidgetAction } from "./widget-action";

type WidgetActions = { [T in WidgetType]?: WidgetAction<Extract<Widget, { type: T }>> };

/** The widgets that act beyond their own state. */
export const WIDGET_ACTIONS: WidgetActions = {
    ping: new PingAction(),
    volume: new SoundAction("speaker"),
    mic: new SoundAction("microphone"),
    media: new MediaAction(),
    system: new TaskManagerAction(),
    crypto: new PriceAction(),
    dice: new DiceAction(),
    "obs-record": new ObsAction(),
    "obs-stream": new ObsAction(),
    "discord-channel": joinOrLeave,
    "discord-call": leaveCall,
    "discord-input": nextDevice,
    "discord-output": nextDevice,
    "discord-notifications": openInbox,
};

/** A widget's action, if it has one. */
export function actionOf<W extends Widget>(widget: W): WidgetAction<W> | undefined {
    return WIDGET_ACTIONS[widget.type] as WidgetAction<W> | undefined;
}
