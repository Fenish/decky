import type { MediaWidget } from "../../../../../../shared/widgets/media";
import type { WidgetView } from "../widget-view";
import { drawMedia } from "./draw-media";
import { mediaHint, mediaSettings } from "./media-settings";

export const mediaView: WidgetView<MediaWidget> = {
    draw: drawMedia,
    settings: mediaSettings,
    hint: mediaHint,
    sample: (now) => ({
        track: {
            title: "Midnight City",
            artist: "M83",
            playing: true,
            position: 95_000,
            duration: 243_000,
            at: now,
        },
    }),
};
