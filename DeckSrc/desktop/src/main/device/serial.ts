/*---------------------------------------------------------------
 * The serial link to the deck.
 *
 * Everything with a hardware timing rule lives here, and there are three of
 * them. They were each found by measurement on the real board, so none should
 * be "tidied" without measuring again.
 *--------------------------------------------------------------*/

import { SECURE_MARKER, SecureChannel } from "./secure-channel";
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

/**
 * Read the deck's identity line.
 *
 * Shape: `OK id streamdeck 1 <mac> cells=15 cols=5 rows=3 w=118 h=123`.
 * Anything that does not start that way is some other device answering, and is
 * rejected rather than guessed at.
 */
export function parseIdentity(line: string, path: string): DeckIdentity | null {
    const parts = line.trim().split(/\s+/);
    if (
        parts[0] !== "OK" ||
        parts[1] !== "id" ||
        !["streamdeck", "decky"].includes(parts[2] ?? "")
    ) {
        return null;
    }

    const fields = new Map<string, number>();
    for (const part of parts.slice(5)) {
        const [key, value] = part.split("=");
        if (key !== undefined && value !== undefined && /^\d+$/.test(value)) {
            fields.set(key, Number(value));
        }
    }

    const cells = fields.get("cells");
    const columns = fields.get("cols");
    const rows = fields.get("rows");
    const keyWidth = fields.get("w");
    const keyHeight = fields.get("h");
    // Added after the first firmware; a board without it has exactly one page.
    const pages = fields.get("pages") ?? 1;

    if (
        cells === undefined ||
        columns === undefined ||
        rows === undefined ||
        keyWidth === undefined ||
        keyHeight === undefined
    ) {
        return null;
    }

    if (
        cells !== 15 ||
        columns !== 5 ||
        rows !== 3 ||
        keyWidth < 1 ||
        keyWidth > 256 ||
        keyHeight < 1 ||
        keyHeight > 256 ||
        ![1, 2, 3, 4, 5, 6, 7].includes(Number(parts[3])) ||
        !/^[a-f0-9]{12}$/i.test(parts[4] ?? "")
    )
        return null;

    return {
        portPath: path,
        protocol: Number(parts[3] ?? 0),
        serial: parts[4] ?? "",
        cells,
        columns,
        rows,
        keyWidth,
        keyHeight,
        pages,
        cacheSlots: fields.get("cache") ?? 8,
        persistentCache: fields.get("storage") === 1,
        // Reported from protocol 7 on; older firmware has no version to show.
        firmwareVersion: parts
            .slice(5)
            .find((part) => /^fw=[\w.+-]{1,48}$/.test(part))
            ?.slice(3),
    };
}

/**
 * Read an unsolicited line from the deck.
 *
 * `EV <page> <cell> DOWN|UP` for a press, `PAGE <n>` when the deck navigates.
 * Returns null for anything else, which is most lines - the deck also prints
 * human-readable diagnostics that are none of this app's business.
 */
export function parseEvent(line: string): DeckEvent | null {
    if (/^BOOT decky [3-7]$/.test(line)) return { kind: "reset", at: Date.now() };
    const parts = line.split(/\s+/);

    if (parts[0] === "EV" && parts.length >= 4) {
        const page = Number(parts[1]);
        const cell = Number(parts[2]);
        const edge = parts[3];
        if (
            Number.isInteger(page) &&
            Number.isInteger(cell) &&
            page >= 0 &&
            cell >= 0 &&
            cell < 15 &&
            page < 64 &&
            (edge === "DOWN" || edge === "UP")
        ) {
            return { kind: "key", page, cell, down: edge === "DOWN", at: Date.now() };
        }
        return null;
    }

    if (parts[0] === "PAGE" && parts.length >= 2) {
        const page = Number(parts[1]);
        if (Number.isInteger(page) && page >= 0) {
            return { kind: "page", page, at: Date.now() };
        }
    }

    return null;
}

export class DeckLink {
    private socket: Socket | null = null;
    private socketAddress = "";
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
        try {
            await this.open(path);
            const reply = await this.command("ID", 1500);
            return parseIdentity(reply.message, path);
        } catch {
            return null;
        }
    }
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

    async close(): Promise<void> {
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
                // Presses are the deck talking unprompted, so they must not be
                // handed to whoever is waiting for a reply. Without this, a key
                // touched while the app was identifying the board would be
                // consumed as the answer to `ID` and the deck would look like it
                // had failed to introduce itself.
                if (this.socket && !this.channel && line.startsWith("OK auth ")) {
                    // The handshake's last plain-text line. Anything after it
                    // in this packet is already encrypted, so it must not be
                    // read as text: keep it for the channel about to open.
                    this.afterAuth = Buffer.from(this.buffer, "latin1");
                    this.buffer = "";
                    const waiter = this.waiters.shift();
                    if (waiter) waiter(line);
                    else this.lines.push(line);
                    return;
                }
                const event = parseEvent(line);
                if (event !== null) {
                    if (!this.socket || this.authenticated) this.onEvent?.(event);
                } else {
                    const waiter = this.waiters.shift();
                    if (waiter) waiter(line);
                    else if (/^(OK|ERR|READY|A|CHALLENGE)( |$)/.test(line)) {
                        this.lines.push(line);
                        if (this.lines.length > 64) this.lines.shift();
                    }
                }
            }
            index = this.buffer.indexOf("\n");
        }
    }

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
                        (!this.socket && negotiated !== BLOCK)
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

        let sent = 0;
        while (sent < payload.length) {
            const chunk = payload.subarray(sent, sent + blockSize);
            await this.write(chunk);
            sent += chunk.length;

            for (;;) {
                const line = await this.nextLine(5000);
                if (line === "A") {
                    break;
                }
                if (line.startsWith("ERR")) {
                    return { ok: false, message: line };
                }
            }

            onProgress(sent, payload.length);
        }

        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
            const line = await this.nextLine(deadline - Date.now());
            if (line.startsWith("OK")) {
                return { ok: true, message: line };
            }
            if (line.startsWith("ERR")) {
                return { ok: false, message: line };
            }
        }
        return { ok: false, message: "no reply after the upload" };
    }
}
