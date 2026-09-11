import { duplicateKey, moveKey } from "../shared/key-layout";
import type { KeyLocation } from "../shared/key-layout";
import { getProgramIcon, listPrograms } from "./programs/catalog";
import { KeyStateStore } from "./actions/key-state";
import { pageStateMask } from "./device/toggle-state";
import {
    loadWifiPair,
    saveWifiPair,
    discoverWifi,
    parseWifiNetworks,
    parseWifiStatus,
    wifiJoinCommand,
} from "./device/wifi";
import type { WifiPair } from "./device/wifi";
import type { WifiStatus } from "../shared/api";
import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { appendFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, DeckLink } from "./device/serial";
import { loadConfig, saveConfig } from "./config/store";
import { ActionRunner } from "./actions/runner";
import { toSendKeys } from "./actions/hotkeys";
import {
    BACK_CELL,
    createConfig,
    isWidgetKey,
    keyAddress,
    retireWidgets,
    validateConfig,
} from "../shared/config";
import type { DeckConfig, DeckPage, KeyStates } from "../shared/config";
import type { DeckStatus, Reply, PageUpload, Warmup } from "../shared/api";
import { fellBackToWifi, transportOf } from "../shared/transport";
import packageJson from "../../package.json";
import { flashFirmware, PartitionChangeError, probeDevice } from "./device/flasher";
import {
    bundledManifest,
    latestReleases,
    loadPackage,
    repositoryOf,
    type AppRelease,
    type FirmwarePackage,
    type FirmwareRelease,
} from "./device/firmware-source";
import { cancelAppUpdate, canInstallUpdates, installAppUpdate } from "./app-update";
import { formatVersion, isNewerFirmware } from "../shared/firmware";
import {
    dialTimer,
    HOLD_MS,
    PingWatcher,
    pressWidget,
    SWIPE_PX,
    WHEEL_STEP_PX,
    WidgetStore,
} from "./widgets";
import { encodeLivePatch } from "../shared/live-patch";
import { deckTurned, diceFaces, hasWheel } from "../shared/widgets";
import { WindowsHost } from "./system/windows-host";
import { WidgetFeeds } from "./widget-feeds";
import { decodeWheelSpec } from "../shared/wheel-spec";
import { decodeSlide } from "../shared/slide-spec";
import { unpackPose } from "../shared/die";
import type { Widget } from "../shared/widgets";
import type {
    AppUpdateProgress,
    FirmwareInfo,
    FirmwareInstallRequest,
    FirmwareInstallResult,
    FirmwareOffer,
    FirmwareProgress,
} from "../shared/api";
import type { Transport } from "../shared/transport";
app.setName("Decky");
app.setAppUserModelId("app.decky.desktop");
const link = new DeckLink();
const runner = new ActionRunner();
const keyStates = new KeyStateStore();
// Widget state (counts, running timers), saved beside the profile; set up once the app is ready.
let widgetStore!: WidgetStore;
let pings!: PingWatcher;
// Readings for widgets that show the PC and the web: load, volume, playing, prices.
let feeds!: WidgetFeeds;
// Widget keys held down on the deck. `hold` turns the press into a hold when
// it fires, and is null once it has or the finger swiped. A swipe turns an
// adjustable countdown's wheel: `applied` steps so far from where it began.
interface WidgetPress {
    hold: ReturnType<typeof setTimeout> | null;
    startY?: number;
    applied: number;
    swiped: boolean;
}
const widgetPresses = new Map<string, WidgetPress>();
// The keys the deck reports finger movement on, as last sent; null if unknown.
let dragMask: number | null = null;
// The newest picture asked for each widget key, until its turn to be sent: a
// wheel turned faster than its patches travel skips the pictures between.
const liveQueue = new Map<string, [frame: unknown, slide: unknown]>();
// Keys the deck turns a wheel on, on the page it shows (page id and
// signature): the look's CRC, the label it rests on, and the times behind
// its labels. The deck drops them when another page shows or a picture is
// sent for the key.
interface ArmedWheel {
    kind: "drum" | "dial" | "die";
    pageId: string;
    signature: number;
    crc: number;
    index: number;
    values: number[];
    /** Where a roll still spinning will land. */
    rolling?: number;
}
const wheels = new Map<number, ArmedWheel>();
// As liveQueue, for wheels: the newest arming asked for each key.
const wheelQueue = new Map<string, unknown[]>();
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
// Every size from 16 to 256 px, so the tray and taskbar stay sharp at any display scale.
const appIcon = join(__dirname, "../../resources/icon.ico");
let quitting = false;
// Set when Decky quits for its installer: the deck is left showing the update.
let restartingForUpdate = false;
let config = createConfig();
let configPath = "";
let wifiPath = "";
let wifiPair: WifiPair | null = null;
let wifiScanning = false;
let storageWarningShown = false;
let status: DeckStatus = { connected: false };
// USB-serial ports that did not answer ID, and how many times in a row. Two
// silent asks a moment apart - a deck plugged in just now may still be starting
// up - and the Disconnected page offers to set the device up.
const silentPorts = new Map<string, number>();
const SILENT_CHECKS = 2;
const SILENT_RECHECK_MS = 1000;
// How often the list of USB-serial ports is compared for new arrivals.
const PORT_WATCH_MS = 1000;
// Transport of the last good connection, kept across a heartbeat failure so a
// USB link that came back over Wi-Fi can be announced.
let lastTransport: Transport | null = null;
// While on Wi-Fi, USB ports that turned out not to be this deck, and when.
const notThisDeck = new Map<string, number>();
const NOT_THIS_DECK_MS = 30_000;
const usbProbe = new DeckLink();
// The newest GitHub firmware release, once the user has asked for it.
let latestFirmware: FirmwareRelease | null = null;
// The newest Decky on GitHub. Both are refreshed in the background.
let latestApp: AppRelease | null = null;
const UPDATE_CHECK_MS = 15 * 60_000;
let updateCheck: Promise<void> | null = null;
// Silent USB devices the user checked and that turned out to be a CrowPanel.
// A first install is only allowed on one of these.
const confirmedCrowPanels = new Set<string>();
// Shipped inside the app: packaged under resources/ by electron-builder, and in
// development the folder PlatformIO's bundle step writes to.
const bundledFirmwareFolder = (): string => join(app.getAppPath(), "resources", "firmware");
// package.json's standard "repository" field; absent until the project is published.
const firmwareRepository = (): string | null =>
    repositoryOf((packageJson as { repository?: unknown }).repository);

async function firmwareInfo(): Promise<FirmwareInfo> {
    const bundled = await bundledManifest(bundledFirmwareFolder());
    const installed = status.connected
        ? { protocol: status.identity.protocol, version: status.identity.firmwareVersion }
        : null;
    const offers: FirmwareOffer[] = [];
    if (bundled)
        offers.push({ source: "bundled", version: bundled.version, protocol: bundled.protocol });
    if (latestFirmware)
        offers.push({
            source: "github",
            version: latestFirmware.version,
            protocol: latestFirmware.protocol,
        });
    // Newer means a newer protocol, or the same protocol at a newer release
    // number - never an older protocol, whatever its version says.
    const newer = (offer: FirmwareOffer): boolean =>
        installed !== null &&
        (offer.protocol > installed.protocol ||
            (offer.protocol === installed.protocol &&
                isNewerFirmware(offer.version, installed.version)));
    const best = offers
        .filter(newer)
        .sort(
            (a, b) => b.protocol - a.protocol || (isNewerFirmware(a.version, b.version) ? -1 : 1),
        )[0];
    return {
        appVersion: app.getVersion(),
        installed,
        transport: status.connected ? transportOf(status.identity) : null,
        bundled: bundled ? { version: bundled.version, protocol: bundled.protocol } : null,
        latest: latestFirmware
            ? { version: latestFirmware.version, protocol: latestFirmware.protocol }
            : null,
        repository: firmwareRepository(),
        update: best ?? null,
        appUpdate:
            latestApp && isNewerFirmware(latestApp.version, app.getVersion())
                ? { version: latestApp.version, canInstall: canInstallUpdates() }
                : null,
    };
}

/**
 * Ask GitHub for the newest release, for Decky and the deck's firmware alike,
 * and tell the window. One check at a time: a manual check during the
 * background one waits for it rather than asking twice.
 */
function checkForUpdates(): Promise<void> {
    updateCheck ??= (async () => {
        const repository = firmwareRepository();
        if (!repository) throw new Error("No GitHub repository is set for releases.");
        // Passing what is already known: an unchanged release is not downloaded again.
        const found = await latestReleases(repository, latestFirmware);
        latestFirmware = found.firmware;
        latestApp = found.app;
        if (window && !window.isDestroyed()) window.webContents.send("updates:changed");
    })().finally(() => {
        updateCheck = null;
    });
    return updateCheck;
}

