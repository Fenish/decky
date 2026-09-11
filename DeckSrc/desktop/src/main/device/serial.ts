/*---------------------------------------------------------------
 * The serial link to the deck.
 *
 * Everything with a hardware timing rule lives here, and there are three of
 * them. They were each found by measurement on the real board, so none should
 * be "tidied" without measuring again.
 *--------------------------------------------------------------*/

import { SECURE_MARKER, SecureChannel } from "./secure-channel";
import { parseEvent, parseIdentity } from "./protocol";
import { SerialPort } from "serialport";
import { Socket } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeckEvent, DeckIdentity } from "../../shared/api";

export const BAUD = 460800;

/**
 * Bytes per block.
 *
 * This is the size of the chip's hardware receive FIFO. Larger bursts lose
 * bytes before any software buffer can see them - 256 loses them, 128 does not
 * - and the firmware acknowledges exactly this much, so sending a different
 * size makes every block wait out a timeout instead of being acknowledged.
 */
const BLOCK = 128;

/**
 * Lines from the deck that are neither replies nor events: its boot banner,
 * and what ESP-IDF prints when it panics, resets or browns out.
 */
const DECK_NOISE =
    /^(Decky v\d|Guru Meditation|Backtrace:|Core +\d+ register|PC +:|EXCVADDR|abort\(\)|assert|Brownout|rst:0x|Rebooting|ELF file SHA256|CPU halted|Stack smashing|\*\*\*ERROR\*\*\*|E \(\d+\))/;

/** USB-serial bridges the panel is known to appear behind. */
const KNOWN_VENDOR_IDS = new Set(["1a86", "10c4", "0403", "303a"]);

export interface PortChoice {
    path: string;
    label: string;
    likely: boolean;
}

export interface Reply {
    ok: boolean;
    message: string;
}

/** A line from the deck, by who it is for. */
type DeckLine =
    /** The last plain-text line of the Wi-Fi handshake. */
    | { kind: "handshake"; line: string }
    | { kind: "event"; event: DeckEvent }
    | { kind: "noise"; line: string }
    | { kind: "reply"; line: string };

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

