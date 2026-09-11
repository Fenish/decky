import type { WidgetKind } from "./widget-kind";

/** The PC's volume, turned on the deck: an arc or a bar. */
export type VolumeWidget = {
    type: "volume";
    style: "arc" | "bar";
};

export const volumeKind: WidgetKind<VolumeWidget> = {
    type: "volume",
    label: "Volume",
    icon: "Volume2",
    words: "sound audio speaker mute",
    defaults: () => ({ type: "volume", style: "arc" }),
    valid: (w) => w.style === "arc" || w.style === "bar",
    deckTurned: () => "dial",
    fingerTurns: () => true,
};
