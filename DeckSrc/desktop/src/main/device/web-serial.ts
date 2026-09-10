/*---------------------------------------------------------------
 * A Web Serial port made of a Node serial port.
 *
 * esptool-js speaks to the browser's Web Serial API. The main process has no
 * such API, but it has `serialport`, so this presents the six members esptool-js
 * actually uses - open, close, readable, writable, setSignals and getInfo - on
 * top of it. Two behaviours differ from a naive translation, and both are there
 * because this board's reset lines are wired to DTR and RTS.
 *--------------------------------------------------------------*/

import { SerialPort } from "serialport";

export class NodeWebSerialPort {
    readable: ReadableStream<Uint8Array> | null = null;
    writable: WritableStream<Uint8Array> | null = null;

    private port: SerialPort | null = null;
    private onData: ((chunk: Buffer) => void) | null = null;
    // Both lines are tracked and always sent together. `serialport` fills any
    // line left out of `set()` with "asserted", so esptool-js setting RTS alone
    // would also assert DTR - and on this board DTR and RTS are the reset
    // circuit, so the chip would never reach its bootloader.
    private dtr = false;
    private rts = false;

    constructor(
        readonly path: string,
        private readonly info: { usbVendorId?: number; usbProductId?: number } = {},
    ) {}

    getInfo(): { usbVendorId?: number; usbProductId?: number } {
        return this.info;
    }

    /**
     * Open at a baud rate, or change the rate of a port already open.
     *
     * esptool-js raises the rate by closing and reopening the port. Reopening
     * a Windows COM port can glitch the control lines, and those lines reset the
     * chip, so a reopen is turned into an in-place rate change instead.
     */
    async open(options: { baudRate: number }): Promise<void> {
        if (!this.port) {
            const port = new SerialPort({
                path: this.path,
                baudRate: options.baudRate,
                autoOpen: false,
                hupcl: false,
            });
            await new Promise<void>((resolve, reject) =>
                port.open((error) => (error ? reject(error) : resolve())),
            );
            this.port = port;
            await this.applySignals();
        } else {
            const port = this.port;
            await new Promise<void>((resolve, reject) =>
                port.update({ baudRate: options.baudRate }, (error) =>
                    error ? reject(error) : resolve(),
                ),
            );
        }
        this.attachStreams();
    }

    async setSignals(signals: {
        dataTerminalReady?: boolean;
        requestToSend?: boolean;
    }): Promise<void> {
        if (signals.dataTerminalReady !== undefined) this.dtr = signals.dataTerminalReady;
        if (signals.requestToSend !== undefined) this.rts = signals.requestToSend;
        await this.applySignals();
    }

    /** End the streams but keep the port, so the next `open` only changes the rate. */
    async close(): Promise<void> {
        this.detachStreams();
    }

    /** Actually close the port. Called once, when flashing is over. */
    async release(): Promise<void> {
        this.detachStreams();
        const port = this.port;
        this.port = null;
        if (port?.isOpen) await new Promise<void>((resolve) => port.close(() => resolve()));
    }

    private async applySignals(): Promise<void> {
        const port = this.port;
        if (!port) throw new Error("Port is not open.");
        await new Promise<void>((resolve, reject) =>
            port.set({ dtr: this.dtr, rts: this.rts }, (error) =>
                error ? reject(error) : resolve(),
            ),
        );
    }

    private attachStreams(): void {
        const port = this.port!;
        this.readable = new ReadableStream<Uint8Array>({
            start: (controller) => {
                this.onData = (chunk) => controller.enqueue(new Uint8Array(chunk));
                port.on("data", this.onData);
            },
            cancel: () => this.detachData(),
        });
        this.writable = new WritableStream<Uint8Array>({
            write: (chunk) =>
                new Promise<void>((resolve, reject) =>
                    port.write(Buffer.from(chunk), (error) =>
                        error
                            ? reject(error)
                            : port.drain((drained) => (drained ? reject(drained) : resolve())),
                    ),
                ),
        });
    }

    private detachData(): void {
        if (this.onData && this.port) this.port.off("data", this.onData);
        this.onData = null;
    }

    private detachStreams(): void {
        this.detachData();
        this.readable = null;
        this.writable = null;
    }
}
