import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNewerFirmware, validateManifest } from "../src/shared/firmware";
import {
    downloadRelease,
    latestRelease,
    latestReleases,
    repositoryOf,
} from "../src/main/device/firmware-source";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hash = (data: Uint8Array, algorithm: "sha256" | "md5"): string =>
    createHash(algorithm).update(data).digest("hex");
const part = (file: string, address: number, data: Uint8Array) => ({
    file,
    address,
    size: data.length,
    sha256: hash(data, "sha256"),
    md5: hash(data, "md5"),
});
const bytes = (size: number, fill = 1): Uint8Array => new Uint8Array(size).fill(fill);
const IMAGES = {
    "bootloader.bin": bytes(19984, 1),
    "partitions.bin": bytes(3072, 2),
    "boot_app0.bin": bytes(8192, 3),
    "firmware.bin": bytes(1_144_512, 4),
};
const manifest = (overrides: Record<string, unknown> = {}) => ({
    name: "decky",
    version: "1.4.0",
    protocol: 7,
    chip: "esp32s3",
    flashSize: "4MB",
    parts: [
        part("bootloader.bin", 0x0, IMAGES["bootloader.bin"]),
        part("partitions.bin", 0x8000, IMAGES["partitions.bin"]),
        part("boot_app0.bin", 0xe000, IMAGES["boot_app0.bin"]),
        part("firmware.bin", 0x10000, IMAGES["firmware.bin"]),
    ],
    ...overrides,
});

describe("firmware packages", () => {
    it("accepts the four images PlatformIO writes, at PlatformIO's addresses", () => {
        expect(validateManifest(manifest()).parts.map((p) => p.address)).toEqual([
            0x0, 0x8000, 0xe000, 0x10000,
        ]);
    });

    it("refuses a merged factory image, because it would erase the Wi-Fi settings", () => {
        const merged = bytes(0x10000 + 1_144_512);
        expect(() =>
            validateManifest(manifest({ parts: [part("firmware.factory.bin", 0x0, merged)] })),
        ).toThrow(/Wi-Fi and pairing/);
    });

    it("refuses anything that reaches the data partition or overflows the app slot", () => {
        const store = manifest();
        store.parts.push(part("extra.bin", 0x300000, bytes(16)));
        expect(() => validateManifest(store)).toThrow(/data partition/);
        expect(() =>
            validateManifest(manifest({ parts: [part("firmware.bin", 0x10000, bytes(0x200001))] })),
        ).toThrow(/data partition|application slot/);
    });

    it("refuses packages for other boards, without an app, or with unsafe file names", () => {
        expect(() => validateManifest(manifest({ flashSize: "16MB" }))).toThrow(/different board/);
        expect(() =>
            validateManifest(manifest({ parts: [part("bootloader.bin", 0, bytes(10))] })),
        ).toThrow(/no application/);
        expect(() =>
            validateManifest(manifest({ parts: [part("../../evil.bin", 0x10000, bytes(10))] })),
        ).toThrow(/malformed/);
    });

    it("compares release numbers only, and treats unversioned firmware as older", () => {
        expect(isNewerFirmware("1.4.0", "1.3.9")).toBe(true);
        expect(isNewerFirmware("1.10.0", "1.9.0")).toBe(true);
        expect(isNewerFirmware("1.4.0", "1.4.0")).toBe(false);
        expect(isNewerFirmware("1.3.0", "1.4.0")).toBe(false);
        // A local build on the deck is never nagged to "update" to a release...
        expect(isNewerFirmware("1.4.0", "dev")).toBe(false);
        expect(isNewerFirmware("dev", "1.4.0")).toBe(false);
        // ...but firmware from before versions existed is offered one.
        expect(isNewerFirmware("1.4.0", undefined)).toBe(true);
        // A build shortly after a release still reads as that release.
        expect(isNewerFirmware("1.4.0", "1.4.0-3-gabc1234-dirty")).toBe(false);
    });

    it("reads the GitHub repository from package.json's repository field", () => {
        expect(repositoryOf("github:someone/decky")).toBe("someone/decky");
        expect(repositoryOf({ type: "git", url: "https://github.com/someone/decky.git" })).toBe(
            "someone/decky",
        );
        expect(repositoryOf("git@github.com:someone/decky.git")).toBe("someone/decky");
        expect(repositoryOf(undefined)).toBeNull();
        expect(repositoryOf("https://gitlab.com/someone/decky")).toBeNull();
    });
});

