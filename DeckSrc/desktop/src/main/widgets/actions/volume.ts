import type { VolumeWidget } from "../../../shared/widgets/volume";
import { MuteAction } from "./mute";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** The volume: a tap mutes it, and a swipe turns it where the deck has no dial. */
export class VolumeAction extends MuteAction implements WidgetAction<VolumeWidget> {
    constructor() {
        super(false);
    }

    // Firmware without dials: the volume moves 2% a step.
    swipe(
        context: WidgetActionContext,
        _widget: VolumeWidget,
        key: WidgetKey,
        steps: number,
    ): void {
        const level = (context.widgetStore.get(key.address)?.level ?? 0) + steps * 2;
        void context.feeds.setVolume(level);
    }
}
