import type { SpeedtestWidget } from "../../../shared/widgets/speedtest";
import type { GestureHandler, WidgetAction } from "./widget-action";

const measure: GestureHandler<SpeedtestWidget> = (context, _widget, key) => ({
    ok: true,
    message: context.speed.toggle(key.address, context.failed),
});

/** A tap runs the test; a tap while it runs stops it. */
export class SpeedtestAction implements WidgetAction<SpeedtestWidget> {
    readonly gestures = { tap: measure };
}
