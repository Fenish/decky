/*---------------------------------------------------------------
 * Encrypted framing for a paired Wi-Fi connection.
 *
 * After the challenge-response handshake, every byte in either direction is
 * sent as an AES-128-GCM frame:
 *
 *     [payload length, u16 big-endian][ciphertext][16-byte tag]
 *
 * Each direction has its own key - the first 16 bytes of
 * HMAC-SHA256(pairing secret, label + challenge) - and its own frame counter.
 * The nonce is the direction and the counter and is never sent, so a frame
 * that is altered, injected, replayed or reordered fails to authenticate and
 * the connection is dropped. Without this, someone on the same network who
 * could inject into the TCP stream could send commands to the deck, or fake
 * key presses that make this PC run the actions bound to them.
 *
 * The firmware side is firmware/src/security/secure_link.cpp; the two must agree byte
 * for byte, and tests/secure-channel.test.ts pins the format.
 *--------------------------------------------------------------*/

import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

/** Appended to the deck's challenge when it speaks this framing. */
export const SECURE_MARKER = "aesgcm1";
/** Largest payload in one frame; matches the firmware's buffers. */
export const MAX_PAYLOAD = 4096;
export const FROM_DESKTOP = 1;
export const FROM_DECK = 2;
const TAG_BYTES = 16;

/** One AES-128 key per direction, from the pairing secret and this connection's challenge. */
export function sessionKeys(
    secret: string,
    challenge: string,
): { toDeck: Buffer; toDesktop: Buffer } {
    const key = (label: string): Buffer =>
        createHmac("sha256", secret)
            .update(label + challenge)
            .digest()
            .subarray(0, 16);
    return { toDeck: key("decky c2s "), toDesktop: key("decky s2c ") };
}

function nonce(direction: number, counter: bigint): Buffer {
    const iv = Buffer.alloc(12);
    iv.writeUInt32BE(direction, 0);
    iv.writeBigUInt64BE(counter, 4);
    return iv;
}

export class SecureChannel {
    private sendCounter = 0n;
    private receiveCounter = 0n;
    private pending = Buffer.alloc(0);

    private constructor(
        private readonly sendKey: Buffer,
        private readonly receiveKey: Buffer,
        private readonly sendDirection: number,
        private readonly receiveDirection: number,
    ) {}

    /** The desktop's end of a connection. */
    static desktop(secret: string, challenge: string): SecureChannel {
        const keys = sessionKeys(secret, challenge);
        return new SecureChannel(keys.toDeck, keys.toDesktop, FROM_DESKTOP, FROM_DECK);
    }

    /** The deck's end, for tests that stand in for the firmware. */
    static deck(secret: string, challenge: string): SecureChannel {
        const keys = sessionKeys(secret, challenge);
        return new SecureChannel(keys.toDesktop, keys.toDeck, FROM_DECK, FROM_DESKTOP);
    }

    /** Encrypt bytes into as many frames as they need. */
    seal(data: Uint8Array): Buffer {
        const frames: Buffer[] = [];
        for (let offset = 0; offset < data.length; offset += MAX_PAYLOAD) {
            const payload = data.subarray(offset, Math.min(offset + MAX_PAYLOAD, data.length));
            const cipher = createCipheriv(
                "aes-128-gcm",
                this.sendKey,
                nonce(this.sendDirection, this.sendCounter++),
            );
            const header = Buffer.alloc(2);
            header.writeUInt16BE(payload.length, 0);
            frames.push(header, cipher.update(payload), cipher.final(), cipher.getAuthTag());
        }
        return Buffer.concat(frames);
    }

    /**
     * Take bytes from the socket and return every payload that is now complete.
     *
     * Throws if a frame fails to authenticate. There is no recovering from
     * that: the counters no longer agree, and the frame may be an attack.
     */
    open(chunk: Uint8Array): Buffer[] {
        this.pending = this.pending.length
            ? Buffer.concat([this.pending, chunk])
            : Buffer.from(chunk);
        const payloads: Buffer[] = [];
        while (this.pending.length >= 2) {
            const length = this.pending.readUInt16BE(0);
            if (length === 0 || length > MAX_PAYLOAD)
                throw new Error("Invalid secure frame length.");
            const total = 2 + length + TAG_BYTES;
            if (this.pending.length < total) break;
            const decipher = createDecipheriv(
                "aes-128-gcm",
                this.receiveKey,
                nonce(this.receiveDirection, this.receiveCounter),
            );
            decipher.setAuthTag(this.pending.subarray(2 + length, total));
            try {
                payloads.push(
                    Buffer.concat([
                        decipher.update(this.pending.subarray(2, 2 + length)),
                        decipher.final(),
                    ]),
                );
            } catch {
                throw new Error("A secure frame failed authentication.");
            }
            this.receiveCounter++;
            this.pending = this.pending.subarray(total);
        }
        return payloads;
    }
}
