import type { WidgetKind } from "./widget-kind";

/** Whether the microphone is muted, as Windows has it. */
export type MicWidget = {
    type: "mic";
};

export const micKind: WidgetKind<MicWidget> = {
    type: "mic",
    label: "Microphone",
    icon: "Mic",
    words: "mic mute voice",
    defaults: () => ({ type: "mic" }),
    valid: () => true,
    // It had styles once; there is one.
    retire: (value) => {
        delete value.style;
    },
};
