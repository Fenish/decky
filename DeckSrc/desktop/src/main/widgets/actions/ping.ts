import type { PingWidget } from "../../../shared/widgets/ping";
import type { GestureHandler, WidgetAction } from "./widget-action";

const pingNow: GestureHandler<PingWidget> = (context, widget, key) => {
    context.pings.now(key.address);
    return { ok: true, message: `Pinging ${widget.host}.` };
};

/** A tap pings at once; pings otherwise run on their own interval. */
export class PingAction implements WidgetAction<PingWidget> {
    readonly gestures = { tap: pingNow };
}
