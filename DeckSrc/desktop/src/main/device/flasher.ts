/*---------------------------------------------------------------
 * Installing firmware on the deck from the desktop.
 *
 * esptool-js does the ROM bootloader protocol; `NodeWebSerialPort` gives it a
 * port. Everything here that is not esptool-js is a rule learned on this board:
 * 460800 baud, never 921600 (the CH340 corrupts transfers at that rate); every
 * image verified by checksum on the chip before it counts as written; and
 * nothing written over the Wi-Fi settings or the flash data partition.
 *--------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { ESPLoader, Transport } from "esptool-js";
import type { IEspLoaderTerminal } from "esptool-js";
import { NodeWebSerialPort } from "./web-serial";
import { PARTITION_TABLE, type FirmwareManifest } from "../../shared/firmware";

/** The fastest rate this board's CH340 has read and written 4 MB at cleanly. */
export const FLASH_BAUD = 460800;
/** Flash ID size code for 4 MB. Read directly: `detectFlashSize` falls back to "4MB" when it cannot tell. */
const FLASH_4MB = 0x16;

export interface DeviceProbe {
    chip: string;
    mac: string;
    flashSizeId: number;
    /** An ESP32-S3 with 4 MB of flash: the CrowPanel Basic 7" this firmware is built for. */
    crowPanel: boolean;
}

export type FlashProgress =
    | { stage: "connecting" }
    | { stage: "writing"; part: number; parts: number; written: number; total: number }
    | { stage: "restarting" };

export class PartitionChangeError extends Error {
    constructor() {
        super(
            "This firmware changes the deck's flash layout, which can erase its saved Wi-Fi settings and pairing.",
        );
        this.name = "PartitionChangeError";
    }
}

const md5 = (data: Uint8Array): string => createHash("md5").update(data).digest("hex");
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Put the chip in its ROM bootloader, run `job`, and always let go of the port.
 *
 * Errors carry the last few lines of esptool-js's own log, which is where the
 * useful detail is ("Failed to connect", a checksum mismatch) when something
 * goes wrong on real hardware.
 */
async function session<T>(path: string, job: (loader: ESPLoader) => Promise<T>): Promise<T> {
    const log: string[] = [];
    const terminal: IEspLoaderTerminal = {
        clean: () => {},
        writeLine: (line) => {
            log.push(line);
            if (log.length > 60) log.shift();
        },
        write: (text) => {
            if (text.trim()) log.push(text.trim());
            if (log.length > 60) log.shift();
        },
    };
    const port = new NodeWebSerialPort(path);
    const transport = new Transport(port as unknown as SerialPort, false);
    const loader = new ESPLoader({ transport, baudrate: FLASH_BAUD, terminal });
    try {
        await loader.main("default_reset");
        return await job(loader);
    } catch (error) {
        if (error instanceof PartitionChangeError) throw error;
        const detail = log.slice(-4).join(" | ");
        throw new Error(
            `${error instanceof Error ? error.message : String(error)}${detail ? ` (${detail})` : ""}`,
        );
    } finally {
        await transport.disconnect().catch(() => {});
        await port.release().catch(() => {});
    }
}

/**
 * Restart the chip into its application.
 *
 * Not `loader.after("hard_reset")`: in esptool-js 0.6.1 that only releases RTS,
 * which is already released, so the chip is never actually reset and stays in
 * the flasher stub. Found on this board - the deck was flashed, verified, and
 * then sat unresponsive until something else reset it. This is esptool's own
 * sequence: IO0 held high through DTR, then a 100 ms pulse on EN through RTS.
 */
async function restartIntoApplication(loader: ESPLoader): Promise<void> {
    await loader.transport.setDTR(false);
    await loader.transport.setRTS(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await loader.transport.setRTS(false);
}

async function identifyChip(loader: ESPLoader): Promise<DeviceProbe> {
    const chip = loader.chip.CHIP_NAME;
    const flashSizeId = ((await loader.readFlashId()) >> 16) & 0xff;
    const mac = await loader.chip.readMac(loader);
    return { chip, mac, flashSizeId, crowPanel: chip === "ESP32-S3" && flashSizeId === FLASH_4MB };
}

/**
 * Find out what is on a port, then restart it into whatever it was running.
 *
 * This resets the device twice - into the bootloader and back - so it is only
 * ever run when the user asks, never by background detection.
 */
export async function probeDevice(path: string): Promise<DeviceProbe> {
    return session(path, async (loader) => {
        const probe = await identifyChip(loader);
        await restartIntoApplication(loader);
        return probe;
    });
}

/**
 * Write a firmware package and restart the deck into it.
 *
 * @param images The bytes for each file in the manifest, already checked
 *               against its SHA-256.
 * @param allowPartitionChange Whether a different partition table may be
 *               written. False for updates: a moved NVS partition loses the
 *               saved Wi-Fi settings and pairing, so the user agrees first.
 *               True for a first install, where there are none yet.
 */
export async function flashFirmware(
    path: string,
    manifest: FirmwareManifest,
    images: Map<string, Uint8Array>,
    allowPartitionChange: boolean,
    onProgress: (progress: FlashProgress) => void,
): Promise<DeviceProbe> {
    onProgress({ stage: "connecting" });
    return session(path, async (loader) => {
        const probe = await identifyChip(loader);
        if (!probe.crowPanel)
            throw new Error(
                `This is not a CrowPanel (found ${probe.chip} with flash size code 0x${probe.flashSizeId.toString(16)}). Nothing was written.`,
            );

        const table = manifest.parts.find((part) => part.address === PARTITION_TABLE.address);
        if (table && !allowPartitionChange) {
            const current = await loader.readFlash(PARTITION_TABLE.address, table.size);
            if (!sameBytes(current, images.get(table.file)!)) throw new PartitionChangeError();
        }

        const fileArray = manifest.parts.map((part) => {
            const data = images.get(part.file)!;
            if (md5(data) !== part.md5)
                throw new Error(`${part.file} does not match its manifest.`);
            return { data, address: part.address };
        });

        await loader.writeFlash({
            fileArray,
            flashMode: "keep",
            flashFreq: "keep",
            flashSize: "keep",
            eraseAll: false,
            compress: true,
            // With this set, esptool-js checks every image on the chip after
            // writing it and throws on a mismatch - the in-app equivalent of
            // esptool's "Hash of data verified".
            calculateMD5Hash: md5,
            reportProgress: (index, written, total) =>
                onProgress({
                    stage: "writing",
                    part: index + 1,
                    parts: fileArray.length,
                    written,
                    total,
                }),
        });
        onProgress({ stage: "restarting" });
        await restartIntoApplication(loader);
        return probe;
    });
}
