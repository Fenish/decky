/*---------------------------------------------------------------
 * Discord on this PC, through its local pipe (\\.\pipe\discord-ipc-N): a
 * handshake as a Discord application, by its public id, then commands, each
 * answered by its nonce. Rich Presence needs nothing more - no sign-in, no
 * secret - and nothing leaves the PC.
 *
 * Frames are a u32 op and a u32 length (little-endian), then that much JSON:
 * op 0 the handshake, 1 a command or an answer, 2 Discord closing, 3 and 4
 * ping and pong.
 *--------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import net from "node:net";

const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const;

/** Discord takes the first free of ten pipes. */
const PIPES = Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);

/** How long the handshake or a command may take. */
const ANSWER_MS = 5000;

type Message = Record<string, unknown>;

export class DiscordIpc {
    /** Discord went (it quit, or closed the pipe): not after `close()`. */
    onClose: (() => void) | null = null;
    /** An event subscribed to (SUBSCRIBE): its name and data. */
    onEvent: ((event: string, data: Record<string, unknown>) => void) | null = null;
    private buffer = Buffer.alloc(0);
    private readonly pending = new Map<
        string,
        { resolve: (data: unknown) => void; reject: (error: Error) => void }
    >();
    private ready: (() => void) | null = null;
    private refused: ((error: Error) => void) | null = null;
    private ended = false;

    private constructor(private readonly socket: net.Socket) {}

    /** Discord, as the application `clientId`: the first of its pipes that answers. */
    static async connect(clientId: string, pipes: string[] = PIPES): Promise<DiscordIpc> {
        for (const pipe of pipes) {
            try {
                return await DiscordIpc.open(pipe, clientId);
            } catch {
                // Not this one: Discord takes another when one is busy.
            }
        }
        throw new Error("Discord isn't running.");
    }

    private static open(path: string, clientId: string): Promise<DiscordIpc> {
        return new Promise((resolve, reject) => {
            const socket = net.connect(path);
            const ipc = new DiscordIpc(socket);
            const fail = (error: Error): void => {
                clearTimeout(timer);
                ipc.ended = true;
                socket.destroy();
                reject(error);
            };
            const timer = setTimeout(() => fail(new Error("Discord did not answer.")), ANSWER_MS);
            socket.once("error", fail);
            socket.on("connect", () => ipc.send(OP.handshake, { v: 1, client_id: clientId }));
            socket.on("data", (chunk: Buffer) => ipc.read(chunk));
            socket.on("close", () => ipc.end());
            ipc.refused = fail;
            ipc.ready = () => {
                clearTimeout(timer);
                socket.off("error", fail);
                socket.on("error", () => ipc.end());
                ipc.refused = null;
                resolve(ipc);
            };
        });
    }

    /**
     * A command, and what Discord answers; a refusal throws with its message.
     * `evt` names an event, for SUBSCRIBE; `timeoutMs` is longer for what waits
     * on a person (AUTHORIZE).
     */
    request(
        cmd: string,
        args: Message = {},
        evt?: string,
        timeoutMs = ANSWER_MS,
    ): Promise<unknown> {
        if (this.ended) return Promise.reject(new Error("Discord is gone."));
        const nonce = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(nonce);
                reject(new Error(`Discord did not answer ${cmd}.`));
            }, timeoutMs);
            this.pending.set(nonce, {
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            this.send(OP.frame, { cmd, args, nonce, ...(evt ? { evt } : {}) });
        });
    }

    /** Let Discord go; what Decky showed there goes with the pipe. */
    close(): void {
        this.onClose = null;
        this.end();
    }

    private send(op: number, message: Message): void {
        const body = Buffer.from(JSON.stringify(message));
        const head = Buffer.alloc(8);
        head.writeUInt32LE(op, 0);
        head.writeUInt32LE(body.length, 4);
        this.socket.write(Buffer.concat([head, body]));
    }

    private read(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 8 && this.buffer.length >= 8 + this.buffer.readUInt32LE(4)) {
            const op = this.buffer.readUInt32LE(0);
            const length = this.buffer.readUInt32LE(4);
            let message: Message = {};
            try {
                message = JSON.parse(this.buffer.subarray(8, 8 + length).toString("utf8"));
            } catch {
                // A frame that isn't JSON says nothing.
            }
            this.buffer = this.buffer.subarray(8 + length);
            this.heard(op, message);
        }
    }

    private heard(op: number, message: Message): void {
        if (op === OP.ping) return this.send(OP.pong, message);
        if (op === OP.close) {
            this.refused?.(new Error(String(message.message ?? "Discord closed the pipe.")));
            return this.end();
        }
        if (message.cmd === "DISPATCH") {
            if (message.evt === "READY") return this.ready?.();
            return this.onEvent?.(String(message.evt), (message.data as Message | undefined) ?? {});
        }
        const nonce = typeof message.nonce === "string" ? message.nonce : null;
        const waiting = nonce ? this.pending.get(nonce) : undefined;
        if (!waiting) return;
        this.pending.delete(nonce!);
        const data = message.data as Message | undefined;
        if (message.evt === "ERROR")
            waiting.reject(new Error(String(data?.message ?? "Discord refused it.")));
        else waiting.resolve(data);
    }

    private end(): void {
        if (this.ended) return;
        // Gone during the handshake: that refuses it at once.
        if (this.refused) return this.refused(new Error("Discord closed the pipe."));
        this.ended = true;
        this.socket.destroy();
        for (const waiting of this.pending.values()) waiting.reject(new Error("Discord is gone."));
        this.pending.clear();
        this.onClose?.();
    }
}
