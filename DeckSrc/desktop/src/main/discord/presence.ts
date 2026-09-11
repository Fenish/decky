/*---------------------------------------------------------------
 * Decky on Discord (Rich Presence), once Settings turns it on: "Watching
 * Decky", with what the user is doing - at the deck, editing keys, recording
 * or live in OBS, updating - their presses today, and for how long
 * (shared/presence; never a page's or a key's name). It is Decky's own
 * Discord application, over the local pipe (DiscordIpc); the card goes when
 * Decky quits or it is turned off. Discord closed, it is tried again now and
 * then.
 *
 * On or off, and today's presses, are kept on this PC in presence.json.
 *--------------------------------------------------------------*/

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { presenceCard } from "../../shared/presence";
import type { PresenceCard, PresenceFacts, PresenceStatus } from "../../shared/presence";
import { localDate } from "../../shared/widgets";
import { DiscordIpc } from "./discord-ipc";

/** Decky's Discord application: public, and all Rich Presence needs. */
export const DISCORD_APP_ID = "1548005754705813654";
/** The card's picture: art uploaded to that application under this name. */
const ART = "decky";
/** "Watching": a "Playing" card is hidden while another shows, or pushes out a game. */
const WATCHING = 3;
/** Discord takes about five updates in 20 s: one every 4 s at most. */
const SEND_GAP_MS = 4000;
/** How often the facts are looked at, and how long before Discord is tried again. */
const LOOK_MS = 2000;
const RETRY_MS = 15_000;
/** Today's presses are saved at most this often. */
const SAVE_MS = 10_000;

/** Where the facts come from. */
export interface PresenceSources {
    connected(): boolean;
    updating(): PresenceFacts["updating"];
    /** OBS's outputs Decky follows: since when each runs, or paused; null while off. */
    outputs(): Pick<PresenceFacts, "record" | "stream">;
}

/** The link to Discord, as this needs it (DiscordIpc). */
export interface PresenceLink {
    request(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
    onClose: (() => void) | null;
    close(): void;
}

export class RichPresence {
    private enabled = false;
    private day = "";
    private presses = 0;
    private link: PresenceLink | null = null;
    private connecting = false;
    private retryAt = 0;
    // The last card sent, as sent, and when; and the last Settings was told of.
    private sent = "";
    private sentAt = 0;
    private shown = "";
    private connectedSince: number | null = null;
    private editingSince: number | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private saving: Promise<void> = Promise.resolve();

    constructor(
        private readonly path: string,
        private readonly sources: PresenceSources,
        private readonly onStatus: (status: PresenceStatus) => void,
        private readonly connect: (clientId: string) => Promise<PresenceLink> = (id) =>
            DiscordIpc.connect(id),
    ) {}

    async load(): Promise<void> {
        try {
            const saved = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
            this.enabled = saved.enabled === true;
            if (saved.day === localDate(Date.now()) && Number.isInteger(saved.presses)) {
                this.day = saved.day;
                this.presses = Math.max(0, saved.presses as number);
            }
        } catch {
            // Nothing saved yet: off.
        }
        if (this.enabled) this.start();
    }

    status(): PresenceStatus {
        return {
            enabled: this.enabled,
            discord: this.link ? "connected" : "closed",
            card: this.enabled ? this.card() : null,
        };
    }

    /** On or off, from Settings. Off takes the card away at once. */
    async setEnabled(enabled: unknown): Promise<PresenceStatus> {
        if (typeof enabled !== "boolean") throw new Error("Invalid setting.");
        this.enabled = enabled;
        await this.save();
        if (enabled) this.start();
        else this.hide();
        this.publish();
        return this.status();
    }

    /** A key pressed on the deck: counted whether or not the card shows. */
    press(): void {
        this.rollDay();
        this.presses++;
        this.saveSoon();
        this.look();
    }

