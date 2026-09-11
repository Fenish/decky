import type { ObsSocket } from "../src/main/integrations/obs/obs-link";

type Data = Record<string, unknown>;

/**
 * OBS's WebSocket server, simulated: it says Hello (asking for `password`
 * if it has one), identifies, answers requests from `answers`, and sends
 * events when told. `reachable` false fails the socket at once.
 */
export class FakeObs {
    reachable = true;
    password = "";
    readonly salt = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=";
    readonly challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=";
    /** Every message Decky sent, parsed. */
    readonly sent: { op: number; d: Data }[] = [];
    /** How OBS answers each request type: its data, or a refusal. */
    readonly answers: Record<string, () => Data | Error> = {
        GetVersion: () => ({ obsVersion: "31.0.2" }),
    };
    /** The authentication an Identify must carry, when OBS has a password. */
    expected = "";
    private socket: ObsSocket | null = null;

    readonly open = (url: string): ObsSocket => {
        const socket: ObsSocket & { url: string } = {
            url,
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send: (data: string) => {
                const message = JSON.parse(data);
                this.sent.push(message);
                this.heard(message);
            },
            close: () => {
                if (this.socket === socket) this.socket = null;
                socket.onclose?.({ code: 1000 });
            },
        };
        this.socket = socket;
        queueMicrotask(() => {
            if (!this.reachable) {
                socket.onerror?.();
                return;
            }
            const auth = this.password ? { challenge: this.challenge, salt: this.salt } : undefined;
            this.say(0, { obsWebSocketVersion: "5.5.0", rpcVersion: 1, authentication: auth });
        });
        return socket;
    };

    /** OBS sends an event. */
    event(eventType: string, eventData: Data = {}): void {
        this.say(5, { eventType, eventIntent: 64, eventData });
    }

    /** OBS goes away, closing with `code`. */
    quit(code = 1001): void {
        const socket = this.socket;
        this.socket = null;
        socket?.onclose?.({ code });
    }

    requests(): string[] {
        return this.sent.filter((m) => m.op === 6).map((m) => String(m.d.requestType));
    }

    private heard(message: { op: number; d: Data }): void {
        if (message.op === 1) {
            if (this.password && message.d.authentication !== this.expected) return this.quit(4009);
            this.say(2, { negotiatedRpcVersion: 1 });
        } else if (message.op === 6) {
            const answer = this.answers[String(message.d.requestType)]?.() ?? {};
            const failed = answer instanceof Error;
            this.say(7, {
                requestType: message.d.requestType,
                requestId: message.d.requestId,
                requestStatus: failed
                    ? { result: false, code: 500, comment: answer.message }
                    : { result: true, code: 100 },
                ...(failed ? {} : { responseData: answer }),
            });
        }
    }

    private say(op: number, d: Data): void {
        const socket = this.socket;
        if (socket) queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ op, d }) }));
    }
}
