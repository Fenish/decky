import { safeStorage } from "electron";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import type { WifiNetwork, WifiStatus } from "../../shared/api";

export interface WifiPair {
    serial: string;
    ip: string;
    secret: string;
    preferWifi: boolean;
}
export async function loadWifiPair(path: string): Promise<WifiPair | null> {
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (
            !/^[a-f0-9]{12}$/.test(value.serial) ||
            typeof value.secret !== "string" ||
            typeof value.ip !== "string"
        )
            return null;
        const secret = safeStorage.decryptString(Buffer.from(value.secret, "base64"));
        if (!/^[a-f0-9]{64}$/.test(secret)) return null;
        return {
            serial: value.serial,
            ip: isIP(value.ip) === 4 ? value.ip : "",
            secret,
            preferWifi: value.preferWifi === true,
        };
    } catch {
        return null;
    }
}
export async function saveWifiPair(path: string, pair: WifiPair): Promise<void> {
    if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential protection is unavailable.");
    const value = { ...pair, secret: safeStorage.encryptString(pair.secret).toString("base64") };
    await writeFile(`${path}.tmp`, JSON.stringify(value), "utf8");
    await rename(`${path}.tmp`, path);
}
export function decodeSsid(hex: string): string {
    if (hex === "-") return "";
    if (!/^(?:[a-f0-9]{2}){1,32}$/i.test(hex)) throw new Error("Invalid Wi-Fi response.");
    return Buffer.from(hex, "hex").toString("utf8");
}
export function parseWifiNetworks(line: string): WifiNetwork[] {
    if (!line.startsWith("OK networks")) throw new Error("Invalid Wi-Fi scan response.");
    const results = new Map<string, WifiNetwork>();
    for (const entry of line.slice("OK networks".length).trim().split(";").filter(Boolean)) {
        const [encoded, rssi, security] = entry.split(",");
        const ssid = decodeSsid(encoded!);
        if (!ssid || !Number.isFinite(Number(rssi))) continue;
        const item: WifiNetwork = {
            ssid,
            rssi: Number(rssi),
            security: security === "0" ? "open" : security === "2" ? "enterprise" : "password",
        };
        if (!results.has(ssid) || results.get(ssid)!.rssi < item.rssi) results.set(ssid, item);
    }
    return [...results.values()].sort((a, b) => b.rssi - a.rssi);
}
export function parseWifiStatus(
    line: string,
    transport: "usb" | "wifi",
    paired: boolean,
): WifiStatus {
    const fields = Object.fromEntries(
        line
            .split(" ")
            .slice(2)
            .map((item) => item.split("=")),
    );
    if (
        !["connected", "connecting", "disconnected", "unconfigured"].includes(
            fields["status"] ?? "",
        )
    )
        throw new Error("Invalid Wi-Fi status.");
    return {
        available: true,
        transport,
        state: fields["status"] as WifiStatus["state"],
        ssid: decodeSsid(fields["ssid"] ?? "-"),
        ip: isIP(fields["ip"] ?? "") === 4 ? fields["ip"]! : "",
        paired,
    };
}
export function wifiJoinCommand(ssid: unknown, password: unknown): string {
    if (
        typeof ssid !== "string" ||
        Buffer.byteLength(ssid) < 1 ||
        Buffer.byteLength(ssid) > 32 ||
        ssid.includes("\0") ||
        typeof password !== "string" ||
        password.includes("\0") ||
        (password.length !== 0 &&
            (Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 63))
    )
        throw new Error("Choose a network and enter an 8–63 byte Wi-Fi password.");
    return `WIFI_JOIN ${Buffer.from(ssid).toString("hex")} ${password ? Buffer.from(password).toString("hex") : "-"}`;
}
export async function discoverWifi(serial: string): Promise<string[]> {
    return new Promise((resolve) => {
        const found = new Set<string>();
        const socket = createSocket("udp4");
        let finished = false;
        const finish = (): void => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try {
                socket.close();
            } catch {
                /* Not bound. */
            }
            resolve([...found]);
        };
        const timer = setTimeout(finish, 850);
        socket.on("error", finish);
        socket.on("message", (message, remote) => {
            if (message.toString() === `DECKY ${serial} 47561` && isIP(remote.address) === 4)
                found.add(remote.address);
        });
        socket.bind(0, () => {
            socket.setBroadcast(true);
            const broadcasts = new Set(["255.255.255.255"]);
            for (const entries of Object.values(networkInterfaces()))
                for (const entry of entries ?? [])
                    if (entry.family === "IPv4" && !entry.internal) {
                        const ip = entry.address.split(".").map(Number),
                            mask = entry.netmask.split(".").map(Number);
                        broadcasts.add(ip.map((part, i) => part | (255 ^ mask[i]!)).join("."));
                    }
            for (const address of broadcasts)
                socket.send("DECKY_DISCOVER", 47562, address, () => {});
        });
    });
}
