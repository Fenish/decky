import { describe, expect, it, vi } from "vitest";
vi.mock("serialport", async () => {
    const { EventEmitter } = await import("node:events");
    class Port extends EventEmitter {
        static last: Port | null = null;
        path: string;
        isOpen = false;
        transfer = false;
        received = 0;
        total = 0;
        constructor(options: { path: string }) {
            super();
            this.path = options.path;
            Port.last = this;
        }
        /** What Windows does when the cable is pulled: the library closes the port itself. */
        unplug() {
            this.isOpen = false;
            const error = Object.assign(
                new Error("Reading from COM port (ReadIOCompletion): Access denied"),
                { disconnected: true },
            );
            this.emit("close", error);
        }
        static async list() {
            return [{ path: "COM5", vendorId: "1a86" }];
        }
        open(done: (error?: Error) => void) {
            this.isOpen = true;
            done();
        }
        set(_options: unknown, done: () => void) {
            done();
        }
        close(done: () => void) {
            this.isOpen = false;
            done();
        }
        // Like the real library: on a closed port, writes and drains wait for it to reopen.
        drain(done: () => void) {
            if (!this.isOpen) {
                this.once("open", () => this.drain(done));
                return;
            }
            done();
        }
        write(bytes: Buffer, done: () => void) {
            if (!this.isOpen) {
                this.once("open", () => this.write(bytes, done));
                return;
            }
            const line = bytes.toString();
            if (this.transfer) {
                this.received += bytes.length;
                this.emit(
                    "data",
                    Buffer.from(this.received === this.total ? "A\nOK image\n" : "A\n"),
                );
                if (this.received === this.total) this.transfer = false;
            } else if (line === "ID\n")
                this.emit(
                    "data",
                    Buffer.from(
                        "diagnostic\nEV 0 2 UP\nEV 0 2 MOVE 40\nOK id decky 2 a4cb8fcdd274 cells=15 cols=5 rows=3 w=118 h=123 pages=64\n",
                    ),
                );
            else if (line.startsWith("ALT "))
                this.emit("data", Buffer.from("OK alternate cached=1\n"));
            else if (line.startsWith("PUSH ")) {
                this.total = Number(line.split(" ")[2]);
                this.received = 0;
                this.transfer = true;
                this.emit("data", Buffer.from("READY\n"));
            }
            done();
        }
    }
    return { SerialPort: Port };
});
import { DeckLink, parseEvent, parseIdentity } from "../src/main/device/serial";
describe("finger movement", () => {
    it("reads MOVE lines, and drag=1 as the deck offering them", () => {
        expect(parseEvent("EV 0 6 MOVE 42")).toMatchObject({
            kind: "move",
            page: 0,
            cell: 6,
            y: 42,
        });
        // A finger slid up past the opening's edge.
        expect(parseEvent("EV 0 6 MOVE -3")).toMatchObject({ kind: "move", y: -3 });
        expect(parseEvent("EV 0 6 MOVE")).toBeNull();
        expect(parseEvent("EV 0 15 MOVE 4")).toBeNull();
        const id =
            "OK id decky 7 a4cb8fcdd274 cells=15 cols=5 rows=3 w=118 h=123 pages=64 live=1 drag=1";
        expect(parseIdentity(id, "COM5")?.drag).toBe(true);
        expect(parseIdentity(id.replace(" drag=1", ""), "COM5")?.drag).toBe(false);
    });
});
describe("serial response timing", () => {
    it("does not lose replies that arrive before drain or coalesced ACK / OK packets", async () => {
        const link = new DeckLink();
        const events = vi.fn();
        link.onEvent = events;
        const identity = await link.identify("COM5");
        expect(identity?.protocol).toBe(2);
        expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: "key", down: false }));
        // Finger movement is an event too, never taken for the reply to ID.
        expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: "move", y: 40 }));
        const progress = vi.fn();
        const reply = await link.push(0, new Uint8Array(148), progress);
        expect(reply).toEqual({ ok: true, message: "OK image" });
        expect(progress.mock.calls).toEqual([
            [128, 148],
            [148, 148],
        ]);
        const alternateProgress = vi.fn();
        expect(
            await link.push(1, new Uint8Array(148), alternateProgress, "ALT 0 123 1 148 456"),
        ).toEqual({ ok: true, message: "OK alternate cached=1" });
        expect(alternateProgress).not.toHaveBeenCalled();
        await link.close();
    });
    it("fails commands at once after the cable is pulled, instead of waiting forever", async () => {
        const { SerialPort } = await import("serialport");
        const link = new DeckLink();
        expect(await link.identify("COM5")).not.toBeNull();
        (SerialPort as unknown as { last: { unplug(): void } }).last.unplug();
        expect(await link.stillAttached()).toBe(false);
        // Every deck command shares one queue: a command that never settles
        // blocks the status check, the Disconnected page and the Wi-Fi fallback.
        const outcome = await Promise.race([
            link.command("PING", 1500).then(
                () => "answered",
                () => "failed",
            ),
            new Promise((resolve) => setTimeout(() => resolve("still waiting"), 500)),
        ]);
        expect(outcome).toBe("failed");
    });
});
