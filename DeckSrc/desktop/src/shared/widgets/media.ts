import type { Track } from "../widgets";
import type { WidgetKind } from "./widget-kind";

/** What is playing, in any app Windows knows of: cover, title, progress. */
export type MediaWidget = {
    type: "media";
    style: "cover" | "card";
};

/** Where a track is now: its position moves on by itself while it plays. */
export function trackPosition(track: Track, now: number): number {
    return track.playing
        ? Math.min(track.duration || Infinity, track.position + Math.max(0, now - track.at))
        : track.position;
}

export const mediaKind: WidgetKind<MediaWidget> = {
    type: "media",
    label: "Now playing",
    icon: "Music",
    words: "music song spotify track player media currently playing pause",
    defaults: () => ({ type: "media", style: "cover" }),
    valid: (w) => w.style === "cover" || w.style === "card",
    designs: (w) => (["cover", "card"] as const).map((style) => ({ ...w, style })),
    nextChange: (_widget, state, now) => {
        // The progress bar moves every second while the track plays.
        const track = state?.track;
        if (!track?.playing) return null;
        return 1000 - (trackPosition(track, now) % 1000);
    },
};
