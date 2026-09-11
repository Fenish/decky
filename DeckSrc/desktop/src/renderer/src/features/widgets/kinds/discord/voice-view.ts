/*---------------------------------------------------------------
 * The views of Discord's keys (shared/widgets/discord.ts): the voice keys -
 * a channel's, the call's - made by voiceView, the device switchers by
 * deviceView, and the notifications key. Each draws the key's own icon when
 * it has nothing else to show, so Appearance picks and sizes it; a voice
 * key's layout and name are set there too. Their settings panel ends with
 * Discord's connection card.
 *--------------------------------------------------------------*/

import { createElement } from "react";
import type { WidgetState } from "../../../../../../shared/widgets";
import type {
    DeviceFlow,
    DiscordDeviceWidget,
    DiscordNotificationsWidget,
    VoiceWidget,
} from "../../../../../../shared/widgets/discord";
import { kindOf } from "../../../../../../shared/widgets/registry";
import { AppCard } from "../../../integrations/app-card";
import { drawChoice } from "../../choice-face";
import type { WidgetView } from "../widget-view";
import { drawInbox } from "./draw-inbox";
import { drawVoice } from "./draw-voice";
import { voiceHint, voiceLooks, voiceSettings } from "./voice-settings";

/** Discord's card, for a key with nothing else to set. */
const discordCard = () => createElement(AppCard, { id: "discord" });

/** A voice key's view: a channel's or the call's, told apart as they draw. */
export function voiceView<W extends VoiceWidget>(): WidgetView<W> {
    return {
        draw: drawVoice,
        settings: voiceSettings,
        hint: voiceHint,
        appearance: voiceLooks,
        icon: true,
        // Three people in, one speaking, for the style tiles: initials, as avatars have not come.
        sample: (): WidgetState => ({
            voice: {
                health: "ready",
                name: "General",
                joined: false,
                members: [
                    { id: "1", name: "Ada", speaking: true },
                    { id: "2", name: "Bo" },
                    { id: "3", name: "Cy" },
                ],
            },
        }),
    };
}

/** A made-up device of each flow, for the style tiles. */
function sampleDevice(flow: DeviceFlow): string {
    return flow === "input" ? "Microphone (HyperX Cloud II)" : "Headphones (Arctis 7 Game)";
}

/** A device switcher's view, for `flow`: a choice key's face (choice-face.ts). */
export function deviceView<W extends DiscordDeviceWidget>(flow: DeviceFlow): WidgetView<W> {
    return {
        draw: (ctx, widget, look, area, moment) =>
            drawChoice(ctx, look, area, kindOf(widget).icon, moment),
        settings: discordCard,
        hint: () =>
            `Shows the ${flow === "input" ? "microphone" : "output"} Discord uses, and a dot for ` +
            "each it could. Tap to move to the next one.",
        icon: true,
        sample: (): WidgetState => ({
            choice: { reachable: true, name: sampleDevice(flow), index: 1, count: 3 },
        }),
    };
}

export const inboxView: WidgetView<DiscordNotificationsWidget> = {
    draw: drawInbox,
    settings: discordCard,
    hint: () =>
        "Shows how many notifications Discord gave since your last tap, and who sent the last " +
        "one. Tap to open that conversation in Discord.",
    icon: true,
    sample: (): WidgetState => ({
        inbox: { health: "ready", unread: 3, from: { name: "Ada" } },
    }),
};
