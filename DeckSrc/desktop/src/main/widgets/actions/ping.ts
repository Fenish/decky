import type { Reply } from "../../../shared/api";
import type { PingWidget } from "../../../shared/widgets/ping";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** A tap pings at once; pings otherwise run on their own interval. */
export class PingAction implements WidgetAction<PingWidget> {
    press(context: WidgetActionContext, widget: PingWidget, key: WidgetKey, hold: boolean): Reply {
        if (hold) return { ok: true, message: "Pings run on their own." };
        context.pings.now(key.address);
        return { ok: true, message: `Pinging ${widget.host}.` };
    }
}
