import type { IntegrationHealth } from "../integrations/integration";
import { text } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/**
 * Discord's widgets (src/main/integrations/discord/ keeps them current):
 *
 *  - voice keys: a channel you pick (discord-channel) or the call you are in
 *    (discord-call) - who is in it as avatars, whether you are, who speaks.
 *    A tap joins the channel, or leaves the call. Both are made by voiceKind
 *    and look alike, set in the key's Appearance: a layout, the name or not.
 *  - device switchers: the microphone (discord-input) or output
 *    (discord-output) Discord uses; a tap moves to the next. Made by
 *    deviceKind; each is a choice key (choice.ts).
 *  - discord-notifications: how many notifications came since the last tap,
 *    and the last one's sender; a tap opens that conversation.
 *
 * Each draws the key's own icon when it has nothing else to show.
 */

/** How a voice key places avatars: a square grid, a row, or a stack overlapping as Discord's. */
export type VoiceLayout = "grid" | "row" | "stack";
export const VOICE_LAYOUTS: readonly VoiceLayout[] = ["grid", "row", "stack"];

/** A voice key's looks, set in its Appearance tab. */
export interface VoiceLooks {
    layout?: VoiceLayout;
    /** The channel's name under its people; shown unless false. */
    showName?: boolean;
}

/** A channel you pick, by its ID; `name` is its name as it was picked, for the editor. */
export type DiscordChannelWidget = VoiceLooks & {
    type: "discord-channel";
    channel: string;
    name?: string;
};
/** The call you are in, whichever it is. */
export type DiscordCallWidget = VoiceLooks & { type: "discord-call" };
export type VoiceWidget = DiscordChannelWidget | DiscordCallWidget;

/** Which of Discord's devices: what you speak into, or what you hear. */
export type DeviceFlow = "input" | "output";
export type DiscordDeviceWidget = { type: "discord-input" } | { type: "discord-output" };
export const DEVICE_FLOWS: Record<DiscordDeviceWidget["type"], DeviceFlow> = {
    "discord-input": "input",
    "discord-output": "output",
};

export type DiscordNotificationsWidget = { type: "discord-notifications" };

/** Every Discord widget: the keys Discord keeps current. */
export type DiscordWidget = VoiceWidget | DiscordDeviceWidget | DiscordNotificationsWidget;

/** One person in a voice channel: their name there, their avatar once fetched, whether they speak. */
export interface VoiceMember {
    id: string;
    name: string;
    avatar?: string;
    speaking?: boolean;
}

/** What Discord says of the channel a voice key shows. */
export interface VoiceChannel {
    health: IntegrationHealth;
    name: string;
    members: VoiceMember[];
    /** Whether you are in it. */
    joined: boolean;
}

/** Discord's notifications, for a notifications key. "denied" also when the permission lacks them. */
export interface DiscordInbox {
    health: IntegrationHealth;
    /** How many came since the key was last tapped. */
    unread: number;
    /** The last one's sender: their name, and their avatar once fetched. */
    from?: { name: string; avatar?: string };
}

/** A Discord id: a snowflake, 17-20 digits these days. */
export const SNOWFLAKE = /^\d{15,21}$/;

const looksValid = (w: VoiceLooks): boolean =>
    (w.layout === undefined || VOICE_LAYOUTS.includes(w.layout)) &&
    (w.showName === undefined || typeof w.showName === "boolean");

/** What a Discord widget type says of itself in the picker, and what else it holds. */
interface DiscordName<W extends DiscordWidget> {
    type: W["type"];
    label: string;
    icon: string;
    words: string;
    defaults: () => W;
    valid: (widget: W) => boolean;
}

/** A Discord key's kind: Discord's events redraw it; nothing changes by the clock. */
function discordKind<W extends DiscordWidget>(name: DiscordName<W>): WidgetKind<W> {
    return {
        type: name.type,
        label: name.label,
        icon: name.icon,
        words: name.words,
        group: "discord",
        defaults: name.defaults,
        valid: name.valid,
        nextChange: () => null,
    } as WidgetKind<W>;
}

/** A voice key's kind: its looks are checked besides what it holds. */
export function voiceKind<W extends VoiceWidget>(name: DiscordName<W>): WidgetKind<W> {
    return discordKind({ ...name, valid: (w) => looksValid(w) && name.valid(w) });
}

/** A device switcher's kind, for `flow`. */
export function deviceKind<W extends DiscordDeviceWidget>(
    name: Omit<DiscordName<W>, "defaults" | "valid">,
): WidgetKind<W> {
    return discordKind<W>({
        ...name,
        defaults: () => ({ type: name.type }) as W,
        valid: () => true,
    });
}

export const discordChannelKind = voiceKind<DiscordChannelWidget>({
    type: "discord-channel",
    label: "Voice channel",
    icon: "Users",
    words: "discord voice channel call join leave members avatars",
    defaults: () => ({ type: "discord-channel", channel: "" }),
    // Empty until a channel is picked: the key says so.
    valid: (w) =>
        typeof w.channel === "string" &&
        (w.channel === "" || SNOWFLAKE.test(w.channel)) &&
        (w.name === undefined || text(w.name, 100, true)),
});

export const discordCallKind = voiceKind<DiscordCallWidget>({
    type: "discord-call",
    label: "Current call",
    icon: "PhoneCall",
    words: "discord call current voice speaking talking leave",
    defaults: () => ({ type: "discord-call" }),
    valid: () => true,
});

export const discordInputKind = deviceKind<{ type: "discord-input" }>({
    type: "discord-input",
    label: "Mic switcher",
    icon: "Mic",
    words: "discord microphone mic input device switch headset",
});

export const discordOutputKind = deviceKind<{ type: "discord-output" }>({
    type: "discord-output",
    label: "Output switcher",
    icon: "Headphones",
    words: "discord output headset headphones speakers device switch",
});

export const discordNotificationsKind = discordKind<DiscordNotificationsWidget>({
    type: "discord-notifications",
    label: "Notifications",
    icon: "Bell",
    words: "discord notifications messages mentions dm unread",
    defaults: () => ({ type: "discord-notifications" }),
    valid: () => true,
});
