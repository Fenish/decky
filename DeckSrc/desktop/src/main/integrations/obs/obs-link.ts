/*---------------------------------------------------------------
 * One connection to OBS Studio's WebSocket server (obs-websocket 5, built
 * into OBS 28 and later): the handshake, with the password where OBS asks
 * for one; requests and their answers; and the output events Decky listens
 * to. A link that ends stays ended: ObsService opens a new one.
 *
 *   OBS  -> Hello       (op 0), with a challenge and salt if it wants a password
 *   Decky-> Identify    (op 1), with the answer and the events it wants
 *   OBS  -> Identified  (op 2)
 *   Decky-> Request     (op 6) -> OBS: RequestResponse (op 7), by request id
 *   OBS  -> Event       (op 5)
 *--------------------------------------------------------------*/

import { createHash } from "node:crypto";

/** The little of WebSocket used here, so tests can stand in for it. */
export interface ObsSocket {
    onopen: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onclose: ((event: { code: number }) => void) | null;
    onerror: (() => void) | null;
    send(data: string): void;
    close(): void;
}

/** A WebSocket to OBS, speaking its JSON protocol. */
export const openObsSocket = (url: string): ObsSocket =>
    new WebSocket(url, "obswebsocket.json") as unknown as ObsSocket;

const OP = { hello: 0, identify: 1, identified: 2, event: 5, request: 6, response: 7 } as const;
/** The event groups Decky listens to: outputs (the recording's, the stream's). */
const OUTPUT_EVENTS = 1 << 6;
/** How OBS closes a link whose password is wrong. */
const AUTHENTICATION_FAILED = 4009;
const HANDSHAKE_MS = 5000;

/** The answer to OBS's challenge: base64 SHA-256 of the secret and challenge. */
export function obsAuthentication(password: string, salt: string, challenge: string): string {
    const secret = createHash("sha256")
        .update(password + salt)
        .digest("base64");
    return createHash("sha256")
        .update(secret + challenge)
        .digest("base64");
}

/** Why a link could not open: its password was refused (or none given), or no answer. */
export class ObsLinkError extends Error {
    constructor(readonly reason: "denied" | "unreachable") {
        super(reason === "denied" ? "OBS refused the password." : "OBS did not answer.");
    }
}

type Data = Record<string, unknown>;

export class ObsLink {
    private nextId = 0;
    private readonly waiting = new Map<
        string,
        { resolve: (data: Data) => void; reject: (error: Error) => void }
    >();
    /** An event OBS sent: its type and data. */
    onEvent: ((type: string, data: Data) => void) | null = null;
    /** The link ended after it opened; `denied` if OBS refused the password then. */
    onEnd: ((denied: boolean) => void) | null = null;

    private constructor(private readonly socket: ObsSocket) {}

    /** Connect to OBS at `address` and identify, with `password` if it asks for one. */
    static open(
        address: string,
        password: string,
        openSocket: (url: string) => ObsSocket = openObsSocket,
    ): Promise<ObsLink> {
        return new Promise((resolve, reject) => {
            const socket = openSocket(`ws://${address}`);
            const link = new ObsLink(socket);
            let identified = false;
            const fail = (reason: "denied" | "unreachable"): void => {
                clearTimeout(timer);
                socket.onmessage = socket.onclose = socket.onerror = null;
                socket.close();
                reject(new ObsLinkError(reason));
            };
            const timer = setTimeout(() => fail("unreachable"), HANDSHAKE_MS);
            socket.onerror = () => {
                if (!identified) fail("unreachable");
            };
            socket.onclose = ({ code }) => {
                if (!identified) fail(code === AUTHENTICATION_FAILED ? "denied" : "unreachable");
                else link.ended(code === AUTHENTICATION_FAILED);
            };
            socket.onmessage = ({ data }) => {
                const message = parse(data);
                if (!message) return;
                if (message.op === OP.hello) {
                    const auth = (message.d.authentication ?? null) as Data | null;
                    if (auth && !password) return fail("denied");
                    socket.send(
                        JSON.stringify({
                            op: OP.identify,
                            d: {
                                rpcVersion: 1,
                                eventSubscriptions: OUTPUT_EVENTS,
                                ...(auth
                                    ? {
                                          authentication: obsAuthentication(
                                              password,
                                              String(auth.salt),
                                              String(auth.challenge),
                                          ),
                                      }
                                    : {}),
                            },
                        }),
                    );
                } else if (message.op === OP.identified) {
                    identified = true;
                    clearTimeout(timer);
                    resolve(link);
                } else if (identified) link.heard(message);
            };
        });
    }

    /** Ask OBS something; its answer's data, or an error saying why not. */
    request(type: string, data?: Data): Promise<Data> {
        const requestId = String(++this.nextId);
        return new Promise((resolve, reject) => {
            this.waiting.set(requestId, { resolve, reject });
            this.socket.send(
                JSON.stringify({
                    op: OP.request,
                    d: { requestType: type, requestId, ...(data ? { requestData: data } : {}) },
                }),
            );
        });
    }

    close(): void {
        this.socket.onclose = null;
        this.socket.close();
        this.ended(false);
    }

    /** What OBS sends once identified, by op: answers, and events. */
    private heard(message: { op: number; d: Data }): void {
        const readers: Record<number, (d: Data) => void> = {
            [OP.response]: (d) => {
                const waiter = this.waiting.get(String(d.requestId));
                if (!waiter) return;
                this.waiting.delete(String(d.requestId));
                const status = (d.requestStatus ?? {}) as Data;
                if (status.result === true) waiter.resolve((d.responseData ?? {}) as Data);
                else
                    waiter.reject(
                        new Error(String(status.comment ?? `OBS could not ${d.requestType}.`)),
                    );
            },
            [OP.event]: (d) => this.onEvent?.(String(d.eventType), (d.eventData ?? {}) as Data),
        };
        readers[message.op]?.(message.d);
    }

    private ended(denied: boolean): void {
        for (const waiter of this.waiting.values()) waiter.reject(new Error("OBS went away."));
        this.waiting.clear();
        const end = this.onEnd;
        this.onEnd = null;
        end?.(denied);
    }
}

function parse(data: unknown): { op: number; d: Data } | null {
    try {
        const message = JSON.parse(String(data));
        return typeof message?.op === "number" && typeof message.d === "object" && message.d
            ? message
            : null;
    } catch {
        return null;
    }
}
