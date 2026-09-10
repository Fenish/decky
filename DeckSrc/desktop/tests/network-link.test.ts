import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DeckLink, crc32 } from "../src/main/device/serial";
import { SECURE_MARKER, SecureChannel } from "../src/main/device/secure-channel";

const SECRET = "a".repeat(64);
const NONCE = "b".repeat(64);
const ID_REPLY =
    "OK id decky 7 a4cb8fcdd274 cells=15 cols=5 rows=3 w=118 h=123 pages=64 cache=8 fw=1.2.3\n";

interface DeckOptions {
    /** Sent before the challenge, in plain text. */
    preamble?: string;
    /** Challenge without the encryption marker, like firmware before protocol 7. */
    plainText?: boolean;
    /** Answer AUTH with a wrong server proof. */
    badProof?: boolean;
    /** Extra encrypted bytes sent in the same packet as "OK auth". */
    afterAuth?: string;
    onLine?: (line: string, send: (text: string | Buffer) => void, deck: FakeDeck) => void;
}

interface FakeDeck {
    lines: string[];
    socket: Socket | null;
    /** Enter binary mode: the next `count` bytes are delivered to `onBlock` in `blockSize` pieces. */
    expectBinary: (
        count: number,
        blockSize: number,
        onBlock: (block: Buffer, last: boolean) => void,
    ) => void;
}

