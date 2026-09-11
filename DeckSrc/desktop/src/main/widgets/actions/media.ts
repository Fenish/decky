import type { Reply } from "../../../shared/api";
import type { MediaWidget } from "../../../shared/widgets/media";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** Play or pause with a tap, the next track with a hold, in whatever is playing. */
export class MediaAction implements WidgetAction<MediaWidget> {
    press(
        context: WidgetActionContext,
        _widget: MediaWidget,
        _key: WidgetKey,
        hold: boolean,
    ): Reply {
        context.feeds.control(hold ? "media-next" : "media-toggle").catch(context.failed);
        return { ok: true, message: hold ? "Next track." : "Play or pause." };
    }
}
