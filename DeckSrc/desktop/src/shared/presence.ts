/*---------------------------------------------------------------
 * Decky on Discord (Rich Presence): what friends see - "Watching Decky",
 * a line on what the user is doing, one of their presses today, and how long
 * it has been going. Never a page's or a key's name. Main keeps the facts and
 * talks to Discord (src/main/discord/); this turns the facts into the card.
 *--------------------------------------------------------------*/

/** What is going on, as the card needs it. Times are ms since 1970. */
export interface PresenceFacts {
    /** Since when the deck is connected; null while it is not. */
    connected: number | null;
    /** Since when a key is being edited in the app. */
    editing: number | null;
    /** Decky putting new firmware on the deck, or updating itself. */
    updating: "deck" | "app" | null;
    /** OBS recording or streaming, as Decky follows it: since when, or paused. */
    record: { since: number } | "paused" | null;
    stream: { since: number } | null;
    /** Presses on the deck today. */
    presses: number;
}

/** The card: its two lines, and since when its timer counts (none without). */
export interface PresenceCard {
    details: string;
    state?: string;
    since?: number;
}

/** Whether Decky shows on Discord, whether Discord is there, and the card friends see. */
export interface PresenceStatus {
    enabled: boolean;
    discord: "connected" | "closed";
    card: PresenceCard | null;
}

function pressLine(presses: number): string | undefined {
    if (presses <= 0) return undefined;
    return presses === 1 ? "1 press today" : `${presses.toLocaleString("en-US")} presses today`;
}

/** Each scene, most telling first: the card is the first whose moment it is. */
const SCENES: {
    when: (facts: PresenceFacts) => boolean;
    card: (facts: PresenceFacts) => PresenceCard;
}[] = [
    { when: (f) => f.updating === "deck", card: () => ({ details: "Updating the deck" }) },
    { when: (f) => f.updating === "app", card: () => ({ details: "Updating Decky" }) },
    {
        when: (f) => f.stream !== null,
        card: (f) => ({ details: "Live", state: pressLine(f.presses), since: f.stream!.since }),
    },
    {
        when: (f) => f.record === "paused",
        card: (f) => ({ details: "Recording paused", state: pressLine(f.presses) }),
    },
    {
        when: (f) => f.record !== null,
        card: (f) => ({
            details: "Recording",
            state: pressLine(f.presses),
            since: (f.record as { since: number }).since,
        }),
    },
    {
        when: (f) => f.editing !== null,
        card: (f) => ({ details: "Editing keys", state: pressLine(f.presses), since: f.editing! }),
    },
    { when: (f) => f.connected === null, card: () => ({ details: "Deck disconnected" }) },
    {
        when: () => true,
        card: (f) => ({ details: "At the deck", state: pressLine(f.presses), since: f.connected! }),
    },
];

export function presenceCard(facts: PresenceFacts): PresenceCard {
    const card = SCENES.find((scene) => scene.when(facts))!.card(facts);
    // Lines left out are left out, not sent empty.
    return Object.fromEntries(
        Object.entries(card).filter(([, value]) => value !== undefined),
    ) as PresenceCard;
}
