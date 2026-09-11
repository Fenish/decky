/*---------------------------------------------------------------
 * The session with the deck: finding it - USB first, Wi-Fi only when no
 * cable answers - one exchange with it at a time, and noticing when it goes.
 *--------------------------------------------------------------*/

import { DeckLink } from "../device/serial";
import { discoverWifi, loadWifiPair, saveWifiPair } from "../device/wifi";
import type { WifiPair } from "../device/wifi";
import type { DeckStatus } from "../../shared/api";
import { fellBackToWifi, transportOf } from "../../shared/transport";
import type { Transport } from "../../shared/transport";
import type { Lifecycle } from "../app/lifecycle";
import type { MainWindow } from "../app/main-window";
import type { LogFile } from "../logging/log-file";

// Two silent asks a moment apart - a deck plugged in just now may still be
// starting up - and the Disconnected page offers to set the device up.
const SILENT_CHECKS = 2;
const SILENT_RECHECK_MS = 1000;
// How often the list of USB-serial ports is compared for new arrivals.
const PORT_WATCH_MS = 1000;
// How long a USB port that turned out not to be this deck is left alone.
const NOT_THIS_DECK_MS = 30_000;

export class DeckSession {
    readonly link = new DeckLink();
    // A second link, for asking USB ports what they are while on Wi-Fi.
    private readonly usbProbe = new DeckLink();
    status: DeckStatus = { connected: false };
    // This PC's pairing with a deck for Wi-Fi, kept in wifi-pair.json.
    wifiPair: WifiPair | null = null;
    wifiPath = "";
    /** Whether a job has the link now (serial()). */
    serialActive = false;
    private serialQueue: Promise<unknown> = Promise.resolve();
    private heartbeat: ReturnType<typeof setInterval> | undefined;
    private heartbeatPending = false;
    // USB-serial ports that did not answer ID, and how many times in a row.
    private readonly silentPorts = new Map<string, number>();
    // Transport of the last good connection, kept across a heartbeat failure so a
    // USB link that came back over Wi-Fi can be announced.
    private lastTransport: Transport | null = null;
    // While on Wi-Fi, USB ports that turned out not to be this deck, and when.
    private readonly notThisDeck = new Map<string, number>();

    /** Called as the deck is looked for again: what it held is no longer known. */
    onReconnect: (() => void) | null = null;

    constructor(
        private readonly window: MainWindow,
        private readonly lifecycle: Lifecycle,
        private readonly log: LogFile,
    ) {}

    /** Run `job` once the jobs before it are done: one exchange with the deck at a time. */
    serial<T>(job: () => Promise<T>): Promise<T> {
        const wrapped = async (): Promise<T> => {
            this.serialActive = true;
            try {
                return await job();
            } finally {
                this.serialActive = false;
            }
        };
        const next = this.serialQueue.then(wrapped, wrapped);
        this.serialQueue = next.catch(() => {});
        return next;
    }

    async loadWifiPair(path: string): Promise<void> {
        this.wifiPath = path;
        this.wifiPair = await loadWifiPair(path);
    }

    /**
     * The deck's status, checked: a link that went, or this deck's USB cable
     * plugged back in while on Wi-Fi, means finding it again.
     */
    check(): Promise<DeckStatus> {
        return this.serial(async () => {
            if (this.status.connected) {
                this.lastTransport = transportOf(this.status.identity);
                if ((await this.link.stillAttached()) && !(await this.cableIsBack()))
                    return this.status;
            }
            const before = this.lastTransport;
            await this.reconnect();
            const after = this.status.connected ? transportOf(this.status.identity) : null;
            if (fellBackToWifi(before, after))
                this.window.send("deck:event", { kind: "fallback", at: Date.now() });
            this.lastTransport = after;
            return this.status;
        });
    }

    /** Forget how often a port stayed silent: it is asked about afresh, after an install. */
    forgetSilentPort(path: string): void {
        this.silentPorts.delete(path);
    }

    // While on Wi-Fi: has this deck's USB cable been plugged back in? Checked
    // through a second link, so Wi-Fi is only dropped once USB has answered
    // with the same serial - an unrelated USB device never interrupts it.
    private async cableIsBack(): Promise<boolean> {
        if (!this.status.connected || transportOf(this.status.identity) !== "wifi") return false;
        const serialNumber = this.status.identity.serial;
        const now = Date.now();
        for (const port of await DeckLink.listPorts()) {
            if (now - (this.notThisDeck.get(port.path) ?? 0) < NOT_THIS_DECK_MS) continue;
            const identity = await this.usbProbe.identify(port.path);
            await this.usbProbe.close();
            if (identity?.serial === serialNumber) return true;
            this.notThisDeck.set(port.path, now);
        }
        return false;
    }

