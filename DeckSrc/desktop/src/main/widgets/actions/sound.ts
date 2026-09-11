import type { LevelWidget, SoundDevice } from "../../../shared/widgets/level";
import type { GestureHandler, WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/**
 * The speaker's or the microphone's dial: a tap mutes or unmutes it, and
 * turning it sets its level - on the deck, or with a swipe where the deck
 * turns no dials.
 */
export class SoundAction implements WidgetAction<LevelWidget> {
    constructor(private readonly device: SoundDevice) {}

    private readonly toggleMute: GestureHandler<LevelWidget> = (context, _widget, key) => {
        context.feeds.toggleMute(key.address, this.device).catch(context.failed);
        return { ok: true, message: "Muting or unmuting." };
    };

    readonly gestures = { tap: this.toggleMute };

    // Firmware without dials: 2% a step.
    swipe(context: WidgetActionContext, _widget: LevelWidget, key: WidgetKey, steps: number): void {
        const level = (context.widgetStore.get(key.address)?.level ?? 0) + steps * 2;
        context.feeds.setLevel(this.device, level).catch(context.failed);
    }

    turned(
        context: WidgetActionContext,
        _widget: LevelWidget,
        _key: WidgetKey,
        value: number,
    ): void {
        context.feeds.setLevel(this.device, value).catch(context.failed);
    }
}
