import { isWidgetKey } from "../../shared/config";
import type { DeckEvent } from "../../shared/api";
import type { Lifecycle } from "../app/lifecycle";
import type { MainWindow } from "../app/main-window";
import type { RichPresence } from "../discord/presence";
import type { LogFile } from "../logging/log-file";
import type { DeckPages } from "../pages/deck-pages";
import type { PageSync } from "../pages/page-sync";
import type { Profile } from "../profile/profile";
import type { Workspace } from "../profile/workspace";
import type { DeckWheels } from "../widgets/deck-wheels";
import type { WidgetPresses } from "../widgets/presses";
import type { DeckSession } from "./session";

export interface DeckEventParts {
    lifecycle: Lifecycle;
    window: MainWindow;
    log: LogFile;
    session: DeckSession;
    profile: Profile;
    pages: DeckPages;
    pageSync: PageSync;
    wheels: DeckWheels;
    presses: WidgetPresses;
    workspace: Workspace;
    presence: RichPresence;
}

/** Taps on the same empty key, for the easter egg: this many, this close. */
const GAME_TAPS = 5;
const TAP_WINDOW_MS = 2500;

/** Counts taps in a row on one empty key; anything else starts it over. */
export class EmptyTaps {
    private at = "";
    private last = 0;
    private runs = 0;

    count(pageId: string, cell: number, now: number): number {
        const where = `${pageId}:${cell}`;
        this.runs = where === this.at && now - this.last < TAP_WINDOW_MS ? this.runs + 1 : 1;
        this.at = where;
        this.last = now;
        if (this.runs >= GAME_TAPS) this.runs = 0;
        return this.runs === 0 ? GAME_TAPS : this.runs;
    }
}

/**
 * What the deck says without being asked, taken where it belongs: a restart,
 * a wheel or dial coming to rest, a finger moving, a key pressed.
 */
export function deckEventHandler(parts: DeckEventParts): (event: DeckEvent) => void {
    const { lifecycle, window, log, session, profile, pages, pageSync } = parts;
    const { wheels, presses, workspace, presence } = parts;
    const forward = (event: DeckEvent): void => window.send("deck:event", event);
    const taps = new EmptyTaps();
    const handlers: { [K in DeckEvent["kind"]]: (event: Extract<DeckEvent, { kind: K }>) => void } =
        {
            reset: () => {
                log.write("BOOT: the deck started again");
                pageSync.resetDeviceCache();
            },
            // Finger movement turns wheels; the window has no use for it.
            wheel: (event) => {
                if (pages.deviceReady) wheels.wheelSettled(event.cell, event.index);
            },
            value: (event) => {
                if (pages.deviceReady) presses.widgetTurned(event.cell, event.value);
            },
            move: (event) => {
                if (pages.deviceReady) presses.widgetMove(event.cell, event.y);
            },
            key: (event) => {
                forward(event);
                const { status } = session;
                if (!pages.deviceReady && !(status.connected && status.identity.protocol < 2))
                    return;
                // Every press counts, for Decky's card on Discord.
                if (event.down) presence.press();
                const { config } = profile;
                const page =
                    status.connected && status.identity.protocol < 2
                        ? config.pages[event.page]
                        : config.pages.find((p) => p.id === config.activePageId);
                if (page && isWidgetKey(page, event.cell)) {
                    presses.widgetPress(page, event.cell, event.down);
                    return;
                }
                // Nothing is assigned here: five taps in a row on the same
                // empty key is the easter egg, and nothing else happens.
                if (page && event.down && !page.keys[String(event.cell)]) {
                    if (taps.count(page.id, event.cell, event.at) < GAME_TAPS) return;
                    void session
                        .serial(() => session.link.command("GAME snake", 2000))
                        .then((reply) => {
                            if (reply.ok)
                                forward({ kind: "game", over: false, score: 0, at: event.at });
                        })
                        .catch(() => {});
                    return;
                }
                if (page && event.down)
                    void workspace.runKey(page.id, event.cell).catch((error) =>
                        window.send("action:activity", {
                            at: Date.now(),
                            label: "Device action",
                            ok: false,
                            message: String(error),
                        }),
                    );
            },
            // The easter egg: the window shows the score, and the deck draws
            // its own page again the moment it is over.
            game: forward,
            page: forward,
            fallback: forward,
            ports: forward,
        };
    return (event) => {
        if (lifecycle.quitting) return;
        (handlers[event.kind] as (event: DeckEvent) => void)(event);
    };
}
