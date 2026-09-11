import type { MicWidget } from "../../../../../../shared/widgets/mic";
import type { WidgetView } from "../widget-view";
import { drawMic } from "./draw-mic";

// It has no settings of its own: the panel only says what it shows.
export const micView: WidgetView<MicWidget> = {
    draw: drawMic,
    hint: () =>
        "Shows whether Windows has your microphone muted: red and struck through when it is. " +
        "Tap to mute or unmute.",
    sample: () => ({ muted: false }),
};