/** A stand-in for the firmware's network side, speaking the same framing. */
async function fakeDeck(
    options: DeckOptions,
): Promise<{ server: Server; port: number; deck: FakeDeck }> {
    const deck: FakeDeck = { lines: [], socket: null, expectBinary: () => {} };
    const server = createServer((socket) => {
        deck.socket = socket;
        socket.setNoDelay(true);
        socket.write(
            `${options.preamble ?? ""}CHALLENGE ${NONCE}${options.plainText ? "" : ` ${SECURE_MARKER}`}\n`,
        );
        let channel: SecureChannel | null = null;
        let text = Buffer.alloc(0);
        let binary: {
            remaining: number;
            size: number;
            onBlock: (b: Buffer, last: boolean) => void;
        } | null = null;
        const send = (data: string | Buffer): void => {
            const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
            socket.write(channel ? channel.seal(bytes) : bytes);
        };
        deck.expectBinary = (count, size, onBlock) => {
            binary = { remaining: count, size, onBlock };
        };
        const drain = (): void => {
            for (;;) {
                if (binary) {
                    const count = Math.min(binary.size, binary.remaining);
                    if (text.length < count) return;
                    const block = text.subarray(0, count);
                    text = text.subarray(count);
                    binary.remaining -= count;
                    const current = binary;
                    if (!binary.remaining) binary = null;
                    current.onBlock(block, !current.remaining);
                    continue;
                }
                const end = text.indexOf(10);
                if (end < 0) return;
                const line = text.subarray(0, end).toString();
                text = text.subarray(end + 1);
                deck.lines.push(line);
                options.onLine?.(line, send, deck);
            }
        };
        socket.on("data", (data) => {
            if (!channel) {
                text = Buffer.concat([text, data]);
                const end = text.indexOf(10);
                if (end < 0) return;
                const line = text.subarray(0, end).toString();
                text = text.subarray(end + 1);
                deck.lines.push(line);
                const proof = createHmac("sha256", SECRET).update(NONCE).digest("hex");
                if (line !== `AUTH ${proof}`) {
                    socket.end("ERR authentication failed\n");
                    return;
                }
                const serverProof = options.badProof
                    ? "0".repeat(64)
                    : createHmac("sha256", SECRET).update(`server:${NONCE}`).digest("hex");
                if (options.plainText) {
                    socket.write(`OK auth ${serverProof}\n`);
                    return;
                }
                channel = SecureChannel.deck(SECRET, NONCE);
                const early = options.afterAuth
                    ? channel.seal(Buffer.from(options.afterAuth))
                    : Buffer.alloc(0);
                socket.write(Buffer.concat([Buffer.from(`OK auth ${serverProof}\n`), early]));
                // Anything left in `text` arrived before the channel existed; there should be none.
                text = Buffer.alloc(0);
                return;
            }
            try {
                for (const payload of channel.open(data)) text = Buffer.concat([text, payload]);
            } catch {
                socket.destroy();
                return;
            }
            drain();
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: (server.address() as AddressInfo).port, deck };
}

const stop = (server: Server): Promise<void> =>
    new Promise((resolve) => server.close(() => resolve()));

describe("paired network transport", () => {
    it.each([128, 4096])(
        "uploads binary artwork over the encrypted link in %i-byte blocks",
        async (blockSize) => {
            const chunks: Buffer[] = [];
            const { server, port } = await fakeDeck({
                onLine: (line, send, deck) => {
                    if (line === "ID") send(ID_REPLY);
                    else if (line.startsWith("PUSH ")) {
                        deck.expectBinary(Number(line.split(" ")[2]), blockSize, (block, last) => {
                            chunks.push(block);
                            send(last ? "A\nOK image\n" : "A\n");
                        });
                        send(blockSize === 128 ? "READY\n" : `READY ${blockSize}\n`);
                    }
                },
            });
            const link = new DeckLink();
            try {
                const identity = await link.identifyNetwork("127.0.0.1", SECRET, port);
                expect(identity?.protocol).toBe(7);
                expect(identity?.firmwareVersion).toBe("1.2.3");
                const payload = Uint8Array.from({ length: 118 * 123 * 2 }, (_, i) => i % 256);
                expect((await link.push(0, payload, () => {})).ok).toBe(true);
                expect(crc32(Buffer.concat(chunks))).toBe(crc32(payload));
                expect(chunks).toHaveLength(Math.ceil(payload.length / blockSize));
            } finally {
                await link.close();
                await stop(server);
            }
        },
    );

    it.each([true, false])("authenticates both endpoints (valid pairing=%s)", async (valid) => {
        const { server, port, deck } = await fakeDeck({
            preamble: "EV 0 1 DOWN\n",
            badProof: !valid,
            onLine: (line, send) => {
                if (line === "ID") send(ID_REPLY);
                else if (line.startsWith("STATE")) send("EV 0 1 DOWN\nOK state 0 mask=3 cells=1\n");
                else send("ERR unexpected\n");
            },
        });
        const link = new DeckLink(),
            events = vi.fn();
        link.onEvent = events;
        try {
            const identity = await link.identifyNetwork("127.0.0.1", SECRET, port);
            // A key event before authentication is not trusted.
            expect(events).not.toHaveBeenCalled();
            if (valid) {
                expect(identity?.protocol).toBe(7);
                expect(await link.stillAttached()).toBe(true);
                expect((await link.command("STATE 0 123 3")).ok).toBe(true);
                expect(events).toHaveBeenCalledOnce();
            } else {
                expect(identity).toBeNull();
                expect(deck.lines).toHaveLength(1);
            }
        } finally {
            await link.close();
            await stop(server);
        }
    });

    it("refuses firmware that would talk in plain text after pairing", async () => {
        const { server, port, deck } = await fakeDeck({ plainText: true });
        const link = new DeckLink();
        try {
            expect(await link.identifyNetwork("127.0.0.1", SECRET, port)).toBeNull();
            expect(link.wifiRefusal).toBe("insecure-firmware");
            // It never even sends its proof to such a device.
            expect(deck.lines).toHaveLength(0);
        } finally {
            await link.close();
            await stop(server);
        }
    });

    it("decodes encrypted bytes that share a packet with the handshake reply", async () => {
        const { server, port } = await fakeDeck({
            afterAuth: "EV 0 2 DOWN\n",
            onLine: (line, send) => {
                if (line === "ID") send(ID_REPLY);
            },
        });
        const link = new DeckLink(),
            events = vi.fn();
        link.onEvent = events;
        try {
            expect(await link.identifyNetwork("127.0.0.1", SECRET, port)).not.toBeNull();
            expect(events).toHaveBeenCalledWith(
                expect.objectContaining({ kind: "key", cell: 2, down: true }),
            );
        } finally {
            await link.close();
            await stop(server);
        }
    });

    it("drops the connection when a frame from the deck has been tampered with", async () => {
        const { server, port, deck } = await fakeDeck({
            onLine: (line, send) => {
                if (line === "ID") send(ID_REPLY);
            },
        });
        const link = new DeckLink();
        try {
            expect(await link.identifyNetwork("127.0.0.1", SECRET, port)).not.toBeNull();
            // Forge an "EV" frame with a key the attacker does not have.
            const forged = SecureChannel.deck("f".repeat(64), NONCE).seal(
                Buffer.from("EV 0 5 DOWN\n"),
            );
            deck.socket!.write(forged);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(await link.stillAttached()).toBe(false);
        } finally {
            await link.close();
            await stop(server);
        }
    });
});