    /** A key being edited in the app, or no longer. */
    setEditing(editing: unknown): void {
        if (typeof editing !== "boolean") return;
        this.editingSince = editing ? (this.editingSince ?? Date.now()) : null;
        this.look();
    }

    /** Decky quitting: today's presses kept, the pipe let go (the card goes with it). */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            void this.save().catch(() => {});
        }
        const link = this.link;
        this.link = null;
        link?.close();
    }

    private start(): void {
        this.timer ??= setInterval(() => this.look(), LOOK_MS);
        this.look();
    }

    /** What is going on now, and the card for it - sent if it changed and Discord allows. */
    private look(): void {
        if (!this.enabled) return;
        const now = Date.now();
        this.rollDay();
        this.connectedSince = this.sources.connected() ? (this.connectedSince ?? now) : null;
        const card = this.card();
        // Settings shows the card as it would be, Discord open or not.
        const shown = JSON.stringify(card);
        if (shown !== this.shown) {
            this.shown = shown;
            this.publish();
        }
        if (!this.link) return this.reach(now);
        const activity = JSON.stringify(this.activity(card));
        if (activity === this.sent || now - this.sentAt < SEND_GAP_MS) return;
        this.sent = activity;
        this.sentAt = now;
        this.link
            .request("SET_ACTIVITY", { pid: process.pid, activity: JSON.parse(activity) })
            .catch(() => {
                // Sent again at the next look.
                this.sent = "";
            });
    }

    /** Try Discord, unless a try is under way or it was tried just now. */
    private reach(now: number): void {
        if (this.connecting || now < this.retryAt) return;
        this.connecting = true;
        this.connect(DISCORD_APP_ID).then(
            (link) => {
                this.connecting = false;
                if (!this.enabled) return link.close();
                this.link = link;
                this.sent = "";
                this.sentAt = 0;
                link.onClose = () => {
                    this.link = null;
                    this.retryAt = Date.now() + RETRY_MS;
                    this.publish();
                };
                this.publish();
                this.look();
            },
            () => {
                this.connecting = false;
                this.retryAt = Date.now() + RETRY_MS;
            },
        );
    }

    /** Take the card away, and let Discord go. */
    private hide(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        const link = this.link;
        this.link = null;
        this.sent = "";
        if (!link) return;
        link.onClose = null;
        void link
            .request("SET_ACTIVITY", { pid: process.pid })
            .catch(() => {})
            .finally(() => link.close());
    }

    private card(): PresenceCard {
        const facts: PresenceFacts = {
            connected: this.connectedSince,
            editing: this.editingSince,
            updating: this.sources.updating(),
            ...this.sources.outputs(),
            presses: this.presses,
        };
        return presenceCard(facts);
    }

    private activity(card: PresenceCard): Record<string, unknown> {
        return {
            type: WATCHING,
            details: card.details,
            ...(card.state ? { state: card.state } : {}),
            ...(card.since ? { timestamps: { start: card.since } } : {}),
            assets: { large_image: ART, large_text: "Decky" },
            instance: false,
        };
    }

    private publish(): void {
        this.onStatus(this.status());
    }

    /** A new day starts the presses again. */
    private rollDay(): void {
        const today = localDate(Date.now());
        if (today === this.day) return;
        this.day = today;
        this.presses = 0;
    }

    private saveSoon(): void {
        this.saveTimer ??= setTimeout(() => {
            this.saveTimer = null;
            void this.save().catch(() => {});
        }, SAVE_MS);
    }

    /** Saves one after another, so two never share the temporary file. */
    private save(): Promise<void> {
        const saved = JSON.stringify({
            enabled: this.enabled,
            day: this.day,
            presses: this.presses,
        });
        this.saving = this.saving
            .catch(() => {})
            .then(async () => {
                await mkdir(dirname(this.path), { recursive: true });
                await writeFile(`${this.path}.tmp`, saved, "utf8");
                await rename(`${this.path}.tmp`, this.path);
            });
        return this.saving;
    }
}
