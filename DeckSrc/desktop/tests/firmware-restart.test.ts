/*---------------------------------------------------------------
 * A firmware install as the window sees it: the deck is offline while it is
 * written - said at once, not after the install lets go of the link - and a
 * freshly written deck is given time to start before it counts as silent.
 *--------------------------------------------------------------*/

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ safeStorage: {} }));

import { DeckSession } from "../src/main/deck/session";
import type { DeckIdentity } from "../src/shared/api";

function newSession(): DeckSession {
    return new DeckSession(
        { send: vi.fn(), sendIfOpen: vi.fn() } as never,
        { quitting: false } as never,
        { write: vi.fn() } as never,
    );
}

/** What a promise gives within `ms`, or "still waiting". */
function within<T>(promise: Promise<T>, ms: number): Promise<T | "still waiting"> {
    return Promise.race([
        promise,
        new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), ms)),
    ]);
}

describe("while firmware is written", () => {
    it("says the deck is offline at once, though the install holds the link", async () => {
        const session = newSession();
        let finish!: () => void;
        void session.serial(() => new Promise<void>((resolve) => (finish = resolve)));
        session.flashing = true;
        expect(await within(session.check(), 100)).toEqual({ connected: false });
        finish();
    });
});

describe("a deck that was just written", () => {
    it("is asked until it answers, then let go for the next check", async () => {
        const session = newSession();
        const identity = { serial: "a4cb8fcdd274" } as DeckIdentity;
        const identify = vi
            .spyOn(session.link, "identify")
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(identity);
        const close = vi.spyOn(session.link, "close").mockResolvedValue();
        expect(await session.awaitDeck("COM5", 1000, 5)).toBe(true);
        expect(identify).toHaveBeenCalledTimes(3);
        expect(identify).toHaveBeenCalledWith("COM5");
        expect(close).toHaveBeenCalled();
    });

    it("stops asking once the wait is over", async () => {
        const session = newSession();
        vi.spyOn(session.link, "identify").mockResolvedValue(null);
        vi.spyOn(session.link, "close").mockResolvedValue();
        expect(await session.awaitDeck("COM5", 40, 5)).toBe(false);
    });
});
