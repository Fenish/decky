import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({
    app: { getFileIcon: vi.fn() },
    nativeImage: { createFromPath: vi.fn() },
}));
import { normalizePrograms, listPrograms } from "../src/main/programs/catalog";
import { matchPrograms, validProgramTarget } from "../src/shared/programs";
describe("installed program discovery", () => {
    it("keeps executable, shortcut and Windows-app targets while removing duplicates", () => {
        const apps = normalizePrograms([
            { name: "OpenVPN", path: "C:\\Menu\\OpenVPN.lnk", source: "start-menu" },
            { name: "OpenVPN", path: "app:OpenVPN", source: "windows" },
            { name: "Editor", path: "C:\\Apps\\editor.exe", source: "registered" },
            {
                name: "Calculator",
                path: "app:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
                source: "windows",
            },
            { name: "Bad", path: "https://example.com", source: "windows" },
        ]);
        expect(apps).toHaveLength(3);
        expect(apps.find((app) => app.name === "OpenVPN")?.path).toMatch(/\.lnk$/);
        expect(matchPrograms(apps, "open vpn")[0]?.name).toBe("OpenVPN");
    });
    it("rejects shell fragments and unsupported URI schemes", () => {
        expect(validProgramTarget('app:foo";evil')).toBe(false);
        expect(validProgramTarget("javascript:alert(1)")).toBe(false);
        expect(validProgramTarget("C:\\Apps\\tool.exe")).toBe(true);
        expect(validProgramTarget("app:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")).toBe(true);
    });
    it.runIf(process.env["DECKY_DISCOVERY_SMOKE"] === "1")(
        "reads this Windows installation without launching an app",
        async () => {
            const apps = await listPrograms();
            expect(apps.length).toBeGreaterThan(0);
            const matches = matchPrograms(apps, "openvpn");
            console.error(
                JSON.stringify({
                    installedApps: apps.length,
                    openvpn: matches.map(({ name, path }) => ({ name, path })),
                }),
            );
        },
        30000,
    );
});
