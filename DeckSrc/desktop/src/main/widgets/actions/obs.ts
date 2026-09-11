import { OBS_TYPES } from "../../../shared/widgets/obs";
import type { ObsWidget } from "../../../shared/widgets/obs";
import type { GestureHandler, WidgetAction } from "./widget-action";

/** A touch arms the countdown before OBS starts or stops the output the key shows, or calls it off. */
const touch: GestureHandler<ObsWidget> = (context, widget, key) => ({
    ok: true,
    message: context.integrations.obs.touch(key.address, OBS_TYPES[widget.type], context.failed),
});

/** Recording and streaming alike: the output is the widget type's. */
export class ObsAction implements WidgetAction<ObsWidget> {
    readonly gestures = { tap: touch };
}