async function installFirmware(request: unknown): Promise<FirmwareInstallResult> {
    const { source, path, allowPartitionChange } = (request ??
        {}) as Partial<FirmwareInstallRequest>;
    if (source !== "bundled" && source !== "github") throw new Error("Invalid firmware source.");
    let target: string;
    let firstInstall = false;
    if (path !== undefined) {
        if (typeof path !== "string" || !confirmedCrowPanels.has(path))
            throw new Error("Check the device before installing firmware on it.");
        target = path;
        firstInstall = true;
    } else {
        if (!status.connected) throw new Error("Connect Decky first.");
        if (transportOf(status.identity) !== "usb")
            return { ok: false, message: "Connect the USB cable to update the firmware." };
        target = status.identity.portPath;
    }
    const progress = (update: FirmwareProgress): void => {
        window?.webContents.send("firmware:progress", update);
    };
    let firmware: FirmwarePackage;
    if (source === "github") {
        if (!latestFirmware) throw new Error("Check GitHub for firmware first.");
        // Downloaded and checked when GitHub was last asked.
        firmware = latestFirmware.firmware;
    } else {
        firmware = await loadPackage(bundledFirmwareFolder());
    }
    // From here the flasher owns the port. This runs inside the serial queue,
    // so status checks and heartbeats wait for it instead of reopening the port.
    await link.close();
    status = { connected: false };
    resetDeviceCache();
    try {
        await flashFirmware(
            target,
            firmware.manifest,
            firmware.images,
            firstInstall || allowPartitionChange === true,
            progress,
        );
    } catch (error) {
        if (error instanceof PartitionChangeError)
            return { ok: false, partitionChange: true, message: error.message };
        return {
            ok: false,
            message: `Firmware was not installed: ${error instanceof Error ? error.message : String(error)}`,
        };
    } finally {
        confirmedCrowPanels.delete(target);
        silentPorts.delete(target);
    }
    return {
        ok: true,
        message: `Firmware ${formatVersion(firmware.manifest.version)} installed. Decky is restarting.`,
    };
}
let deviceReady = false;
let displayed: { pageId: string; signature: number; frames: Buffer[] } | null = null;
let serialQueue: Promise<unknown> = Promise.resolve();
let serialActive = false;
let cacheInitialized = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let heartbeatPending = false;
let closing = false;
// Pages the deck holds, as sent or confirmed this session. `toggles` names the ON
// artwork that went with them, cell and CRC-32 of each.
const uploaded = new Map<string, { signature: number; frames: Buffer[]; toggles: string }>();
// Keys LIVE patches drew into, in each copy of a page the deck holds - by page
// id, then signature - with the picture there now. Everywhere else a copy holds
// the pictures it was sent. A patched key stays patched when its copy is shown
// again or copied into the page's next version, so it is put right before a
// key that is no longer a widget can keep a widget's picture.
const livePatched = new Map<string, Map<number, Map<number, Buffer>>>();
function patchesIn(pageId: string, signature: number): Map<number, Buffer> {
    const copies = livePatched.get(pageId) ?? new Map<number, Map<number, Buffer>>();
    const patches = copies.get(signature) ?? new Map<number, Buffer>();
    livePatched.set(pageId, copies.set(signature, patches));
    return patches;
}
// Text the deck slides along on keys, in each copy of a page it holds - by
// page id, then signature - as the CRC of the SLIDE payload. A copy's text
// goes with it, and a new version of a page starts with none (slide=1).
const liveSlides = new Map<string, Map<number, Map<number, number>>>();
function slidesIn(pageId: string, signature: number): Map<number, number> {
    const copies = liveSlides.get(pageId) ?? new Map<number, Map<number, number>>();
    const slides = copies.get(signature) ?? new Map<number, number>();
    liveSlides.set(pageId, copies.set(signature, slides));
    return slides;
}
const toggleArtwork = (toggleFrames: PageUpload["toggleFrames"]): string =>
    (toggleFrames ?? [])
        .map((item) => `${item.cell}:${crc32(Buffer.from(item.frame))}`)
        .sort()
        .join(",");
let saveQueue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
    const wrapped = async (): Promise<T> => {
        serialActive = true;
        try {
            return await job();
        } finally {
            serialActive = false;
        }
    };
    const next = serialQueue.then(wrapped, wrapped);
    serialQueue = next.catch(() => {});
    return next;
}
/**
 * What the deck printed that was no reply - a crash report, a boot banner -
 * and why it last started, kept in `%APPDATA%/Decky/deck.log`. A deck that
 * reboots mid-session otherwise leaves no trace: its crash report goes to the
 * serial line, which nothing reads.
 */