/** CRC32 over the payload, matching what the firmware checks. */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = (CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export class DeckLink {
    private socket: Socket | null = null;
    private socketAddress = "";
    // Bytes an upload goes in over USB: 128 unless the deck took more (BLOCK).
    private serialBlock = BLOCK;
    private authenticated = false;
    // Set once the handshake succeeds; from then on every byte on the socket is a frame.
    private channel: SecureChannel | null = null;
    // Bytes that arrived in the same packet as "OK auth", which are already frames.
    private afterAuth: Buffer | null = null;

    /**
     * Why the last Wi-Fi attempt was refused, when the reason is the deck's
     * firmware rather than the network: firmware older than protocol 7 only
     * speaks plain text after pairing, and this app will not.
     */
    wifiRefusal: "insecure-firmware" | null = null;
    private port: SerialPort | null = null;
    private buffer = "";
    private lines: string[] = [];
    private waiters: ((line: string) => void)[] = [];

    /**
     * Called for every press and page change the deck reports.
     *
     * Set by the owner rather than exposed as an emitter: there is exactly one
     * consumer, the window, and a subscriber list would only invite listeners
     * that outlive it.
     */
    onEvent: ((event: DeckEvent) => void) | null = null;
    /** Lines that are no reply and no event: a crash report, a boot banner. */
    onNoise: ((line: string) => void) | null = null;

    /** Serial devices that could be the deck, likeliest first. */
    static async listPorts(): Promise<PortChoice[]> {
        const all = await SerialPort.list();

        // Only devices behind a USB-serial bridge, never every port on the
        // machine. A desktop's built-in COM1 is a serial port with nothing on
        // the end of it, and falling back to "all ports" reported a deck that
        // was not plugged in at all.
        return all
            .filter((p) => KNOWN_VENDOR_IDS.has((p.vendorId ?? "").toLowerCase()))
            .map((p) => ({
                path: p.path,
                label: `${p.path} — ${p.friendlyName ?? p.manufacturer ?? "serial device"}`,
                likely: true,
            }));
    }

    /** The port currently open, if any. */
    get openPath(): string | null {
        if (this.socket && !this.socket.destroyed && this.authenticated)
            return `tcp://${this.socketAddress}:47561`;
        return this.port?.isOpen === true ? this.port.path : null;
    }

    /** Whether the port this link is using is still attached to the machine. */
    async stillAttached(): Promise<boolean> {
        if (this.socket) return !this.socket.destroyed && this.authenticated;
        const path = this.openPath;
        if (path === null) {
            return false;
        }
        const all = await SerialPort.list();
        return all.some((p) => p.path === path);
    }

    /**
     * Ask a device what it is.
     *
     * The USB-serial chip's vendor is not evidence - plenty of unrelated
     * hardware sits behind the same bridge - so the deck is asked directly and
     * has to name itself. The reply also carries the key geometry, which is why
     * this app holds no copy of it: one description, on the device.
     */
    async identify(path: string): Promise<DeckIdentity | null> {
        this.stuck = false;
        try {
            await this.open(path);
            const reply = await this.command("ID", 1500);
            return parseIdentity(reply.message, path);
        } catch (error) {
            // Windows' "A device attached to the system is not functioning":
            // the USB-serial chip itself stopped answering, which only
            // unplugging it (or restarting the device) mends.
            this.stuck = /not functioning|error code 31/i.test(String(error));
            return null;
        }
    }
    /** The last port asked could not even be opened: its USB bridge is wedged. */
    stuck = false;
    async identifyNetwork(
        address: string,
        secret: string,
        port = 47561,
    ): Promise<DeckIdentity | null> {
        await this.close();
        const socket = new Socket();
        this.socket = socket;
        this.socketAddress = address;
        this.authenticated = false;
        this.buffer = "";
        this.lines = [];
        socket.setNoDelay(true);
        socket.on("data", (chunk) => {
            if (this.socket !== socket) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (!this.channel) {
                this.consume(bytes);
                return;
            }
            try {
                for (const payload of this.channel.open(bytes)) this.consume(payload);
            } catch {
                // An unauthenticated frame is either corruption or an attack;
                // either way nothing more on this connection can be trusted.
                this.authenticated = false;
                socket.destroy();
            }
        });
        socket.on("error", () => {
            if (this.socket === socket) this.authenticated = false;
            socket.destroy();
        });
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    socket.destroy();
                    reject(new Error("Wi-Fi connection timed out."));
                }, 1500);
                socket.once("error", (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
                socket.connect(port, address, () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
            const challenge = await this.nextLine(2000);
            if (/^CHALLENGE [a-f0-9]{64}$/.test(challenge)) {
                this.wifiRefusal = "insecure-firmware";
                throw new Error("This firmware does not encrypt Wi-Fi traffic.");
            }
            const nonce = challenge.match(
                new RegExp(`^CHALLENGE ([a-f0-9]{64}) ${SECURE_MARKER}$`),
            )?.[1];
            if (!nonce) throw new Error("Invalid device challenge.");
            const proof = createHmac("sha256", secret).update(nonce).digest("hex");
            const reply = await this.command(`AUTH ${proof}`, 2000);
            const received = reply.message.match(/^OK auth ([a-f0-9]{64})$/)?.[1];
            const expected = createHmac("sha256", secret).update(`server:${nonce}`).digest();
            if (!received || !timingSafeEqual(Buffer.from(received, "hex"), expected))
                throw new Error("Device pairing failed.");
            this.channel = SecureChannel.desktop(secret, nonce);
            this.authenticated = true;
            this.wifiRefusal = null;
            const early = this.afterAuth;
            this.afterAuth = null;
            if (early) for (const payload of this.channel.open(early)) this.consume(payload);
            return parseIdentity(
                (await this.command("ID", 2000)).message,
                `tcp://${address}:${port}`,
            );
        } catch {
            await this.close();
            return null;
        }
    }

    /**
     * Open a port without resetting the board.
     *
     * DTR and RTS are wired to the reset line here. Most serial libraries
     * assert them on open, which reboots the deck and drops whatever it was
     * playing, so they are cleared explicitly.
     */
    async open(path: string): Promise<void> {
        if (this.port?.isOpen && this.port.path === path) {
            return;
        }
        await this.close();

        const port = new SerialPort({ path, baudRate: BAUD, autoOpen: false, hupcl: false });

        port.on("error", () => {
            if (this.port === port) this.port = null;
        });
        // Pulling the cable closes the port from underneath the link. The serial
        // library holds writes to a closed port until it reopens, which never
        // happens, so keeping it would stall every command queued behind one.
        port.on("close", () => {
            if (this.port === port) this.port = null;
        });
        await new Promise<void>((resolve, reject) => {
            port.open((error) => (error ? reject(error) : resolve()));
        });
        await new Promise<void>((resolve) => {
            port.set({ dtr: false, rts: false }, () => resolve());
        });

        this.buffer = "";
        this.lines = [];
        this.waiters = [];
        port.on("data", (chunk: Buffer) => {
            if (this.port === port) this.consume(chunk);
        });
        this.port = port;
    }

    /**
     * Ask the deck to take uploads over USB in blocks of `bytes` (BLOCK), for
     * this session; false where it keeps to 128. Blocks acknowledged one by one
     * spend most of their time waiting for the answer: at 128 bytes a 24 KB
     * look took 1.7 s.
     */
    async useBlock(bytes: number): Promise<boolean> {
        const reply = await this.command(`BLOCK ${bytes}`, 2000);
        if (reply.ok) this.serialBlock = bytes;
        return reply.ok;
    }

    async close(): Promise<void> {
        this.serialBlock = BLOCK;
        this.socket?.destroy();
        this.socket = null;
        this.authenticated = false;
        this.channel = null;
        this.afterAuth = null;
        const closing = this.port;
        this.port = null;
        if (!closing?.isOpen) {
            return;
        }
        await new Promise<void>((resolve) => closing.close(() => resolve()));
    }

    private consume(chunk: Buffer): void {
        this.buffer += chunk.toString("latin1");
        if (this.buffer.length > 8192) this.buffer = this.buffer.slice(-4096);

        let index = this.buffer.indexOf("\n");
        while (index >= 0) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);

            if (line.length > 0) {
                const read = this.classify(line);
                (this.readers[read.kind] as (read: DeckLine) => void)(read);
            }
            index = this.buffer.indexOf("\n");
        }
    }

    /**
     * What a line is. Presses are the deck talking unprompted, so they must not
     * be handed to whoever is waiting for a reply. Without this, a key touched
     * while the app was identifying the board would be consumed as the answer
     * to `ID` and the deck would look like it had failed to introduce itself.
     */
    private classify(line: string): DeckLine {
        if (this.socket && !this.channel && line.startsWith("OK auth "))
            return { kind: "handshake", line };
        const event = parseEvent(line);
        if (event !== null) return { kind: "event", event };
        if (DECK_NOISE.test(line)) return { kind: "noise", line };
        return { kind: "reply", line };
    }

    /** Who each kind of line is for. */
    private readonly readers: {
        [K in DeckLine["kind"]]: (read: Extract<DeckLine, { kind: K }>) => void;
    } = {
        // The handshake's last plain-text line. Anything after it in this
        // packet is already encrypted, so it must not be read as text: keep it
        // for the channel about to open. Reading this packet stops there.
        handshake: ({ line }) => {
            this.afterAuth = Buffer.from(this.buffer, "latin1");
            this.buffer = "";
            const waiter = this.waiters.shift();
            if (waiter) waiter(line);
            else this.lines.push(line);
        },
        event: ({ event }) => {
            if (!this.socket || this.authenticated) this.onEvent?.(event);
        },
        // What the deck prints when it crashes or starts: never a reply, and
        // worth keeping - it says why.
        noise: ({ line }) => this.onNoise?.(line),
        reply: ({ line }) => {
            const waiter = this.waiters.shift();
            if (waiter) waiter(line);
            else if (/^(OK|ERR|READY|A|CHALLENGE)( |$)/.test(line)) {
                this.lines.push(line);
                if (this.lines.length > 64) this.lines.shift();
            }
        },
    };

    private nextLine(timeoutMs: number): Promise<string> {
        const buffered = this.lines.shift();
        if (buffered !== undefined) return Promise.resolve(buffered);
        return new Promise((resolve, reject) => {
            const onLine = (line: string): void => {
                clearTimeout(timer);
                resolve(line);
            };
            const timer = setTimeout(
                () => {
                    this.waiters = this.waiters.filter((w) => w !== onLine);
                    reject(new Error("the deck did not answer"));
                },
                Math.max(1, timeoutMs),
            );

            this.waiters.push(onLine);
        });
    }

    private write(bytes: Uint8Array): Promise<void> {
        if (this.socket) {
            const payload = this.channel ? this.channel.seal(bytes) : bytes;
            return new Promise((resolve, reject) =>
                this.socket!.write(payload, (error) => (error ? reject(error) : resolve())),
            );
        }
        return new Promise((resolve, reject) => {
            const port = this.port;
            if (!port?.isOpen) {
                reject(new Error("port is not open"));
                return;
            }
            port.write(Buffer.from(bytes), (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                // Unplugged mid-write: a drain would wait for a reopen too.
                if (!port.isOpen) {
                    reject(new Error("port is not open"));
                    return;
                }
                port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
            });
        });
    }

    /** Send a bare command and return the board's first OK or ERR. */
    async command(text: string, timeoutMs = 30_000): Promise<Reply> {
        this.lines = [];
        // A new session: the deck is back to 128-byte blocks.
        if (text.startsWith("HELLO ")) this.serialBlock = BLOCK;
        await this.write(Buffer.from(`${text}\n`, "latin1"));

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const line = await this.nextLine(deadline - Date.now());
            if (line.startsWith("OK") || line.startsWith("ERR")) {
                return { ok: line.startsWith("OK"), message: line };
            }
        }
        return { ok: false, message: "no reply" };
    }

    /**
     * Send one pack to one key.
     *
     * Each block is acknowledged before the next goes out. Streaming the
     * payload continuously loses about a hundred bytes near the end on this
     * hardware, and a checksum that only reports the damage is no use when the
     * transfer has to succeed.
     */
    async push(
        cell: number,
        payload: Uint8Array,
        onProgress: (sent: number, total: number) => void,
        header?: string,
    ): Promise<Reply> {
        this.lines = [];
        const command = `${header ?? `PUSH ${cell} ${payload.length} ${crc32(payload)}`}\n`;

        let ready = false;
        let blockSize = BLOCK;
        for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
            await this.write(Buffer.from(command, "latin1"));

            const deadline = Date.now() + 6000;
            while (Date.now() < deadline && !ready) {
                let line: string;
                try {
                    line = await this.nextLine(deadline - Date.now());
                } catch {
                    break;
                }
                if (/^READY(?: \d+)?$/.test(line)) {
                    const negotiated = Number(line.split(" ")[1] ?? BLOCK);
                    if (
                        !Number.isInteger(negotiated) ||
                        negotiated < 1 ||
                        negotiated > 16384 ||
                        (!this.socket && negotiated !== BLOCK && negotiated !== this.serialBlock)
                    )
                        return { ok: false, message: "Invalid image transfer block size." };
                    blockSize = negotiated;
                    ready = true;
                } else if (line.startsWith("OK") && line.includes("cached=1")) {
                    return { ok: true, message: line };
                } else if (line.startsWith("ERR")) {
                    return { ok: false, message: line };
                }
            }
        }

        if (!ready) {
            return { ok: false, message: "the deck did not answer" };
        }

        // An upload that fails partway is written down: a block never
        // acknowledged, or bytes the deck says went missing, is what a lossy
        // link looks like.
        const failed = (message: string): Reply => {
            this.onNoise?.(
                `upload failed: ${command.trim()} - ${message} (${sent}/${payload.length} bytes, ${blockSize}-byte blocks)`,
            );
            return { ok: false, message };
        };
        let sent = 0;
        while (sent < payload.length) {
            const chunk = payload.subarray(sent, sent + blockSize);
            await this.write(chunk);
            sent += chunk.length;

            for (;;) {
                let line: string;
                try {
                    line = await this.nextLine(5000);
                } catch {
                    return failed("the deck did not acknowledge a block");
                }
                if (line === "A") {
                    break;
                }
                if (line.startsWith("ERR")) {
                    return failed(line);
                }
            }

            onProgress(sent, payload.length);
        }

        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
            let line: string;
            try {
                line = await this.nextLine(deadline - Date.now());
            } catch {
                break;
            }
            if (line.startsWith("OK")) {
                return { ok: true, message: line };
            }
            if (line.startsWith("ERR")) {
                return failed(line);
            }
        }
        return failed("no reply after the upload");
    }
}
