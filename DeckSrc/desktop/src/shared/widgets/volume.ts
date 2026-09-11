import { levelKind } from "./level";
import type { LevelWidget } from "./level";

/** The PC's volume, turned on the deck. */
export type VolumeWidget = LevelWidget<"volume">;

export const volumeKind = levelKind({
    type: "volume",
    label: "Volume",
    icon: "Volume2",
    words: "sound audio speaker mute",
});
