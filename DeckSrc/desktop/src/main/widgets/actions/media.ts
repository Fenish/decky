import type { MediaWidget } from "../../../shared/widgets/media";
import type { MediaControl } from "../feeds";
import type { GestureHandler, WidgetAction } from "./widget-action";

/** A handler that sends `control` to whatever is playing, saying `message`. */
function control(what: MediaControl, message: string): GestureHandler<MediaWidget> {
    return (context) => {
        context.feeds.control(what).catch(context.failed);
        return { ok: true, message };
    };
}

/**
 * Whatever is playing: a tap plays or pauses, a double tap skips to the next
 * track, and a triple tap or a hold goes back to the previous one.
 */
export class MediaAction implements WidgetAction<MediaWidget> {
    readonly gestures = {
        tap: control("media-toggle", "Play or pause."),
        double: control("media-next", "Next track."),
        triple: control("media-previous", "Previous track."),
        hold: control("media-previous", "Previous track."),
    };
}
