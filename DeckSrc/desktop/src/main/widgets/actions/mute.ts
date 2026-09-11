import type { Reply } from "../../../shared/api";
import type { MicWidget } from "../../../shared/widgets/mic";
import type { VolumeWidget } from "../../../shared/widgets/volume";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** A tap mutes or unmutes the speaker, or the microphone. */
export class MuteAction implements WidgetAction<VolumeWidget | MicWidget> {
    constructor(private readonly microphone: boolean) {}

    press(
        context: WidgetActionContext,
        _widget: VolumeWidget | MicWidget,
        key: WidgetKey,
        hold: boolean,
    ): Reply {
        if (hold) return { ok: true, message: "Tap to mute or unmute." };
        context.feeds.toggleMute(key.address, this.microphone).catch(context.failed);
        return { ok: true, message: "Muting or unmuting." };
    }
}