let deckLogBytes = 0;
function deckLog(line: string): void {
    const text = `${new Date().toISOString()}  ${line}\n`;
    // A few hundred KB at most: then it starts over.
    const path = join(app.getPath("userData"), "deck.log");
    const write = deckLogBytes > 256 * 1024 ? writeFile(path, text) : appendFile(path, text);
    deckLogBytes = deckLogBytes > 256 * 1024 ? text.length : deckLogBytes + text.length;
    void write.catch(() => {});
}
/** A deck that restarted because it crashed, a watchdog fired or its supply dipped: said so. */
function noteRestart(reason: string | undefined): void {
    if (!reason || !["panic", "taskwdt", "intwdt", "wdt", "brownout"].includes(reason)) return;
    deckLog(`the deck last restarted: ${reason}`);
    window?.webContents.send("action:activity", {
        at: Date.now(),
        label: "Decky",
        ok: false,
        message:
            reason === "brownout"
                ? "The deck restarted because its power dipped. Try another USB port or cable."
                : "The deck restarted after a fault. Details are in deck.log.",
    });
}
function resetDeviceCache(): void {
    storageWarningShown = false;
    cacheInitialized = false;
    deviceReady = false;
    displayed = null;
    uploaded.clear();
    livePatched.clear();
    liveSlides.clear();
    dragMask = null;
    wheels.clear();
    if (window && !window.isDestroyed())
        window.webContents.send("deck:event", { kind: "reset", at: Date.now() });
}
async function connectWireless(): Promise<boolean> {
    if (!wifiPair) return false;
    const addresses = wifiPair.ip ? [wifiPair.ip] : [];
    for (let stage = 0; stage < 2; stage++) {
        if (stage === 1)
            addresses.push(
                ...(await discoverWifi(wifiPair.serial)).filter((ip) => !addresses.includes(ip)),
            );
        for (const address of addresses.splice(0, 4)) {
            const identity = await link.identifyNetwork(address, wifiPair.secret);
            if (identity && identity.serial === wifiPair.serial) {
                status = { connected: true, identity };
                wifiPair.ip = address;
                await saveWifiPair(wifiPath, wifiPair);
                return true;
            }
            await link.close();
        }
    }
    return false;
}
function requireWifi(usb = false): void {
    if (!status.connected) throw new Error("Connect Decky to configure Wi-Fi.");
    if (status.identity.protocol < 5)
        throw new Error("Install the wireless firmware update first.");
    if (usb && status.identity.portPath.startsWith("tcp:"))
        throw new Error("Switch to USB to change Wi-Fi settings.");
}
function validateFrames(frames: unknown): asserts frames is Uint8Array[] {
    if (!status.connected) throw new Error("Decky is disconnected.");
    const bytes = status.identity.keyWidth * status.identity.keyHeight * 2;
    if (
        !Array.isArray(frames) ||
        frames.length !== 15 ||
        frames.some((frame) => !(frame instanceof Uint8Array) || frame.length !== bytes)
    )
        throw new Error("Invalid page image data.");
}
async function transferPage(
    pageId: string,
    frames: Uint8Array[],
    cacheOnly = false,
    toggleFrames?: PageUpload["toggleFrames"],
): Promise<Reply> {
    validateFrames(frames);
    const index = config.pages.findIndex((page) => page.id === pageId);
    if (index < 0) throw new Error("Page no longer exists.");
    const signature = crc32(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
    const independentToggles = status.connected && status.identity.protocol >= 4;
    if (independentToggles) {
        const expected = Object.entries(config.pages[index]!.keys)
            .filter(
                ([cell, key]) =>
                    key.behavior === "toggle" &&
                    !(config.pages[index]!.parentId && Number(cell) === BACK_CELL),
            )
            .map(([cell]) => Number(cell));
        if (
            !Array.isArray(toggleFrames) ||
            toggleFrames.length !== expected.length ||
            new Set(toggleFrames.map((item) => item?.cell)).size !== expected.length ||
            toggleFrames.some(
                (item) =>
                    !item ||
                    !expected.includes(item.cell) ||
                    !(item.frame instanceof Uint8Array) ||
                    item.frame.length !== frames[0]!.length,
            )
        )
            throw new Error("Invalid toggle artwork.");
    }
    const toggles = independentToggles ? toggleArtwork(toggleFrames) : "";
    // A page the deck already holds with this exact artwork, ON appearances
    // included, opens with one STATE. Over Wi-Fi every command is a round trip,
    // and a CACHE plus an ALT check per toggle key made a page with toggles
    // visibly slower to open than one without. If the deck has dropped the page
    // since, STATE is refused and the full exchange below runs.
    const known = uploaded.get(pageId);
    if (
        !cacheOnly &&
        independentToggles &&
        known?.signature === signature &&
        known.toggles === toggles
    ) {
        const shown = await link.command(
            `STATE ${index} ${signature} ${pageStateMask(config.pages[index]!, keyStates.snapshot())}`,
            2000,
        );
        if (shown.ok) {
            const restored = await restoreKeys(pageId, index, signature);
            if (!restored.ok) return restored;
            displayed = { pageId, ...known };
            forgetHiddenWheels();
            deviceReady = config.activePageId === pageId;
            if (deviceReady) await syncDrag(config.pages[index]!);
            return { ok: true, message: "Keys synced." };
        }
        uploaded.delete(pageId);
    }
    let reply = await link.command(
        `${cacheOnly || independentToggles ? "CACHE" : "PAGE"} ${index} ${signature}`,
        5000,
    );
    if (!reply.ok) return reply;
    const previous = uploaded.get(pageId) ?? (displayed?.pageId === pageId ? displayed : null);
    if (!reply.message.includes("cached=1")) {
        const base = Number(reply.message.match(/base=(\d+)/)?.[1]);
        const incremental = reply.message.includes("copied=1") && previous?.signature === base;
        // The deck starts this version from its copy of `base`, whose own
        // pictures are exactly as they were sent: live pictures are kept
        // apart, and carried into the version (`live=` names them). So only
        // keys whose picture changed go, each where the deck takes patches
        // (live=1) as one against the picture it holds - a style change on a
        // page of live widgets is one small patch, not every widget again.
        const patching = status.connected && status.identity.live === true;
        const { keyWidth: width, keyHeight: height } = status.connected
            ? status.identity
            : { keyWidth: 0, keyHeight: 0 };
        const copiedPatches = incremental ? livePatched.get(pageId)?.get(base) : undefined;
        const carried = Number(reply.message.match(/\blive=(\d+)/)?.[1] ?? 0);
        livePatched.get(pageId)?.delete(signature);
        liveSlides.get(pageId)?.delete(signature);
        const sent = new Set<number>();
        try {
            for (let cell = 0; cell < 15; cell++) {
                const frame = frames[cell]!;
                if (incremental && previous!.frames[cell]!.equals(Buffer.from(frame))) continue;
                sent.add(cell);
                if (!frame.some((byte) => byte !== 0))
                    reply = await link.command(`BLANK ${cell}`, 2000);
                else if (patching) {
                    // Against the copy's own picture; in a fresh copy the
                    // deck holds nothing known, and the patch is the whole key.
                    const held = incremental ? previous!.frames[cell]! : null;
                    const payload = encodeLivePatch(held, frame, width, height);
                    reply = await link.push(
                        cell,
                        payload,
                        () => {},
                        `PATCH ${cell} ${payload.length} ${crc32(payload)}`,
                    );
                } else reply = await link.push(cell, frame, () => {});
                if (!reply.ok) {
                    await link.command("ABORT", 1000);
                    return reply;
                }
            }
            reply = await link.command(`COMMIT ${signature}`, 5000);
            reportStorageFailure(reply);
            if (!reply.ok) return reply;
        } catch (error) {
            await link.command("ABORT", 1000).catch(() => {});
            throw error;
        }
        // The live pictures the version carried, with the text sliding over
        // them: kept where the key is still a widget whose picture is known;
        // dropped where it moved or went, or it would go on showing its last.
        const patches = patchesIn(pageId, signature);
        for (let cell = 0; cell < 15; cell++) {
            if (!(carried & (1 << cell)) || sent.has(cell)) continue;
            const picture = copiedPatches?.get(cell);
            if (picture && isWidgetKey(config.pages[index]!, cell)) {
                patches.set(cell, picture);
                const text = liveSlides.get(pageId)?.get(base)?.get(cell);
                if (text !== undefined) slidesIn(pageId, signature).set(cell, text);
                continue;
            }
            reply = await link.command(`LIVE ${index} ${signature} ${cell} 0 0 0`, 2000);
            if (!reply.ok) return reply;
        }
        // A commit drops the deck's other copies of the page but the one shown.
        for (const copies of [livePatched.get(pageId), liveSlides.get(pageId)])
            for (const kept of copies?.keys() ?? [])
                if (
                    kept !== signature &&
                    !(displayed?.pageId === pageId && displayed.signature === kept)
                )
                    copies!.delete(kept);
    } else {
        // A copy the deck kept: perhaps the very one the patches went to, and
        // the same pictures with a widget moved share its signature. Read back
        // from the card, it is as it was sent, and slides nothing.
        if (reply.message.includes("storage=sd")) {
            livePatched.get(pageId)?.delete(signature);
            liveSlides.get(pageId)?.delete(signature);
        }
        reply = await restoreKeys(pageId, index, signature);
        if (!reply.ok) return reply;
    }
    if (independentToggles)
        for (const alternate of toggleFrames!) {
            reply = await link.push(
                alternate.cell,
                alternate.frame,
                () => {},
                `ALT ${index} ${signature} ${alternate.cell} ${alternate.frame.length} ${crc32(alternate.frame)}`,
            );
            reportStorageFailure(reply);
            if (!reply.ok) return reply;
        }
    const record = { signature, frames: frames.map((frame) => Buffer.from(frame)), toggles };
    uploaded.set(pageId, record);
    if (!cacheOnly) {
        if (independentToggles) {
            reply = await activateState(pageId);
            if (!reply.ok) return reply;
        }
        displayed = { pageId, ...record };
        forgetHiddenWheels();
        deviceReady = config.activePageId === pageId;
        if (deviceReady) await syncDrag(config.pages[index]!);
    }
    return { ok: true, message: cacheOnly ? "Page cached." : "Keys synced." };
}
/**
 * Show the page's own pictures again on keys in the deck's copy `signature`
 * that have live pictures and are widgets no longer - their live picture and
 * sliding text dropped. Widget keys keep theirs; their next patch goes on top.
 */
async function restoreKeys(pageId: string, index: number, signature: number): Promise<Reply> {
    const patches = livePatched.get(pageId)?.get(signature);
    const slides = liveSlides.get(pageId)?.get(signature);
    const page = config.pages[index];
    if ((!patches?.size && !slides?.size) || !page || !status.connected)
        return { ok: true, message: "" };
    for (const cell of new Set([...(slides?.keys() ?? []), ...(patches?.keys() ?? [])])) {
        if (isWidgetKey(page, cell)) continue;
        // The key's own picture is intact: dropping its live one shows it,
        // and drops the text sliding over it too.
        const reply = patches?.has(cell)
            ? await link.command(`LIVE ${index} ${signature} ${cell} 0 0 0`, 2000)
            : await syncSlide(pageId, index, signature, cell, null);
        if (!reply.ok) return reply;
        patches?.delete(cell);
        slides?.delete(cell);
    }
    return { ok: true, message: "" };
}
function reportStorageFailure(reply: Reply): void {
    if (
        !storageWarningShown &&
        status.connected &&
        status.identity.persistentCache &&
        reply.ok &&
        reply.message.includes("stored=0")
    ) {
        storageWarningShown = true;
        window?.webContents.send("action:activity", {
            at: Date.now(),
            label: "SD card",
            ok: false,
            message:
                "Artwork is working in memory, but the SD card could not save it. Check the card and free space.",
        });
    }
}
async function activateState(pageId: string): Promise<Reply> {
    const index = config.pages.findIndex((page) => page.id === pageId);
    const record = uploaded.get(pageId);
    if (index < 0 || !record) return { ok: false, message: "Page is not ready." };
    return link.command(
        `STATE ${index} ${record.signature} ${pageStateMask(config.pages[index]!, keyStates.snapshot())}`,
        2000,
    );
}
async function persist(
    next: DeckConfig,
    afterReconcile?: (previous: KeyStates) => void,
): Promise<DeckConfig> {
    validateConfig(next);
    for (const page of next.pages)
        for (const key of Object.values(page.keys)) {
            const steps = key.action.kind === "macro" ? key.action.steps : [key.action];
            for (const step of steps)
                if (step.kind === "hotkey" && toSendKeys(step.keys) === null)
                    throw new Error(
                        "Unsupported hotkey. Use Ctrl, Alt, Shift and a key; Windows-key combinations are not supported yet.",
                    );
        }
    if (
        JSON.stringify(config.pages.find((p) => p.id === config.activePageId)) !==
        JSON.stringify(next.pages.find((p) => p.id === next.activePageId))
    )
        deviceReady = false;
    const write = saveQueue.then(async () => {
        await saveConfig(configPath, next);
        const previousStates = keyStates.snapshot();
        keyStates.reconcile(config, next);
        afterReconcile?.(previousStates);
        widgetStore.reconcile(next);
        config = next;
        pings.sync(next);
        feeds.sync(next);
        for (const id of uploaded.keys())
            if (!next.pages.some((page) => page.id === id)) uploaded.delete(id);
        for (const copies of [livePatched, liveSlides])
            for (const id of copies.keys())
                if (!next.pages.some((page) => page.id === id)) copies.delete(id);
        window?.webContents.send("keys:states", keyStates.snapshot());
    });
    saveQueue = write.catch(() => {});
    await write;
    window?.webContents.send("config:changed", config);
    return config;
}
async function navigate(pageId: unknown): Promise<DeckConfig> {
    if (typeof pageId !== "string" || !config.pages.some((p) => p.id === pageId))
        throw new Error("Page not found.");
    deviceReady = false;
    await persist({ ...config, activePageId: pageId });
    return config;
}
async function runKey(pageId: unknown, cell: unknown): Promise<Reply> {
    if (
        typeof pageId !== "string" ||
        !Number.isInteger(cell) ||
        Number(cell) < 0 ||
        Number(cell) >= 15
    )
        throw new Error("Invalid key.");
    const page = config.pages.find((p) => p.id === pageId);
    if (!page) throw new Error("Page not found.");
    if (Number(cell) === BACK_CELL && page.parentId) {
        await navigate(page.parentId);
        return { ok: true, message: "Back" };
    }
    const key = page.keys[String(cell)];
    if (!key) return { ok: false, message: "Assign an action to this key first." };
    if (key.action.kind === "widget")
        return useWidget(page.id, Number(cell), key.action.widget, false);
    const reply =
        key.action.kind === "page"
            ? (await navigate(key.action.pageId), { ok: true, message: "Page opened." })
            : await runner.run(key.action);
    if (keyStates.complete(page.id, Number(cell), key, reply.ok)) {
        const direct = status.connected && status.identity.protocol >= 4;
        if (!direct) deviceReady = false;
        window?.webContents.send("keys:states", keyStates.snapshot());
        if (direct && deviceReady && config.activePageId === page.id) {
            const displayReply = await serial(async () => {
                if (!deviceReady || config.activePageId !== page.id)
                    return { ok: true, message: "Page changed." };
                return activateState(page.id);
            });
            if (!displayReply.ok)
                window?.webContents.send("action:activity", {
                    at: Date.now(),
                    label: key.label,
                    ok: false,
                    message: displayReply.message,
                });
        }
    }
    window?.webContents.send("action:activity", { at: Date.now(), label: key.label, ...reply });
    return reply;
}
/**
 * A tap or a hold on a widget key. Widgets change their own state rather than
 * running an action, or act on the PC: mute, play or pause, open Task Manager.
 */
function useWidget(pageId: string, cell: number, widget: Widget, hold: boolean): Reply {
    const address = keyAddress(pageId, cell);
    const failed = (error: unknown): void =>
        void window?.webContents.send("action:activity", {
            at: Date.now(),
            label: "Widget",
            ok: false,
            message: String(error),
        });
    switch (widget.type) {
        case "ping":
            if (hold) return { ok: true, message: "Pings run on their own." };
            pings.now(address);
            return { ok: true, message: `Pinging ${widget.host}.` };
        case "volume":
        case "mic":
            if (hold) return { ok: true, message: "Tap to mute or unmute." };
            feeds.toggleMute(address, widget.type === "mic").catch(failed);
            return { ok: true, message: "Muting or unmuting." };
        case "media":
            feeds.control(hold ? "media-next" : "media-toggle").catch(failed);
            return { ok: true, message: hold ? "Next track." : "Play or pause." };
        case "system":
            if (hold) return { ok: true, message: "Tap to open Task Manager." };
            spawn("taskmgr.exe", [], { detached: true, stdio: "ignore" })
                .on("error", failed)
                .unref();
            return { ok: true, message: "Opening Task Manager." };
        case "crypto":
            feeds.now(address);
            return { ok: true, message: "Checking the price." };
        case "dice":
            return { ok: true, message: rollDice(pageId, cell, widget) };
    }
    const result = pressWidget(widget, widgetStore.get(address), hold, Date.now());
    if (!result.message) return { ok: true, message: "This widget has nothing to press." };
    widgetStore.set(address, result.state);
    return { ok: true, message: result.message };
}
/** The widget at a key of the profile as it is now, if it still is one. */
function currentWidget(pageId: string, cell: number): Widget | undefined {
    const page = config.pages.find((item) => item.id === pageId);
    const action = page?.keys[String(cell)]?.action;
    return page && isWidgetKey(page, cell) && action?.kind === "widget" ? action.widget : undefined;
}
/**
 * A widget taps when it is let go, and holds the moment a press has lasted
 * HOLD_MS: a stopwatch shows its reset while the finger is still down. A
 * finger that swiped does neither.
 */
function widgetPress(page: DeckPage, cell: number, down: boolean): void {
    const address = keyAddress(page.id, cell);
    const press = widgetPresses.get(address);
    if (press?.hold) clearTimeout(press.hold);
    widgetPresses.delete(address);
    if (down) {
        const next: WidgetPress = { hold: null, applied: 0, swiped: false };
        next.hold = setTimeout(() => {
            next.hold = null;
            const widget = currentWidget(page.id, cell);
            if (widget) useWidget(page.id, cell, widget, true);
        }, HOLD_MS);
        widgetPresses.set(address, next);
        return;
    }
    if (!press) return;
    // The time a swipe picked was only in memory while the finger moved.
    if (press.swiped) {
        if (press.applied) widgetStore.save();
        return;
    }
    const widget = currentWidget(page.id, cell);
    if (press.hold && widget) useWidget(page.id, cell, widget, false);
}
/**
 * A finger moving on a key the deck reports movement for. Past SWIPE_PX it is
 * a swipe; every WHEEL_STEP_PX from where it began turns an adjustable
 * countdown's wheel one step, up for more time, as a picker wheel rolls.
 */
function widgetMove(cell: number, y: number): void {
    const address = keyAddress(config.activePageId, cell);
    const press = widgetPresses.get(address);
    if (!press) return;
    if (press.startY === undefined) {
        press.startY = y;
        return;
    }
    const moved = press.startY - y;
    if (!press.swiped && Math.abs(moved) >= SWIPE_PX) {
        press.swiped = true;
        if (press.hold) clearTimeout(press.hold);
        press.hold = null;
    }
    // A wheel the deck turns itself needs nothing more from the finger here.
    if (wheels.get(cell)?.pageId === config.activePageId) return;
    const steps = Math.trunc(moved / WHEEL_STEP_PX);
    if (!press.swiped || steps === press.applied) return;
    const widget = currentWidget(config.activePageId, cell);
    // Firmware without dials: the volume moves 2% a step.
    if (widget?.type === "volume") {
        const level = (widgetStore.get(address)?.level ?? 0) + (steps - press.applied) * 2;
        press.applied = steps;
        void feeds.setVolume(level);
        return;
    }
    const next = widget ? dialTimer(widget, widgetStore.get(address), steps - press.applied) : null;
    press.applied = steps;
    if (next) widgetStore.set(address, next, false);
}
/** Wheels belong to the page the deck showed them on; another page drops them. */
function forgetHiddenWheels(): void {
    for (const [cell, armed] of wheels)
        if (armed.pageId !== displayed?.pageId || armed.signature !== displayed.signature)
            wheels.delete(cell);
}
/**
 * Hand an adjustable countdown at rest to the deck, which draws and turns its
 * wheel. A look the deck already keeps (by CRC) is armed with one line; only
 * a new one travels whole.
 */
async function sendWheel(
    pageId: unknown,
    cell: unknown,
    spec: unknown,
    values: unknown,
    index: unknown,
): Promise<Reply> {
    if (
        typeof pageId !== "string" ||
        !Number.isInteger(cell) ||
        Number(cell) < 0 ||
        Number(cell) > 14
    )
        throw new Error("Invalid key.");
    if (!status.connected || !status.identity.wheel)
        return { ok: false, message: "This firmware turns no wheels." };
    const { keyWidth: width, keyHeight: height } = status.identity;
    const look = spec instanceof Uint8Array ? decodeWheelSpec(spec, width, height) : null;
    // A drum's labels each stand for a value (a time, a coin's side); a
    // dial's index is its value, and a die's how it lies.
    const count = look?.kind === "drum" ? look.labels.length : 0;
    const [low, high] = look?.kind === "dial" ? [look.min, look.max] : [0, count - 1];
    const placed =
        look?.kind === "die"
            ? unpackPose(Number(index)) !== null
            : Number(index) >= low && Number(index) <= high;
    if (
        !look ||
        !(spec instanceof Uint8Array) ||
        !Array.isArray(values) ||
        values.length !== count ||
        values.some((v) => !Number.isInteger(v) || v < 0 || v > 86_399) ||
        !Number.isInteger(index) ||
        !placed
    )
        throw new Error("Invalid wheel.");
    if (look.kind !== "drum" && !status.identity.dial)
        return { ok: false, message: "This firmware turns no dials." };
    const at = Number(cell);
    const pageIndex = config.pages.findIndex((page) => page.id === pageId);
    const record = uploaded.get(pageId);
    if (!deviceReady || config.activePageId !== pageId || pageIndex < 0 || !record)
        return { ok: true, message: "The page is not on the deck." };
    const widget = currentWidget(pageId, at);
    const turned =
        widget && deckTurned(widget, widgetStore.get(keyAddress(pageId, at)), Date.now());
    if (widget?.type === "timer" && hasWheel(widget) && !turned)
        return { ok: true, message: "The countdown is running." };
    if (turned !== look.kind) return { ok: true, message: "That key has no wheel." };
    const crc = crc32(spec);
    const armed = wheels.get(at);
    if (
        armed?.pageId === pageId &&
        armed.signature === record.signature &&
        armed.crc === crc &&
        armed.index === index
    )
        return { ok: true, message: "Unchanged." };
    let reply = await link.command(
        `WHEELAT ${pageIndex} ${record.signature} ${at} ${index} ${crc}`,
        2000,
    );
    if (!reply.ok && reply.message.includes("wheel unknown"))
        reply = await link.push(
            at,
            spec,
            () => {},
            `WHEEL ${pageIndex} ${record.signature} ${at} ${index} ${spec.length} ${crc}`,
        );
    if (reply.ok)
        wheels.set(at, {
            kind: look.kind,
            pageId,
            signature: record.signature,
            crc,
            index: Number(index),
            values: values as number[],
        });
    else wheels.delete(at);
    return reply;
}
/**
 * The deck's drum came to rest on a label: a countdown's time now, or the
 * side a roll landed on. Or its die stopped: the face up, and where it lies.
 */
function wheelSettled(cell: number, index: number): void {
    const armed = wheels.get(cell);
    if (!armed || armed.pageId !== config.activePageId) return;
    const widget = currentWidget(armed.pageId, cell);
    const address = keyAddress(armed.pageId, cell);
    if (armed.kind === "die") {
        const pose = unpackPose(index);
        if (!pose || widget?.type !== "dice") return;
        armed.index = index;
        widgetStore.set(address, { value: pose.face, rest: index });
        return;
    }
    const value = armed.values[index];
    if (value === undefined) return;
    armed.index = index;
    armed.rolling = undefined;
    if (widget?.type === "timer" && hasWheel(widget))
        widgetStore.set(address, { picked: { seconds: value, over: widget.seconds } });
    else if (widget?.type === "dice") widgetStore.set(address, { value });
}
/** A finger turns the volume dial on the deck: Windows follows at once. */
function dialTurned(cell: number, value: number): void {
    const armed = wheels.get(cell);
    if (!armed || armed.pageId !== config.activePageId) return;
    if (currentWidget(armed.pageId, cell)?.type !== "volume") return;
    armed.index = value;
    void feeds.setVolume(value);
}
/**
 * Roll dice: a face picked at random, which a drum on the deck spins to -
 * two turns of faces at least - and lands on. Without one, the app shows it.
 * A tap while it spins rolls on from where it was going, never back.
 */
function rollDice(pageId: string, cell: number, widget: Extract<Widget, { type: "dice" }>): string {
    const faces = diceFaces(widget);
    const pick = Math.floor(Math.random() * faces.length);
    const armed = wheels.get(cell);
    const pageIndex = config.pages.findIndex((page) => page.id === pageId);
    // A die on the deck is thrown there, and lands however it lands.
    if (armed?.kind === "die" && armed.pageId === pageId && deviceReady && pageIndex >= 0) {
        const { signature } = armed;
        void serial(() =>
            link.command(`WHEELROLL ${pageIndex} ${signature} ${cell} 0`, 2000),
        ).catch(() => {});
        return "Rolling.";
    }
    if (armed?.pageId === pageId && deviceReady && pageIndex >= 0) {
        let target = (armed.rolling ?? armed.index) + Math.max(10, faces.length * 2);
        while (target < armed.values.length - 1 && armed.values[target] !== pick) target++;
        if (armed.values[target] === pick) {
            armed.rolling = target;
            const { signature } = armed;
            void serial(() =>
                link.command(`WHEELROLL ${pageIndex} ${signature} ${cell} ${target}`, 2000),
            ).catch(() => {});
            return `Rolling for ${faces[pick]}.`;
        }
    }
    widgetStore.set(keyAddress(pageId, cell), { value: pick });
    return `Rolled ${faces[pick]}.`;
}
/** Tell the deck which keys of the page shown have wheels, if that changed. */
async function syncDrag(page: DeckPage): Promise<void> {
    if (!status.connected || !status.identity.drag) return;
    let mask = 0;
    for (let cell = 0; cell < 15; cell++) {
        const action = page.keys[String(cell)]?.action;
        // Keys a finger turns: a swipe on them is neither a tap nor a hold. A
        // die is not turned but thrown, by any touch.
        const turns =
            action?.kind === "widget" &&
            (hasWheel(action.widget) ||
                action.widget.type === "volume" ||
                (action.widget.type === "dice" && action.widget.mode !== "die"));
        if (isWidgetKey(page, cell) && turns) mask |= 1 << cell;
    }
    if (mask === dragMask) return;
    const reply = await link.command(`DRAG ${mask}`, 2000);
    dragMask = reply.ok ? mask : null;
}
/**
 * Bring a widget key on the deck up to date with a patch: what changed since
 * the picture the deck holds. The deck checks that picture's CRC first, so a
 * copy that drifted (reloaded from the SD card, rebuilt, a patch lost) is
 * refused, and the whole key goes instead.
 */
async function sendLive(
    pageId: unknown,
    cell: unknown,
    frame: unknown,
    slide?: unknown,
): Promise<Reply> {
    if (
        typeof pageId !== "string" ||
        !Number.isInteger(cell) ||
        Number(cell) < 0 ||
        Number(cell) > 14
    )
        throw new Error("Invalid key.");
    if (!status.connected || !status.identity.live)
        return { ok: false, message: "This firmware shows widgets without updating them." };
    const { keyWidth: width, keyHeight: height } = status.identity;
    if (!(frame instanceof Uint8Array) || frame.length !== width * height * 2)
        throw new Error("Invalid widget image.");
    if (!validSlide(slide)) throw new Error("Invalid sliding text.");
    const index = config.pages.findIndex((page) => page.id === pageId);
    const record = uploaded.get(pageId);
    // Pages not shown are kept up to date too where the deck takes it (warm=1),
    // so one opens as it is now.
    const reachable = config.activePageId === pageId || status.identity.warm === true;
    if (!deviceReady || !reachable || index < 0 || !record)
        return { ok: true, message: "The page is not on the deck." };
    // A tick drawn just before the widget moved or went must not land where it was.
    if (!isWidgetKey(config.pages[index]!, Number(cell)))
        return { ok: true, message: "That key is not a widget." };
    const reply = await patchKey(pageId, index, record, Number(cell), frame);
    // The picture first, then its text: new text on an old picture would
    // show both, for a moment, where the old picture had its own.
    if (!reply.ok || slide === undefined) return reply;
    return syncSlide(pageId, index, record.signature, Number(cell), slide);
}
/** Text the deck can slide on a key: a SLIDE payload it would take, or null for none. */
function validSlide(slide: unknown): slide is Uint8Array | null | undefined {
    if (slide === undefined || slide === null) return true;
    if (!(slide instanceof Uint8Array) || !status.connected) return false;
    return decodeSlide(slide, status.identity.keyWidth, status.identity.keyHeight) !== null;
}
/**
 * Give a key in the deck's copy of a page (`signature`) the text it slides
 * along, or take it away (null): only what differs from what that copy has.
 */
async function syncSlide(
    pageId: string,
    index: number,
    signature: number,
    cell: number,
    slide: Uint8Array | null,
): Promise<Reply> {
    if (!status.connected || !status.identity.slide)
        return { ok: true, message: "This firmware slides no text." };
    const slides = slidesIn(pageId, signature);
    const crc = slide ? crc32(slide) : undefined;
    if (slides.get(cell) === crc) return { ok: true, message: "Unchanged." };
    const reply = slide
        ? await link.push(
              cell,
              slide,
              () => {},
              `SLIDE ${index} ${signature} ${cell} ${slide.length} ${crc}`,
          )
        : await link.command(`SLIDE ${index} ${signature} ${cell} 0 0`, 2000);
    if (reply.ok && crc !== undefined) slides.set(cell, crc);
    else if (reply.ok) slides.delete(cell);
    return reply;
}
/**
 * Patch a key in the deck's copy of a page (any it holds, shown or not): what
 * changed since the picture it holds there.
 */
async function patchKey(
    pageId: string,
    index: number,
    record: { signature: number; frames: Buffer[] },
    cell: number,
    frame: Uint8Array,
): Promise<Reply> {
    if (!status.connected) return { ok: false, message: "Decky is disconnected." };
    const { keyWidth: width, keyHeight: height } = status.identity;
    const patches = patchesIn(pageId, record.signature);
    const next = Buffer.from(frame);
    const base = patches.get(cell) ?? record.frames[cell]!;
    if (base.equals(next)) return { ok: true, message: "Unchanged." };
    const send = (payload: Uint8Array, baseCrc: number): Promise<Reply> =>
        link.push(
            cell,
            payload,
            () => {},
            `LIVE ${index} ${record.signature} ${cell} ${baseCrc} ${payload.length} ${crc32(payload)}`,
        );
    let reply = await send(encodeLivePatch(base, next, width, height), crc32(base));
    if (!reply.ok && reply.message.includes("live base"))
        reply = await send(encodeLivePatch(null, next, width, height), 0);
    if (reply.ok) patches.set(cell, next);
    // The deck's wheel on a key of the page shown ends with a picture for it.
    if (reply.ok && wheels.get(cell)?.pageId === pageId) wheels.delete(cell);
    return reply;
}
/**
 * While the deck loads: every page's widget pictures as they are now, and the
 * looks of the keys it turns, sent ahead - what `warmup` holds that is valid.
 */
function warmupItems(warmup: unknown): Warmup {
    const none: Warmup = { widgets: [], looks: [] };
    if (!status.connected || !status.identity.warm || typeof warmup !== "object" || !warmup)
        return none;
    const { widgets, looks } = warmup as Record<string, unknown>;
    const bytes = status.identity.keyWidth * status.identity.keyHeight * 2;
    const pageOf = (id: unknown) => config.pages.find((page) => page.id === id);
    return {
        widgets: (Array.isArray(widgets) ? widgets.slice(0, 64 * 15) : []).filter(
            (item): item is Warmup["widgets"][number] => {
                const page = pageOf(item?.pageId);
                return (
                    !!page &&
                    Number.isInteger(item.cell) &&
                    item.cell >= 0 &&
                    item.cell <= 14 &&
                    isWidgetKey(page, item.cell) &&
                    item.frame instanceof Uint8Array &&
                    item.frame.length === bytes &&
                    validSlide(item.slide)
                );
            },
        ),
        looks: (Array.isArray(looks) ? looks.slice(0, 32) : []).filter(
            (item): item is Warmup["looks"][number] =>
                !!pageOf(item?.pageId) &&
                item.spec instanceof Uint8Array &&
                item.spec.length > 0 &&
                item.spec.length <= 48 * 1024 &&
                decodeWheelSpec(
                    item.spec,
                    status.connected ? status.identity.keyWidth : 0,
                    status.connected ? status.identity.keyHeight : 0,
                ) !== null,
        ),
    };
}
function registerHandlers(): void {
    const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
        ipcMain.handle(channel, (event, ...args: unknown[]) => {
            if (
                event.sender !== window?.webContents ||
                event.senderFrame !== window.webContents.mainFrame
            )
                throw new Error("Untrusted sender.");
            return fn(...args);
        });
    };
    handle("wifi:status", () =>
        serial(async (): Promise<WifiStatus> => {
            if (!status.connected || status.identity.protocol < 5)
                return {
                    available: false,
                    transport: status.connected ? "usb" : null,
                    state: "unconfigured",
                    ssid: "",
                    ip: "",
                    paired: false,
                };
            const reply = await link.command("WIFI_STATUS", 2000);
            if (!reply.ok) throw new Error(reply.message);
            const result = parseWifiStatus(
                reply.message,
                status.identity.portPath.startsWith("tcp:") ? "wifi" : "usb",
                wifiPair?.serial === status.identity.serial,
            );
            if (status.identity.protocol >= 6)
                result.cacheStorage = status.identity.persistentCache ? "sd" : "none";
            result.encrypted = status.identity.protocol >= 7;
            if (
                result.state === "connected" &&
                result.ip &&
                wifiPair?.serial === status.identity.serial &&
                wifiPair.ip !== result.ip
            ) {
                wifiPair.ip = result.ip;
                await saveWifiPair(wifiPath, wifiPair);
            }
            return result;
        }),
    );
    handle("wifi:scan", async () => {
        if (wifiScanning) throw new Error("A Wi-Fi scan is already running.");
        wifiScanning = true;
        try {
            await serial(async () => {
                requireWifi(true);
                const reply = await link.command("WIFI_SCAN", 2000);
                if (!reply.ok) throw new Error(reply.message);
            });
            for (let attempt = 0; attempt < 40; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                const reply = await serial(async () => {
                    requireWifi(true);
                    return link.command("WIFI_LIST", 2000);
                });
                if (!reply.ok) throw new Error(reply.message);
                if (!reply.message.includes("scanning")) return parseWifiNetworks(reply.message);
            }
            throw new Error("Wi-Fi scan timed out. Try again.");
        } finally {
            wifiScanning = false;
        }
    });
    handle("wifi:join", (ssid, password) =>
        serial(async () => {
            requireWifi(true);
            const command = wifiJoinCommand(ssid, password);
            const pairReply = await link.command("WIFI_PAIR", 2000);
            const secret = pairReply.message.match(/^OK pair ([a-f0-9]{64})$/)?.[1];
            if (!pairReply.ok || !secret) throw new Error("Could not pair with Decky.");
            if (!status.connected) throw new Error("Decky disconnected.");
            wifiPair = { serial: status.identity.serial, ip: "", secret, preferWifi: false };
            await saveWifiPair(wifiPath, wifiPair);
            const reply = await link.command(command, 3000);
            return {
                ok: reply.ok,
                message: reply.ok ? "Connecting to Wi-Fi…" : "Could not start Wi-Fi connection.",
            };
        }),
    );
    handle("wifi:forget", () =>
        serial(async (): Promise<Reply> => {
            requireWifi(true);
            const reply = await link.command("WIFI_FORGET", 2000);
            if (!reply.ok)
                return { ok: false, message: "Decky could not forget the network. Try again." };
            // This deck's pairing on the PC goes too: with no network there is nothing
            // to reach over Wi-Fi, and joining a network fetches a pairing again.
            if (status.connected && wifiPair?.serial === status.identity.serial) {
                wifiPair = null;
                await rm(wifiPath, { force: true });
            }
            return { ok: true, message: "Decky forgot the Wi-Fi network." };
        }),
    );
    handle("firmware:info", () => firmwareInfo());
    handle("firmware:check", async () => {
        await checkForUpdates();
        return firmwareInfo();
    });
    // The deck shows the update too (UPDATING): the download's percent, and
    // while Decky closes for the installer it keeps saying so instead of
    // Disconnected, until the new version connects. Firmware without the command
    // answers ERR, which changes nothing.
    let deckPercent = -1;
    const tellDeck = (line: string): void => {
        if (!status.connected) return;
        void serial(() => link.command(line, 1500)).catch(() => {});
    };
    handle("app-update:install", () => {
        deckPercent = -1;
        return installAppUpdate(
            (progress: AppUpdateProgress) => {
                if (window && !window.isDestroyed())
                    window.webContents.send("app-update:progress", progress);
                if (progress.stage === "checking") {
                    deckPercent = -1;
                    tellDeck("UPDATING 0");
                } else if (progress.stage === "downloading") {
                    const percent = Math.floor(progress.percent);
                    if (percent !== deckPercent) {
                        deckPercent = percent;
                        tellDeck(`UPDATING ${percent}`);
                    }
                } else if (progress.stage === "installing") tellDeck("UPDATING 100");
                else tellDeck("UPDATING END");
            },
            // Quitting for the installer is a real quit, not a hide to the tray.
            () => {
                quitting = true;
                restartingForUpdate = true;
            },
        );
    });
    handle("app-update:cancel", () => cancelAppUpdate());
    handle("app-update:download", async (): Promise<Reply> => {
        // Only a URL this process read from GitHub itself is ever opened.
        const target = latestApp?.installer ?? latestApp?.page;
        if (!target?.startsWith("https://github.com/"))
            return {
                ok: false,
                message: "No Decky release is known yet. Check GitHub for updates.",
            };
        await shell.openExternal(target);
        return { ok: true, message: "The download opened in your browser." };
    });
    handle("firmware:probe", (path) =>
        serial(async () => {
            const waiting = !status.connected ? (status.unknownDevices ?? []) : [];
            if (typeof path !== "string" || !waiting.some((device) => device.path === path))
                throw new Error("That device is not waiting to be checked.");
            await link.close();
            const probe = await probeDevice(path);
            if (probe.crowPanel) confirmedCrowPanels.add(path);
            else confirmedCrowPanels.delete(path);
            return { crowPanel: probe.crowPanel, chip: probe.chip, mac: probe.mac };
        }),
    );
    handle("firmware:install", (request) => serial(() => installFirmware(request)));
    handle("window:state", () => ({ maximized: window?.isMaximized() ?? false }));
    handle("window:control", (action) => {
        if (action !== "minimize" && action !== "maximize" && action !== "close")
            throw new Error("Invalid window action.");
        if (action === "minimize") window?.minimize();
        else if (action === "maximize") {
            if (window?.isMaximized()) window.unmaximize();
            else window?.maximize();
        } else window?.close();
        return { maximized: window?.isMaximized() ?? false };
    });
    const location = (value: unknown): KeyLocation => {
        if (
            typeof value !== "object" ||
            value === null ||
            typeof (value as KeyLocation).pageId !== "string" ||
            !Number.isInteger((value as KeyLocation).cell)
        )
            throw new Error("Invalid key position.");
        return value as KeyLocation;
    };
    handle("keys:move", async (source, target) => {
        const from = location(source),
            to = location(target);
        const result = moveKey(config, from, to);
        return persist(result.config, (states) => {
            keyStates.move(states, from, to, result.swapped);
            widgetStore.move(from, to, result.swapped);
        });
    });
    handle("keys:duplicate", async (source) => {
        const result = duplicateKey(config, location(source));
        return { config: await persist(result.config), cell: result.cell };
    });
    handle("keys:states", () => keyStates.snapshot());
    handle("widgets:states", () => widgetStore.snapshot());
    handle("deck:live", (pageId, cell, frame, slide) => {
        const address = `${String(pageId)}:${String(cell)}`;
        const waiting = liveQueue.has(address);
        liveQueue.set(address, [frame, slide]);
        // The send already waiting for this key takes the newest picture.
        if (waiting) return { ok: true, message: "Queued." };
        return serial(() => {
            const [newest, text] = liveQueue.get(address)!;
            liveQueue.delete(address);
            return sendLive(pageId, cell, newest, text);
        });
    });
    handle("deck:wheel", (pageId, cell, spec, values, index) => {
        const address = `${String(pageId)}:${String(cell)}`;
        const waiting = wheelQueue.has(address);
        wheelQueue.set(address, [spec, values, index]);
        if (waiting) return { ok: true, message: "Queued." };
        return serial(() => {
            const [newest, times, at] = wheelQueue.get(address)!;
            wheelQueue.delete(address);
            return sendWheel(pageId, cell, newest, times, at);
        });
    });
    handle("config:get", () => config);
    handle("config:save", (value) => {
        validateConfig(value);
        return persist(value);
    });
    handle("page:navigate", navigate);
    handle("action:run", runKey);
    handle("action:cancel", () => runner.cancel());
    handle("deck:status", () =>
        serial(async () => {
            if (status.connected) {
                lastTransport = transportOf(status.identity);
                if ((await link.stillAttached()) && !(await cableIsBack())) return status;
            }
            const before = lastTransport;
            await reconnect();
            const after = status.connected ? transportOf(status.identity) : null;
            if (fellBackToWifi(before, after))
                window?.webContents.send("deck:event", { kind: "fallback", at: Date.now() });
            lastTransport = after;
            return status;
        }),
    );
    // While on Wi-Fi: has this deck's USB cable been plugged back in? Checked
    // through a second link, so Wi-Fi is only dropped once USB has answered
    // with the same serial - an unrelated USB device never interrupts it.
    const cableIsBack = async (): Promise<boolean> => {
        if (!status.connected || transportOf(status.identity) !== "wifi") return false;
        const serialNumber = status.identity.serial;
        const now = Date.now();
        for (const port of await DeckLink.listPorts()) {
            if (now - (notThisDeck.get(port.path) ?? 0) < NOT_THIS_DECK_MS) continue;
            const identity = await usbProbe.identify(port.path);
            await usbProbe.close();
            if (identity?.serial === serialNumber) return true;
            notThisDeck.set(port.path, now);
        }
        return false;
    };
    // Find the deck again: USB first, Wi-Fi only when no cable answers.
    const reconnect = async (): Promise<void> => {
        status = { connected: false };
        cacheInitialized = false;
        uploaded.clear();
        livePatched.clear();
        liveSlides.clear();
        dragMask = null;
        wheels.clear();
        deviceReady = false;
        displayed = null;
        await link.close();
        const ports = await DeckLink.listPorts();
        for (const known of [...silentPorts.keys()])
            if (!ports.some((port) => port.path === known)) silentPorts.delete(known);
        // A port whose USB bridge stopped answering: not a silent device to set up.
        let stuckPort: string | undefined;
        for (const port of ports) {
            let identity = await link.identify(port.path);
            let silences = identity ? 0 : (silentPorts.get(port.path) ?? 0) + 1;
            // A new port's silence is asked about again within this check, not a
            // whole status check later, so a board without Decky is offered sooner.
            while (!identity && silences < SILENT_CHECKS) {
                await new Promise((resolve) => setTimeout(resolve, SILENT_RECHECK_MS));
                identity = await link.identify(port.path);
                silences = identity ? 0 : silences + 1;
            }
            if (identity) {
                status = { connected: true, identity };
                noteRestart(identity.resetReason);
                silentPorts.clear();
                notThisDeck.clear();
                return;
            }
            if (link.stuck) {
                stuckPort = port.path;
                silentPorts.delete(port.path);
            } else silentPorts.set(port.path, silences);
        }
        await link.close();
        if (await connectWireless()) return;
        await link.close();
        const unknownDevices = ports
            .filter((port) => (silentPorts.get(port.path) ?? 0) >= SILENT_CHECKS)
            .map((port) => ({ path: port.path, label: port.label }));
        status = {
            connected: false,
            ...(unknownDevices.length ? { unknownDevices } : {}),
            ...(stuckPort ? { stuckPort } : {}),
        };
    };
    handle("programs:list", listPrograms);
    handle("programs:icon", getProgramIcon);
    handle("target:pick", async (kind) => {
        if (kind !== "program" && kind !== "script") throw new Error("Invalid target type.");
        const result = await dialog.showOpenDialog(window!, {
            title: kind === "program" ? "Choose a program" : "Choose a PowerShell script",
            properties: ["openFile"],
            filters: [
                {
                    name: kind === "program" ? "Programs" : "PowerShell scripts",
                    extensions: kind === "program" ? ["exe", "lnk"] : ["ps1"],
                },
            ],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    handle("config:export", async () => {
        const result = await dialog.showSaveDialog(window!, {
            defaultPath: "Decky-profile.json",
            filters: [{ name: "Decky profile", extensions: ["json"] }],
        });
        if (!result.filePath) return { ok: false, message: "Export cancelled." };
        await writeFile(result.filePath, JSON.stringify(config, null, 2), "utf8");
        return { ok: true, message: "Profile exported." };
    });
    handle("config:import", async () => {
        const result = await dialog.showOpenDialog(window!, {
            properties: ["openFile"],
            filters: [{ name: "Decky profile", extensions: ["json"] }],
        });
        const path = result.filePaths[0];
        if (!path) return null;
        if ((await stat(path)).size > 24 * 1024 * 1024) throw new Error("Profile exceeds 24 MB.");
        const next: unknown = JSON.parse(await readFile(path, "utf8"));
        retireWidgets(next);
        validateConfig(next);
        const answer = await dialog.showMessageBox(window!, {
            type: "question",
            message: `Replace your pages with ${next.pages.length} imported pages?`,
            detail: "Imported keys can launch programs and scripts when pressed. Your current profile will be backed up automatically.",
            buttons: ["Cancel", "Import profile"],
            defaultId: 0,
            cancelId: 0,
        });
        if (answer.response !== 1) return null;
        await writeFile(
            `${configPath}.before-import-${Date.now()}.json`,
            JSON.stringify(config),
            "utf8",
        );
        return persist(next);
    });
    handle("page:sync", (pageId, frames, toggleFrames) =>
        serial(async (): Promise<Reply> => {
            if (typeof pageId !== "string" || pageId !== config.activePageId)
                return { ok: false, message: "Page changed before sync." };
            if (!status.connected) return { ok: false, message: "Connect Decky to sync keys." };
            if (status.identity.protocol < 2)
                return { ok: false, message: "Install Decky firmware to sync images." };
            validateFrames(frames);
            deviceReady = false;
            return transferPage(pageId, frames, false, toggleFrames as PageUpload["toggleFrames"]);
        }),
    );
    handle("pages:cache", (pages, warmup) =>
        serial(async (): Promise<Reply> => {
            if (!status.connected || status.identity.protocol < 3)
                return { ok: false, message: "Page preloading requires Decky firmware v3." };
            if (!Array.isArray(pages) || pages.length !== config.pages.length || pages.length > 64)
                throw new Error("Invalid page cache request.");
            const ids = new Set<string>();
            for (const page of pages) {
                if (
                    typeof page !== "object" ||
                    page === null ||
                    typeof page.pageId !== "string" ||
                    ids.has(page.pageId) ||
                    !config.pages.some((item) => item.id === page.pageId)
                )
                    throw new Error("Invalid cached page.");
                validateFrames(page.frames);
                ids.add(page.pageId);
            }
            const capacity = status.identity.cacheSlots ?? 8;
            if (pages.length > capacity)
                return {
                    ok: false,
                    message: `Decky can hold ${capacity} page snapshots in memory; this profile has ${pages.length}. The current page will still work.`,
                };
            const warm = warmupItems(warmup);
            deviceReady = false;
            if (!cacheInitialized) {
                // The deck's progress counts every key, ON picture, widget
                // picture and look to come.
                const units =
                    status.identity.protocol >= 4
                        ? ` ${(pages as PageUpload[]).reduce((sum, page) => sum + 15 + (page.toggleFrames?.length ?? 0), 0) + warm.widgets.length + warm.looks.length}`
                        : "";
                const reply = await link.command(`HELLO ${pages.length}${units}`, 2000);
                if (!reply.ok) return reply;
                // A new session on the deck: it forgets which keys have wheels,
                // and any text it slid.
                dragMask = null;
                wheels.clear();
                liveSlides.clear();
                // Uploads over USB in 2 KB blocks where the deck takes them.
                if ((status.identity.block ?? 0) >= 2048) await link.useBlock(2048);
            }
            for (const page of pages as PageUpload[]) {
                const reply = await transferPage(page.pageId, page.frames, true, page.toggleFrames);
                if (!reply.ok) return reply;
            }
            // Every page's widgets as they are now, and the looks of the keys
            // the deck turns, while it still shows its progress: no page
            // opens on placeholders, or waits for a look.
            for (const item of warm.widgets) {
                const index = config.pages.findIndex((page) => page.id === item.pageId);
                const record = uploaded.get(item.pageId);
                if (index < 0 || !record) continue;
                const patched = await patchKey(item.pageId, index, record, item.cell, item.frame);
                if (patched.ok && item.slide !== undefined)
                    await syncSlide(item.pageId, index, record.signature, item.cell, item.slide);
            }
            for (const look of warm.looks) {
                const index = config.pages.findIndex((page) => page.id === look.pageId);
                const record = uploaded.get(look.pageId);
                if (index >= 0 && record)
                    await link.push(
                        -1,
                        look.spec,
                        () => {},
                        `WHEEL ${index} ${record.signature} -1 0 ${look.spec.length} ${crc32(look.spec)}`,
                    );
            }
            const active = (pages as PageUpload[]).find(
                (page) => page.pageId === config.activePageId,
            );
            if (!active) return { ok: false, message: "Workspace changed during page preload." };
            const reply = await transferPage(
                active.pageId,
                active.frames,
                false,
                active.toggleFrames,
            );
            if (reply.ok) cacheInitialized = true;
            return reply.ok ? { ok: true, message: `Cached ${pages.length} pages.` } : reply;
        }),
    );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on("second-instance", () => {
        window?.restore();
        window?.focus();
    });
    void app.whenReady().then(async () => {
        configPath = join(app.getPath("userData"), "decky.json");
        wifiPath = join(app.getPath("userData"), "wifi-pair.json");
        wifiPair = await loadWifiPair(wifiPath);
        widgetStore = new WidgetStore(join(app.getPath("userData"), "widgets.json"), (states) => {
            if (window && !window.isDestroyed()) window.webContents.send("widgets:states", states);
        });
        await widgetStore.load();
        pings = new PingWatcher(widgetStore);
        feeds = new WidgetFeeds(widgetStore, new WindowsHost(app.getPath("userData")));
        try {
            config = await loadConfig(
                configPath,
                join(app.getPath("appData"), "deck-studio", "bindings.json"),
            );
        } catch (error) {
            dialog.showErrorBox("Decky configuration", String(error));
            app.quit();
            return;
        }
        widgetStore.reconcile(config);
        pings.sync(config);
        feeds.sync(config);
        Menu.setApplicationMenu(null);
        window = new BrowserWindow({
            title: "Decky",
            frame: false,
            width: 1440,
            height: 960,
            minWidth: 1080,
            minHeight: 760,
            backgroundColor: "#101010",
            icon: appIcon,
            show: false,
            webPreferences: {
                preload: join(__dirname, "../preload/index.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                // Widgets tick from the window's timers, and Decky mostly sits in
                // the tray: hidden, Chromium would slow them to once a minute.
                backgroundThrottling: false,
                // A countdown's sound plays whenever it ends, often with the
                // window hidden and never touched since Decky started.
                autoplayPolicy: "no-user-gesture-required",
            },
        });
        const publishWindowState = (): void => {
            if (window && !window.isDestroyed())
                window.webContents.send("window:state", { maximized: window.isMaximized() });
        };
        window.on("maximize", publishWindowState);
        window.on("unmaximize", publishWindowState);
        tray = new Tray(nativeImage.createFromPath(appIcon));
        tray.setToolTip("Decky");
        const showWindow = (): void => {
            window?.show();
            window?.restore();
            window?.focus();
        };
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: "Open Decky", click: showWindow },
                { type: "separator" },
                {
                    label: "Quit Decky",
                    click: () => {
                        quitting = true;
                        app.quit();
                    },
                },
            ]),
        );
        tray.on("double-click", showWindow);
        window.on("close", (event) => {
            if (!quitting) {
                event.preventDefault();
                window?.hide();
            }
        });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) => event.preventDefault());
        window.webContents.session.setPermissionRequestHandler(
            (_webContents, _permission, callback) => callback(false),
        );
        registerHandlers();
        // Look for newer releases shortly after starting, then every 15 minutes -
        // also while Decky sits in the tray. Offline just means trying again later.
        const backgroundCheck = (): void => void checkForUpdates().catch(() => {});
        setTimeout(backgroundCheck, 5_000).unref();
        setInterval(backgroundCheck, UPDATE_CHECK_MS).unref();
        heartbeat = setInterval(() => {
            if (quitting || heartbeatPending || !status.connected || status.identity.protocol < 3)
                return;
            heartbeatPending = true;
            void serial(async () => {
                const reply = await link.command("PING", 1500);
                if (!reply.ok) throw new Error(reply.message);
                if (reply.message.includes("online=0") && cacheInitialized) resetDeviceCache();
            })
                .catch(() => {
                    status = { connected: false };
                    resetDeviceCache();
                })
                .finally(() => {
                    heartbeatPending = false;
                });
        }, 4000);
        heartbeat.unref();
        // A USB-serial device that was just plugged in is worth a status check at
        // once rather than at the window's next poll: a deck connects sooner, and
        // a board without Decky is offered sooner. Listing ports opens none.
        let knownPorts: Set<string> | null = null;
        setInterval(() => {
            void DeckLink.listPorts()
                .then((ports) => {
                    const paths = new Set(ports.map((port) => port.path));
                    const added =
                        knownPorts !== null && [...paths].some((p) => !knownPorts!.has(p));
                    knownPorts = paths;
                    if (added && !quitting && window && !window.isDestroyed())
                        window.webContents.send("deck:event", { kind: "ports", at: Date.now() });
                })
                .catch(() => {});
        }, PORT_WATCH_MS).unref();
        link.onNoise = (line) => deckLog(line);
        link.onEvent = (event) => {
            if (quitting) return;
            if (event.kind === "reset") {
                deckLog("BOOT: the deck started again");
                resetDeviceCache();
                return;
            }
            // Finger movement turns wheels; the window has no use for it.
            if (event.kind === "wheel") {
                if (deviceReady) wheelSettled(event.cell, event.index);
                return;
            }
            if (event.kind === "value") {
                if (deviceReady) dialTurned(event.cell, event.value);
                return;
            }
            if (event.kind === "move") {
                if (deviceReady) widgetMove(event.cell, event.y);
                return;
            }
            window?.webContents.send("deck:event", event);
            if (
                event.kind === "key" &&
                (deviceReady || (status.connected && status.identity.protocol < 2))
            ) {
                const page =
                    status.connected && status.identity.protocol < 2
                        ? config.pages[event.page]
                        : config.pages.find((p) => p.id === config.activePageId);
                if (page && isWidgetKey(page, event.cell)) {
                    widgetPress(page, event.cell, event.down);
                    return;
                }
                if (page && event.down)
                    void runKey(page.id, event.cell).catch((error) =>
                        window?.webContents.send("action:activity", {
                            at: Date.now(),
                            label: "Device action",
                            ok: false,
                            message: String(error),
                        }),
                    );
            }
        };
        window.once("ready-to-show", () => window?.show());
        const url = process.env["ELECTRON_RENDERER_URL"];
        if (url) await window.loadURL(url);
        else await window.loadFile(join(__dirname, "../renderer/index.html"));
    });
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        quitting = true;
        if (heartbeat) clearInterval(heartbeat);
        tray?.destroy();
        runner.cancel();
        pings?.stop();
        feeds?.stop();
        const goodbye = async (): Promise<void> => {
            // No BYE when quitting for the installer: that would turn the deck's
            // "Updating Decky" into Disconnected while the new version installs.
            if (
                !restartingForUpdate &&
                !serialActive &&
                link.openPath &&
                status.connected &&
                status.identity.protocol >= 3
            )
                await link.command("BYE", 350).catch(() => {});
            await link.close();
        };
        void Promise.race([
            goodbye(),
            new Promise<void>((resolve) => setTimeout(resolve, 700)),
        ]).finally(() => app.quit());
    });
}
