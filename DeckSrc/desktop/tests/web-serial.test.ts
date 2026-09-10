import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the serial library that records what reaches the reset lines.
const calls: { method: string; args: unknown }[] = [];
vi.mock("serialport", () => {
    class SerialPort {
        isOpen = false;
        constructor(readonly options: unknown) {}
        open(done: (error?: Error | null) => void): void {
            this.isOpen = true;
            calls.push({ method: "open", args: this.options });
            done(null);
        }
        set(flags: unknown, done: (error?: Error | null) => void): void {
            calls.push({ method: "set", args: flags });
            done(null);
        }
        update(options: unknown, done: (error?: Error | null) => void): void {
            calls.push({ method: "update", args: options });
            done(null);
        }
        close(done: () => void): void {
            this.isOpen = false;
            calls.push({ method: "close", args: null });
            done();
        }
        on(): void {}
        off(): void {}
        write(_d: unknown, done: (e?: Error | null) => void): void {
            done(null);
        }
        drain(done: (e?: Error | null) => void): void {
            done(null);
        }
    }
    return { SerialPort };
});

const { NodeWebSerialPort } = await import("../src/main/device/web-serial");

describe("Web Serial adapter for esptool-js", () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it("always sends both reset lines, so setting one never asserts the other", async () => {
        const port = new NodeWebSerialPort("COM5");
        await port.open({ baudRate: 115200 });
        // esptool-js's classic reset: RTS on (EN low), then DTR on / RTS off (IO0 low, EN high).
        await port.setSignals({ dataTerminalReady: false });
        await port.setSignals({ requestToSend: true });
        await port.setSignals({ dataTerminalReady: true });
        await port.setSignals({ requestToSend: false });
        const sets = calls.filter((c) => c.method === "set").map((c) => c.args);
        // The serial library fills a missing line with "asserted", which would
        // break the reset timing on this board; every call names both.
        expect(
            sets.every((flags) => "dtr" in (flags as object) && "rts" in (flags as object)),
        ).toBe(true);
        expect(sets.slice(-4)).toEqual([
            { dtr: false, rts: false },
            { dtr: false, rts: true },
            { dtr: true, rts: true },
            { dtr: true, rts: false },
        ]);
    });

    it("opens with the reset lines released and changes baud in place instead of reopening", async () => {
        const port = new NodeWebSerialPort("COM5");
        await port.open({ baudRate: 115200 });
        expect(calls[1]).toEqual({ method: "set", args: { dtr: false, rts: false } });
        await port.close();
        await port.open({ baudRate: 460800 });
        expect(calls.filter((c) => c.method === "open")).toHaveLength(1);
        expect(calls.at(-1)).toEqual({ method: "update", args: { baudRate: 460800 } });
        await port.release();
        expect(calls.at(-1)?.method).toBe("close");
    });
});
