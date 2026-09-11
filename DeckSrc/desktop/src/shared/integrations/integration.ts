/*---------------------------------------------------------------
 * Integrations: third-party apps Decky talks to - OBS Studio first. Each
 * declares who it is, the settings it needs, what is said of how Decky
 * stands with it and what its connection card's button does then; its
 * widgets name it as their `group`. Main talks to the app
 * (src/main/integrations/), and the window draws its picker page and its
 * connection card from this, so a new app needs no screens of its own.
 *--------------------------------------------------------------*/

/** Every integration, by id. */
export type IntegrationId = "obs" | "discord";

/**
 * How Decky stands with an app: not on this PC, installed but closed, open
 * with its API off, its password or sign-in refused, or connected.
 */
export type IntegrationHealth = "missing" | "closed" | "off" | "denied" | "ready";

/** One setting an app needs: text, or a secret - kept encrypted, never shown again. */
export interface IntegrationField {
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
    maxLength: number;
}

/**
 * The connection line's button in a standing: start the app, open its
 * download page, open its settings, or ask the app's permission.
 */
export interface IntegrationButton {
    label: string;
    does: "open" | "download" | "settings" | "authorize";
}

/**
 * Something of the app's a key can switch or do - Discord's mute, its Leave
 * call. A key with it as its action (`{ kind: "app" }`) presses it; as a
 * toggle key, its ON and OFF follow the app's own state, however it was
 * switched.
 */
export interface IntegrationControl {
    /** Its name, and the key's OFF look when picked: its title and KeyIcon name. */
    label: string;
    icon: string;
    /** The key's ON look when picked, which the picker shows it by. */
    on: { label: string; icon: string; color: string };
    /** Its two states as the window names them, where a toggle says OFF and ON: Unmuted, Muted. */
    states: { off: string; on: string };
}

export interface Integration {
    id: IntegrationId;
    /** As people know the app: OBS Studio. */
    name: string;
    /** Its icon (lucide), in the picker. */
    icon: string;
    fields: IntegrationField[];
    /** Each standing in a few words: the connection's one-line summary. */
    brief: Record<IntegrationHealth, (version: string) => string>;
    /** Each standing in full, and what to do about it: its settings dialog. */
    says: Record<IntegrationHealth, (version: string) => string>;
    /** Where in the app its settings are found. */
    help: string;
    /** What the connection line's button does in each standing. */
    buttons: Record<IntegrationHealth, IntegrationButton>;
    /** Where to get the app, for a PC without it (https). */
    download: string;
    /** What of the app keys can switch, by name. */
    controls?: Record<string, IntegrationControl>;
}

/** How Decky stands with an app, for the window. */
export interface IntegrationStatus {
    id: IntegrationId;
    health: IntegrationHealth;
    /** What the app says of itself once connected: OBS its version, Discord its account. */
    version: string;
    /** Its settings as saved: text fields' values; for a secret, only whether one is. */
    values: Record<string, string>;
    saved: Record<string, boolean>;
}
