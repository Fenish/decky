/*---------------------------------------------------------------
 * Setting up the deck's Wi-Fi from Settings: its status, finding networks,
 * joining one - which pairs this PC with the deck - and forgetting it.
 * Changing anything needs the USB cable.
 *--------------------------------------------------------------*/

import { rm } from "node:fs/promises";
import { parseWifiNetworks, parseWifiStatus, saveWifiPair, wifiJoinCommand } from "../device/wifi";
import type { Reply, WifiNetwork, WifiStatus } from "../../shared/api";
import type { DeckSession } from "./session";

export class WifiSetup {
    private wifiScanning = false;

    constructor(private readonly session: DeckSession) {}

    status(): Promise<WifiStatus> {
        const { session } = this;
        return session.serial(async (): Promise<WifiStatus> => {
            if (!session.status.connected || session.status.identity.protocol < 5)
                return {
                    available: false,
                    transport: session.status.connected ? "usb" : null,
                    state: "unconfigured",
                    ssid: "",
                    ip: "",
                    paired: false,
                };
            const reply = await session.link.command("WIFI_STATUS", 2000);
            if (!reply.ok) throw new Error(reply.message);
            const result = parseWifiStatus(
                reply.message,
                session.status.identity.portPath.startsWith("tcp:") ? "wifi" : "usb",
                session.wifiPair?.serial === session.status.identity.serial,
            );
            if (session.status.identity.protocol >= 6)
                result.cacheStorage = session.status.identity.persistentCache ? "sd" : "none";
            result.encrypted = session.status.identity.protocol >= 7;
            if (
                result.state === "connected" &&
                result.ip &&
                session.wifiPair?.serial === session.status.identity.serial &&
                session.wifiPair.ip !== result.ip
            ) {
                session.wifiPair.ip = result.ip;
                await saveWifiPair(session.wifiPath, session.wifiPair);
            }
            return result;
        });
    }

    /**
     * Scan on the deck. Waiting for the results does not hold the deck's
     * queue: each look at the list is a job of its own.
     */
    async scan(): Promise<WifiNetwork[]> {
        const { session } = this;
        if (this.wifiScanning) throw new Error("A Wi-Fi scan is already running.");
        this.wifiScanning = true;
        try {
            await session.serial(async () => {
                this.requireWifi(true);
                const reply = await session.link.command("WIFI_SCAN", 2000);
                if (!reply.ok) throw new Error(reply.message);
            });
            for (let attempt = 0; attempt < 40; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                const reply = await session.serial(async () => {
                    this.requireWifi(true);
                    return session.link.command("WIFI_LIST", 2000);
                });
                if (!reply.ok) throw new Error(reply.message);
                if (!reply.message.includes("scanning")) return parseWifiNetworks(reply.message);
            }
            throw new Error("Wi-Fi scan timed out. Try again.");
        } finally {
            this.wifiScanning = false;
        }
    }

    join(ssid: unknown, password: unknown): Promise<Reply> {
        const { session } = this;
        return session.serial(async () => {
            this.requireWifi(true);
            const command = wifiJoinCommand(ssid, password);
            const pairReply = await session.link.command("WIFI_PAIR", 2000);
            const secret = pairReply.message.match(/^OK pair ([a-f0-9]{64})$/)?.[1];
            if (!pairReply.ok || !secret) throw new Error("Could not pair with Decky.");
            if (!session.status.connected) throw new Error("Decky disconnected.");
            session.wifiPair = {
                serial: session.status.identity.serial,
                ip: "",
                secret,
                preferWifi: false,
            };
            await saveWifiPair(session.wifiPath, session.wifiPair);
            const reply = await session.link.command(command, 3000);
            return {
                ok: reply.ok,
                message: reply.ok ? "Connecting to Wi-Fi…" : "Could not start Wi-Fi connection.",
            };
        });
    }

    forget(): Promise<Reply> {
        const { session } = this;
        return session.serial(async (): Promise<Reply> => {
            this.requireWifi(true);
            const reply = await session.link.command("WIFI_FORGET", 2000);
            if (!reply.ok)
                return { ok: false, message: "Decky could not forget the network. Try again." };
            // This deck's pairing on the PC goes too: with no network there is nothing
            // to reach over Wi-Fi, and joining a network fetches a pairing again.
            if (
                session.status.connected &&
                session.wifiPair?.serial === session.status.identity.serial
            ) {
                session.wifiPair = null;
                await rm(session.wifiPath, { force: true });
            }
            return { ok: true, message: "Decky forgot the Wi-Fi network." };
        });
    }

    private requireWifi(usb = false): void {
        const { status } = this.session;
        if (!status.connected) throw new Error("Connect Decky to configure Wi-Fi.");
        if (status.identity.protocol < 5)
            throw new Error("Install the wireless firmware update first.");
        if (usb && status.identity.portPath.startsWith("tcp:"))
            throw new Error("Switch to USB to change Wi-Fi settings.");
    }
}
