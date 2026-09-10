import { describe, expect, it } from "vitest";
import { parseWifiNetworks, parseWifiStatus, wifiJoinCommand } from "../src/main/device/wifi";
describe("Wi-Fi protocol", () => {
    it("deduplicates SSIDs by strongest signal and keeps security modes", () => {
        expect(
            parseWifiNetworks(
                "OK networks 486f6d65,-70,1;486f6d65,-40,1;4775657374,-60,0;4f6666696365,-80,2",
            ),
        ).toEqual([
            { ssid: "Home", rssi: -40, security: "password" },
            { ssid: "Guest", rssi: -60, security: "open" },
            { ssid: "Office", rssi: -80, security: "enterprise" },
        ]);
    });
    it("encodes spaces, Unicode and punctuation without injecting commands", () => {
        const command = wifiJoinCommand("Ev ağı", "word\n word");
        expect(command).not.toContain("\n");
        expect(command.split(" ")).toHaveLength(3);
        expect(Buffer.from(command.split(" ")[1]!, "hex").toString()).toBe("Ev ağı");
        expect(wifiJoinCommand("Guest", "")).toBe("WIFI_JOIN 4775657374 -");
    });
    it("rejects invalid credentials and malformed responses", () => {
        expect(() => wifiJoinCommand("", "password")).toThrow();
        expect(() => wifiJoinCommand("Wi-Fi", "short")).toThrow();
        expect(() => wifiJoinCommand("x".repeat(33), "password")).toThrow();
        expect(() => parseWifiNetworks("OK networks ZZ,-50,1")).toThrow();
    });
    it("parses connected status without exposing credentials", () => {
        expect(
            parseWifiStatus(
                "OK wifi status=connected ssid=486f6d65 ip=192.168.1.5 saved=1",
                "wifi",
                true,
            ),
        ).toEqual({
            available: true,
            transport: "wifi",
            state: "connected",
            ssid: "Home",
            ip: "192.168.1.5",
            paired: true,
        });
    });
});
