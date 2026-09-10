/*---------------------------------------------------------------
 * The firmware package the desktop app installs, and the rules it must obey.
 *
 * The flash layout comes from firmware/partitions_deck.csv. What matters here
 * is what the installer must never write: the NVS area holds the Wi-Fi
 * credentials and the pairing secret, and the data partition after the
 * application is left for the firmware's own use. Key artwork is on the
 * microSD card, which flashing never touches.
 * A merged "factory" image starting at 0x0 runs straight through NVS, which is
 * why the package is a list of separate images and not one file.
 *--------------------------------------------------------------*/

export const FLASH_SIZE = 0x400000;
/** Wi-Fi credentials and the pairing secret. Never written by an install. */
export const NVS_REGION = { start: 0x9000, end: 0xe000 };
/** The single application slot. */
export const APP_REGION = { start: 0x10000, end: 0x210000 };
/** The flash data partition, then the core dump. Never written by an install. */
export const STORAGE_REGION = { start: 0x210000, end: FLASH_SIZE };
/** Where the partition table lives, so an install can tell whether it changes it. */
export const PARTITION_TABLE = { address: 0x8000, size: 0xc00 };

export interface FirmwarePart {
    file: string;
    address: number;
    size: number;
    sha256: string;
    md5: string;
}

export interface FirmwareManifest {
    name: "decky";
    /** Human version, e.g. "1.4.0", or a git description for local builds. */
    version: string;
    /** The protocol number the firmware answers `ID` with. */
    protocol: number;
    chip: "esp32s3";
    flashSize: "4MB";
    parts: FirmwarePart[];
}

const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

const overlaps = (start: number, end: number, region: { start: number; end: number }): boolean =>
    start < region.end && end > region.start;

/**
 * Check a manifest before anything is written to a device.
 *
 * Throws with a reason rather than returning false: a rejected package should
 * say why, because the likely cause is a build script or a release asset that
 * needs fixing, not something the user can do.
 */
export function validateManifest(value: unknown): FirmwareManifest {
    if (!record(value)) throw new Error("Firmware manifest is not an object.");
    if (value.name !== "decky") throw new Error("This is not a Decky firmware package.");
    if (typeof value.version !== "string" || !/^[\w.+-]{1,64}$/.test(value.version))
        throw new Error("Firmware manifest has no valid version.");
    if (!Number.isInteger(value.protocol) || Number(value.protocol) < 1)
        throw new Error("Firmware manifest has no valid protocol number.");
    if (value.chip !== "esp32s3" || value.flashSize !== "4MB")
        throw new Error("This firmware is built for a different board.");
    if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > 8)
        throw new Error("Firmware manifest lists no images.");

    const parts: FirmwarePart[] = [];
    for (const part of value.parts) {
        if (
            !record(part) ||
            typeof part.file !== "string" ||
            !/^[\w.-]{1,64}\.bin$/.test(part.file) ||
            !Number.isInteger(part.address) ||
            !Number.isInteger(part.size) ||
            Number(part.size) <= 0 ||
            typeof part.sha256 !== "string" ||
            !/^[0-9a-f]{64}$/.test(part.sha256) ||
            typeof part.md5 !== "string" ||
            !/^[0-9a-f]{32}$/.test(part.md5)
        )
            throw new Error("Firmware manifest has a malformed image entry.");
        parts.push(part as unknown as FirmwarePart);
    }

    parts.sort((a, b) => a.address - b.address);
    let previousEnd = 0;
    for (const part of parts) {
        const end = part.address + part.size;
        if (part.address < previousEnd) throw new Error("Firmware images overlap.");
        if (end > FLASH_SIZE) throw new Error(`${part.file} runs past the end of flash.`);
        if (overlaps(part.address, end, NVS_REGION))
            throw new Error(`${part.file} would overwrite the saved Wi-Fi and pairing settings.`);
        if (overlaps(part.address, end, STORAGE_REGION))
            throw new Error(`${part.file} would overwrite the flash data partition.`);
        if (part.address >= APP_REGION.start && end > APP_REGION.end)
            throw new Error(`${part.file} is larger than the application slot.`);
        previousEnd = end;
    }
    if (!parts.some((part) => part.address === APP_REGION.start))
        throw new Error("Firmware package has no application image.");

    return { ...(value as unknown as FirmwareManifest), parts };
}

/** The numeric core of a version, so "1.4.0-3-gabc-dirty" compares as 1.4.0. */
function core(version: string): number[] | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Whether `candidate` is a newer release than `installed`.
 *
 * Only release numbers are compared. A local build ("dev", or a bare commit
 * hash) has no number, so nothing counts as newer than it and it never
 * counts as newer than anything: offering to "update" someone's own
 * development firmware with an older release would be wrong in both directions.
 *
 * `installed` is undefined for firmware from before versions were reported.
 * Every release is newer than that, or those decks would never be offered one.
 */
export function isNewerFirmware(candidate: string, installed: string | undefined): boolean {
    const next = core(candidate);
    if (!next) return false;
    if (installed === undefined) return true;
    const current = core(installed);
    if (!current) return false;
    for (let i = 0; i < 3; i++) {
        if (next[i]! !== current[i]!) return next[i]! > current[i]!;
    }
    return false;
}

/**
 * A version as people read it: plain numbers, "0.1.1". A local build describes
 * itself as the release it follows plus git detail ("0.1.1-6-g7074263-dirty");
 * only the number shows. Anything else, such as "dev", shows as reported.
 */
export function formatVersion(version: string | undefined): string {
    if (!version) return "unknown";
    const release = /^v?(\d+\.\d+\.\d+)/.exec(version);
    return release ? release[1]! : version;
}
