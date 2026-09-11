/*---------------------------------------------------------------
 * The view of every sound level widget - the volume, the microphone - made
 * by levelView for the device the registry names. Each is an arc or a bar
 * the deck fills under the finger; only what DEVICES holds differs.
 *--------------------------------------------------------------*/

import type { WidgetState } from "../../../../../../shared/widgets";
import type { LevelWidget, SoundDevice } from "../../../../../../shared/widgets/level";
import type { WidgetView } from "../widget-view";
import { drawLevel, levelMuted } from "./draw-level";
import type { LevelIcons } from "./draw-level";
import { levelDial, levelPlace } from "./level-deck-look";
import { levelSettings } from "./level-settings";

/** What each device's key shows, and what its settings say. */
const DEVICES: Record<SoundDevice, { icons: LevelIcons; hint: string; sample: WidgetState }> = {
    speaker: {
        icons: { on: "volume", off: "volumeOff" },
        hint:
            "Swipe up or down on the key to set the PC's volume; it follows your finger. " +
            "Tap to mute or unmute.",
        sample: { level: 62, muted: false },
    },
    microphone: {
        icons: { on: "mic", off: "micOff" },
        hint:
            "Swipe up or down on the key to set your microphone's level. Tap to mute or " +
            "unmute; turning it never unmutes it. Grey while muted or with no microphone.",
        sample: { level: 70, muted: false },
    },
};

/**
 * The view of a level widget showing `device`. DEVICES is read as it draws,
 * never while the widget modules load: they import one another in a ring
 * (widget-view.ts).
 */
export function levelView<W extends LevelWidget>(device: SoundDevice): WidgetView<W> {
    const icons = (): LevelIcons => DEVICES[device].icons;
    return {
        draw: (ctx, widget, look, area, moment) =>
            drawLevel(ctx, widget.style, icons(), look, area, moment),
        settings: levelSettings,
        hint: () => DEVICES[device].hint,
        sample: () => ({ ...DEVICES[device].sample }),
        deckLook: {
            build: ({ look, widget, muted, width, height }) =>
                levelDial({ look, style: widget.style, icons: icons(), muted, width, height }),
            muted: levelMuted,
            place: (_widget, state) => levelPlace(state),
        },
    };
}
