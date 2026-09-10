import type { DeckIdentity } from "./api";

export type Transport = "usb" | "wifi";

/** How the desktop is talking to the deck. Network links are addressed as `tcp://`. */
export function transportOf(identity: DeckIdentity): Transport {
    return identity.portPath.startsWith("tcp:") ? "wifi" : "usb";
}

/**
 * Whether a reconnect replaced a lost USB link with Wi-Fi.
 *
 * USB always comes first and Wi-Fi is only the fallback, so this is the one
 * change of transport the user did not cause by plugging the cable in - and
 * it happens inside a single status check, so without an announcement it
 * would look like nothing happened at all.
 */
export function fellBackToWifi(before: Transport | null, after: Transport | null): boolean {
    return before === "usb" && after === "wifi";
}
