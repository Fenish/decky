import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD, SecureChannel, sessionKeys } from "../src/main/device/secure-channel";

const SECRET = "a".repeat(64);
const CHALLENGE = "0123456789abcdef".repeat(4);

const pair = (): { desktop: SecureChannel; deck: SecureChannel } => ({
    desktop: SecureChannel.desktop(SECRET, CHALLENGE),
    deck: SecureChannel.deck(SECRET, CHALLENGE),
});

describe("secure Wi-Fi framing", () => {
    it("carries bytes both ways, however the socket splits them", () => {
        const { desktop, deck } = pair();
        const wire = Buffer.concat([
            desktop.seal(Buffer.from("ID\n")),
            desktop.seal(Buffer.from("PING\n")),
        ]);
        const received: Buffer[] = [];
        for (let i = 0; i < wire.length; i += 3)
            received.push(...deck.open(wire.subarray(i, i + 3)));
        expect(Buffer.concat(received).toString()).toBe("ID\nPING\n");

        const reply = deck.seal(Buffer.from("OK ping online=1\n"));
        expect(Buffer.concat(desktop.open(reply)).toString()).toBe("OK ping online=1\n");
    });

    it("lays frames out as length, ciphertext, tag, splitting at the firmware's buffer size", () => {
        const { desktop } = pair();
        const data = Buffer.alloc(MAX_PAYLOAD + 10, 7);
        const wire = desktop.seal(data);
        expect(wire.readUInt16BE(0)).toBe(MAX_PAYLOAD);
        expect(wire.readUInt16BE(2 + MAX_PAYLOAD + 16)).toBe(10);
        expect(wire.length).toBe(2 * (2 + 16) + data.length);
    });

    it("derives distinct keys per direction and per connection", () => {
        const a = sessionKeys(SECRET, CHALLENGE);
        const b = sessionKeys(SECRET, "f".repeat(64));
        expect(a.toDeck.equals(a.toDesktop)).toBe(false);
        expect(a.toDeck.equals(b.toDeck)).toBe(false);
        expect(a.toDeck.length).toBe(16);
    });

    it("rejects a frame altered in flight", () => {
        const { desktop, deck } = pair();
        const wire = desktop.seal(Buffer.from("PUSH 3 29028 12345\n"));
        wire[5] ^= 0x01;
        expect(() => deck.open(wire)).toThrow(/authentication/);
    });

    it("rejects frames from anyone without the pairing secret", () => {
        const intruder = SecureChannel.desktop("b".repeat(64), CHALLENGE);
        const { deck } = pair();
        expect(() => deck.open(intruder.seal(Buffer.from("BLANK 0\n")))).toThrow(/authentication/);
    });

    it("rejects a replayed frame and frames delivered out of order", () => {
        const { desktop, deck } = pair();
        const first = desktop.seal(Buffer.from("A"));
        const second = desktop.seal(Buffer.from("B"));
        deck.open(first);
        expect(() => deck.open(first)).toThrow(/authentication/);

        const fresh = pair();
        const one = fresh.desktop.seal(Buffer.from("1"));
        const two = fresh.desktop.seal(Buffer.from("2"));
        expect(() => fresh.deck.open(two)).toThrow(/authentication/);
        expect(one.length).toBe(second.length);
    });

    it("rejects a frame reflected back to the side that sent it", () => {
        const { desktop } = pair();
        // A faked key event would have to come from the deck's direction; the
        // desktop's own frames, echoed back, must not pass as the deck's.
        expect(() => desktop.open(desktop.seal(Buffer.from("EV 0 3 DOWN\n")))).toThrow(
            /authentication/,
        );
    });
});
