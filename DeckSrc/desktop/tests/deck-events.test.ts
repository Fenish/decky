/*---------------------------------------------------------------
 * What the deck says without being asked: a nested page's Back key is Back,
 * not an empty key for the easter egg, and a deck that started again begins
 * at Home.
 *--------------------------------------------------------------*/

import { describe, expect, it, vi } from "vitest";
import { deckEventHandler } from "../src/main/deck/deck-events";
import type { DeckEventParts } from "../src/main/deck/deck-events";
import { BACK_CELL, homePageId } from "../src/shared/config";
import type { DeckConfig } from "../src/shared/config";

/** Home, and a page opened from it with nothing assigned: its Back key is implied. */
function profile(activePageId = "sub"): DeckConfig {
    return {
        version: 2,
        reducedMotion: false,
        activePageId,
        pages: [
            { id: "home", name: "Home", parentId: null, keys: {} },
            { id: "sub", name: "Sub", parentId: "home", keys: {} },
        ],
    };
}

/** The handler over stand-ins for the parts a press and a restart reach. */
function handlerFor(config: DeckConfig) {
    const runKey = vi.fn(async () => ({ ok: true, message: "" }));
    const home = vi.fn(async () => config);
    const command = vi.fn(async () => ({ ok: true, message: "OK game" }));
    const parts = {
        lifecycle: { quitting: false },
        window: { send: vi.fn(), sendIfOpen: vi.fn() },
        log: { write: vi.fn() },
        session: {
            status: { connected: true, identity: { protocol: 7 } },
            serial: (job: () => Promise<unknown>) => job(),
            link: { command },
        },
        profile: { config },
        pages: { deviceReady: true },
        pageSync: { resetDeviceCache: vi.fn() },
        presses: { widgetPress: vi.fn() },
        presence: { press: vi.fn() },
        workspace: { runKey, home },
    } as unknown as DeckEventParts;
    return { handle: deckEventHandler(parts), runKey, home, command };
}

/** Press a key `times` over, a moment apart, as the deck reports it. */
function press(handle: ReturnType<typeof deckEventHandler>, cell: number, times: number): void {
    for (let i = 0; i < times; i++) {
        const at = 1000 + i * 200;
        handle({ kind: "key", page: 1, cell, down: true, at });
        handle({ kind: "key", page: 1, cell, down: false, at: at + 50 });
    }
}

describe("a nested page's Back key", () => {
    it("goes back on every press", () => {
        const { handle, runKey } = handlerFor(profile());
        press(handle, BACK_CELL, 3);
        expect(runKey).toHaveBeenCalledTimes(3);
        expect(runKey).toHaveBeenCalledWith("sub", BACK_CELL);
    });

    it("never starts the easter egg", () => {
        const { handle, command } = handlerFor(profile());
        press(handle, BACK_CELL, 5);
        expect(command).not.toHaveBeenCalled();
    });

    it("leaves five taps on a key that really is empty to start it", () => {
        const { handle, command, runKey } = handlerFor(profile());
        press(handle, 3, 5);
        expect(command).toHaveBeenCalledWith("GAME snake", 2000);
        expect(runKey).not.toHaveBeenCalled();
    });
});

describe("where the deck starts", () => {
    it("is the first page", () => {
        expect(homePageId(profile())).toBe("home");
    });

    it("is Home again after the deck restarts", () => {
        const { handle, home } = handlerFor(profile());
        handle({ kind: "reset", at: 1000 });
        expect(home).toHaveBeenCalledTimes(1);
    });
});
