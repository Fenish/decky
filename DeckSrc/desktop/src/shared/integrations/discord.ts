import type { Integration } from "./integration";

/**
 * Discord, through its local RPC. Decky asks for it as Discord StreamKit -
 * Discord's own overlay app, whose permission any user can give; Discord
 * shows it by that name, and it lasts 7 days. Its keys: its voice switches,
 * camera and screen share as toggles that follow Discord, Leave call, and
 * its widgets (widgets/discord.ts).
 */
export const discordIntegration: Integration & { id: "discord" } = {
    id: "discord",
    name: "Discord",
    icon: "brand:Discord",
    fields: [],
    brief: {
        ready: (account) => (account ? `Connected as ${account}` : "Connected"),
        missing: () => "Discord isn't installed",
        closed: () => "Discord is closed",
        off: () => "Not authorized yet",
        denied: () => "Authorize Decky again",
    },
    says: {
        ready: (account) =>
            account ? `Connected to Discord as ${account}.` : "Connected to Discord.",
        missing: () => "Discord isn't installed on this PC. Discord keys follow it once it opens.",
        closed: () => "Discord is closed. Discord keys follow it once it opens.",
        off: () =>
            "Decky needs Discord's permission once: Authorize, then click Authorize in Discord.",
        denied: () =>
            "Discord's permission ran out or was taken back: Authorize, then click Authorize in Discord.",
    },
    help: "Discord asks as “Discord StreamKit Overlay”: that is how Decky reaches it. The permission lasts 7 days; Decky asks again after.",
    buttons: {
        ready: { label: "Authorize again", does: "authorize" },
        closed: { label: "Open Discord", does: "open" },
        missing: { label: "Get Discord", does: "download" },
        off: { label: "Authorize", does: "authorize" },
        denied: { label: "Authorize", does: "authorize" },
    },
    download: "https://discord.com/download",
    // Each a toggle when picked: OFF as Discord is at rest, ON in the colour of what it means.
    controls: {
        mute: {
            label: "Mute",
            icon: "Mic",
            on: { label: "Muted", icon: "MicOff", color: "#ff6b6b" },
            states: { off: "Unmuted", on: "Muted" },
        },
        deafen: {
            label: "Deafen",
            icon: "Headphones",
            on: { label: "Deafened", icon: "HeadphoneOff", color: "#ff6b6b" },
            states: { off: "Undeafened", on: "Deafened" },
        },
        camera: {
            label: "Camera",
            icon: "VideoOff",
            on: { label: "Camera on", icon: "Video", color: "#7fd49a" },
            states: { off: "Camera off", on: "Camera on" },
        },
        share: {
            label: "Screen share",
            icon: "ScreenShareOff",
            on: { label: "Sharing", icon: "ScreenShare", color: "#7fd49a" },
            states: { off: "Not sharing", on: "Sharing" },
        },
        noise: {
            label: "Noise suppression",
            icon: "AudioWaveform",
            on: { label: "Noise suppressed", icon: "AudioLines", color: "#7fd49a" },
            states: { off: "Suppression off", on: "Suppression on" },
        },
        echo: {
            label: "Echo cancellation",
            icon: "Waves",
            on: { label: "Echo cancelled", icon: "Waves", color: "#7fd49a" },
            states: { off: "Cancellation off", on: "Cancellation on" },
        },
        gain: {
            label: "Auto gain",
            icon: "Gauge",
            on: { label: "Auto gain on", icon: "Gauge", color: "#7fd49a" },
            states: { off: "Auto gain off", on: "Auto gain on" },
        },
        // ON while you are in a call: a tap leaves it.
        leave: {
            label: "Leave call",
            icon: "PhoneOff",
            on: { label: "Leave call", icon: "PhoneOff", color: "#ff6b6b" },
            states: { off: "Not in a call", on: "In a call" },
        },
    },
};