    // Find the deck again: USB first, Wi-Fi only when no cable answers.
    private async reconnect(): Promise<void> {
        this.status = { connected: false };
        this.onReconnect?.();
        await this.link.close();
        const ports = await DeckLink.listPorts();
        for (const known of [...this.silentPorts.keys()])
            if (!ports.some((port) => port.path === known)) this.silentPorts.delete(known);
        // A port whose USB bridge stopped answering: not a silent device to set up.
        let stuckPort: string | undefined;
        for (const port of ports) {
            let identity = await this.link.identify(port.path);
            let silences = identity ? 0 : (this.silentPorts.get(port.path) ?? 0) + 1;
            // A new port's silence is asked about again within this check, not a
            // whole status check later, so a board without Decky is offered sooner.
            while (!identity && silences < SILENT_CHECKS) {
                await new Promise((resolve) => setTimeout(resolve, SILENT_RECHECK_MS));
                identity = await this.link.identify(port.path);
                silences = identity ? 0 : silences + 1;
            }
            if (identity) {
                this.status = { connected: true, identity };
                this.noteRestart(identity.resetReason);
                this.silentPorts.clear();
                this.notThisDeck.clear();
                return;
            }
            if (this.link.stuck) {
                stuckPort = port.path;
                this.silentPorts.delete(port.path);
            } else this.silentPorts.set(port.path, silences);
        }
        await this.link.close();
        if (await this.connectWireless()) return;
        await this.link.close();
        const unknownDevices = ports
            .filter((port) => (this.silentPorts.get(port.path) ?? 0) >= SILENT_CHECKS)
            .map((port) => ({ path: port.path, label: port.label }));
        this.status = {
            connected: false,
            ...(unknownDevices.length ? { unknownDevices } : {}),
            ...(stuckPort ? { stuckPort } : {}),
        };
    }

    private async connectWireless(): Promise<boolean> {
        if (!this.wifiPair) return false;
        const addresses = this.wifiPair.ip ? [this.wifiPair.ip] : [];
        for (let stage = 0; stage < 2; stage++) {
            if (stage === 1)
                addresses.push(
                    ...(await discoverWifi(this.wifiPair.serial)).filter(
                        (ip) => !addresses.includes(ip),
                    ),
                );
            for (const address of addresses.splice(0, 4)) {
                const identity = await this.link.identifyNetwork(address, this.wifiPair.secret);
                if (identity && identity.serial === this.wifiPair.serial) {
                    this.status = { connected: true, identity };
                    this.wifiPair.ip = address;
                    await saveWifiPair(this.wifiPath, this.wifiPair);
                    return true;
                }
                await this.link.close();
            }
        }
        return false;
    }

    /** A deck that restarted because it crashed, a watchdog fired or its supply dipped: said so. */
    private noteRestart(reason: string | undefined): void {
        if (!reason || !["panic", "taskwdt", "intwdt", "wdt", "brownout"].includes(reason)) return;
        this.log.write(`the deck last restarted: ${reason}`);
        this.window.send("action:activity", {
            at: Date.now(),
            label: "Decky",
            ok: false,
            message:
                reason === "brownout"
                    ? "The deck restarted because its power dipped. Try another USB port or cable."
                    : "The deck restarted after a fault. Details are in deck.log.",
        });
    }

    /**
     * PING every four seconds, also while Decky sits in the tray. `reset`
     * runs when the deck stops answering, or answers online=0 once `loaded`.
     */
    startHeartbeat(loaded: () => boolean, reset: () => void): void {
        this.heartbeat = setInterval(() => {
            if (
                this.lifecycle.quitting ||
                this.heartbeatPending ||
                !this.status.connected ||
                this.status.identity.protocol < 3
            )
                return;
            this.heartbeatPending = true;
            void this.serial(async () => {
                const reply = await this.link.command("PING", 1500);
                if (!reply.ok) throw new Error(reply.message);
                if (reply.message.includes("online=0") && loaded()) reset();
            })
                .catch(() => {
                    this.status = { connected: false };
                    reset();
                })
                .finally(() => {
                    this.heartbeatPending = false;
                });
        }, 4000);
        this.heartbeat.unref();
    }

    stopHeartbeat(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
    }

    // A USB-serial device that was just plugged in is worth a status check at
    // once rather than at the window's next poll: a deck connects sooner, and
    // a board without Decky is offered sooner. Listing ports opens none.
    watchPorts(): void {
        let knownPorts: Set<string> | null = null;
        setInterval(() => {
            void DeckLink.listPorts()
                .then((ports) => {
                    const paths = new Set(ports.map((port) => port.path));
                    const added =
                        knownPorts !== null && [...paths].some((p) => !knownPorts!.has(p));
                    knownPorts = paths;
                    if (added && !this.lifecycle.quitting)
                        this.window.sendIfOpen("deck:event", { kind: "ports", at: Date.now() });
                })
                .catch(() => {});
        }, PORT_WATCH_MS).unref();
    }

    /** Close the link as Decky quits, with a BYE so the deck shows Disconnected at once. */
    async goodbye(restartingForUpdate: boolean): Promise<void> {
        // No BYE when quitting for the installer: that would turn the deck's
        // "Updating Decky" into Disconnected while the new version installs.
        if (
            !restartingForUpdate &&
            !this.serialActive &&
            this.link.openPath &&
            this.status.connected &&
            this.status.identity.protocol >= 3
        )
            await this.link.command("BYE", 350).catch(() => {});
        await this.link.close();
    }
}
