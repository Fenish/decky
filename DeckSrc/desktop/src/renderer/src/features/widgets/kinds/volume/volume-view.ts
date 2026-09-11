import type { VolumeWidget } from "../../../../../../shared/widgets/volume";
import type { WidgetView } from "../widget-view";
import { drawVolume } from "./draw-volume";
import { volumeMuted, volumePlace, volumeWheel } from "./volume-deck-look";
import { volumeHint, volumeSettings } from "./volume-settings";

export const volumeView: WidgetView<VolumeWidget> = {
    draw: drawVolume,
    settings: volumeSettings,
    hint: volumeHint,
    sample: () => ({ level: 62, muted: false }),
    deckLook: { build: volumeWheel, muted: volumeMuted, place: volumePlace },
};