describe("firmware from GitHub releases", () => {
    // One release per version carries the installer and the firmware files; the
    // firmware keeps its own version, which only its manifest states.
    const firmwareIn: Record<string, string> = {
        "v0.5.0": "1.6.0",
        "v0.4.1-beta": "1.5.0",
        "v0.4.0": "1.4.0",
        "v0.3.0": "1.3.0",
    };
    const releases = [
        // Listed oldest first on purpose: the newest release wins by date, not by position.
        { tag_name: "v0.3.0", published_at: "2026-09-01T10:00:00Z" },
        { tag_name: "v0.4.0", published_at: "2026-09-03T10:00:00Z" },
        { tag_name: "v0.5.0", draft: true, published_at: null },
        { tag_name: "v0.4.1-beta", prerelease: true, published_at: "2026-09-04T10:00:00Z" },
        { tag_name: "notes-only", published_at: "2026-09-05T10:00:00Z", firmware: false },
    ].map(({ firmware = true, ...release }) => ({
        ...release,
        html_url: `https://github.com/someone/decky/releases/tag/${release.tag_name}`,
        assets: [
            ...(firmware
                ? [
                      {
                          name: `Decky-Setup-${release.tag_name.slice(1)}.exe`,
                          size: 90_000_000,
                          browser_download_url: `https://example.test/${release.tag_name}/installer`,
                      },
                  ]
                : []),
            ...(firmware
                ? [
                      "manifest.json",
                      "bootloader.bin",
                      "partitions.bin",
                      "boot_app0.bin",
                      "firmware.bin",
                  ].map((name) => ({
                      name,
                      size: 1000,
                      browser_download_url: `https://example.test/${release.tag_name}/${name}`,
                  }))
                : []),
        ],
    }));
    let folder = "";
    const serve = (tamper = false) =>
        vi.stubGlobal("fetch", async (url: string) => {
            if (url.includes("/releases?")) return new Response(JSON.stringify(releases));
            const [, tag, name] = /example\.test\/([^/]+)\/(.+)$/.exec(url)!;
            const version = firmwareIn[tag!]!;
            if (name === "manifest.json")
                return new Response(JSON.stringify(manifest({ version })));
            const data = IMAGES[name as keyof typeof IMAGES].slice();
            if (tamper && name === "firmware.bin") data[100] ^= 0xff;
            return new Response(data);
        });
    afterEach(async () => {
        vi.unstubAllGlobals();
        if (folder) await rm(folder, { recursive: true, force: true });
        folder = "";
    });

    it("reads the firmware from the newest published release, skipping drafts, pre-releases and releases without firmware", async () => {
        serve();
        const release = await latestRelease("someone/decky");
        expect(release?.tag).toBe("v0.4.0");
        expect(release?.version).toBe("1.4.0");
        expect(release?.protocol).toBe(7);
    });

    it("finds the newest Decky with an installer from the same release list", async () => {
        serve();
        const { app, firmware } = await latestReleases("someone/decky");
        expect(app).toEqual({
            version: "0.4.0",
            tag: "v0.4.0",
            page: "https://github.com/someone/decky/releases/tag/v0.4.0",
            installer: "https://example.test/v0.4.0/installer",
        });
        expect(firmware?.version).toBe("1.4.0");
    });

    it("downloads and verifies a release, and refuses one whose image was altered", async () => {
        folder = await mkdtemp(join(tmpdir(), "decky-fw-"));
        serve();
        const good = await downloadRelease((await latestRelease("someone/decky"))!, folder);
        expect(good.images.get("firmware.bin")?.length).toBe(1_144_512);

        await rm(folder, { recursive: true, force: true });
        folder = await mkdtemp(join(tmpdir(), "decky-fw-"));
        serve(true);
        await expect(
            downloadRelease((await latestRelease("someone/decky"))!, folder),
        ).rejects.toThrow(/does not match/);
    });
});
