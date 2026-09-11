import { levelKind } from "./level";
import type { LevelWidget } from "./level";
import type { WidgetKind } from "./widget-kind";

/** The microphone's level, turned on the deck as the volume is. */
export type MicWidget = LevelWidget<"mic">;

export const micKind: WidgetKind<MicWidget> = {
    ...levelKind({
        type: "mic",
        label: "Microphone",
        icon: "Mic",
        words: "mic mute voice microphone level",
    }),
    // It once showed only its mute, in styles since gone: those become arcs.
    retire: (value) => {
        if (value.style !== "arc" && value.style !== "bar") value.style = "arc";
    },
};
