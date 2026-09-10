import { describe, expect, it } from "vitest";
import { fellBackToWifi, transportOf } from "../src/shared/transport";
import type { DeckIdentity } from "../src/shared/api";

const identity = (portPath: string): DeckIdentity => ({
    portPath,
    protocol: 7,
    serial: "a4cb8fcdd274",
    cells: 15,
    columns: 5,
    rows: 3,
    keyWidth: 118,
    keyHeight: 123,
    pages: 64,
});

describe("connection transport", () => {
    it("reads Wi-Fi from a tcp:// address and USB from a COM port", () => {
        expect(transportOf(identity("tcp://192.168.1.20:47561"))).toBe("wifi");
        expect(transportOf(identity("COM5"))).toBe("usb");
    });

    it("announces only a lost USB link that came back over Wi-Fi", () => {
        expect(fellBackToWifi("usb", "wifi")).toBe(true);
        // Still on USB, a real disconnect, a fresh start, or already on Wi-Fi.
        expect(fellBackToWifi("usb", "usb")).toBe(false);
        expect(fellBackToWifi("usb", null)).toBe(false);
        expect(fellBackToWifi(null, "wifi")).toBe(false);
        expect(fellBackToWifi("wifi", "wifi")).toBe(false);
        // Returning to the cable is the priority working, not something to announce.
        expect(fellBackToWifi("wifi", "usb")).toBe(false);
    });
});
