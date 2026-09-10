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
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, DeckLink } from "./device/serial";
import { loadConfig, saveConfig } from "./config/store";
import { ActionRunner } from "./actions/runner";
import { toSendKeys } from "./actions/hotkeys";
import { BACK_CELL, createConfig, validateConfig } from "../shared/config";
import type { DeckConfig, KeyStates } from "../shared/config";
import type { DeckStatus, Reply, PageUpload } from "../shared/api";
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
const uploaded = new Map<string, { signature: number; frames: Buffer[] }>();
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
function resetDeviceCache(): void {
    storageWarningShown = false;
    cacheInitialized = false;
    deviceReady = false;
    displayed = null;
    uploaded.clear();
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
    let reply = await link.command(
        `${cacheOnly || independentToggles ? "CACHE" : "PAGE"} ${index} ${signature}`,
        5000,
    );
    if (!reply.ok) return reply;
    const previous = uploaded.get(pageId) ?? (displayed?.pageId === pageId ? displayed : null);
    if (!reply.message.includes("cached=1")) {
        const base = Number(reply.message.match(/base=(\d+)/)?.[1]);
        const incremental = reply.message.includes("copied=1") && previous?.signature === base;
        try {
            for (let cell = 0; cell < 15; cell++) {
                if (incremental && previous!.frames[cell]!.equals(Buffer.from(frames[cell]!)))
                    continue;
                reply = frames[cell]!.some((byte) => byte !== 0)
                    ? await link.push(cell, frames[cell]!, () => {})
                    : await link.command(`BLANK ${cell}`, 2000);
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
    const record = { signature, frames: frames.map((frame) => Buffer.from(frame)) };
    uploaded.set(pageId, record);
    if (!cacheOnly) {
        if (independentToggles) {
            reply = await activateState(pageId);
            if (!reply.ok) return reply;
        }
        displayed = { pageId, ...record };
        deviceReady = config.activePageId === pageId;
    }
    return { ok: true, message: cacheOnly ? "Page cached." : "Keys synced." };
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
        config = next;
        for (const id of uploaded.keys())
            if (!next.pages.some((page) => page.id === id)) uploaded.delete(id);
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
        return persist(result.config, (states) => keyStates.move(states, from, to, result.swapped));
    });
    handle("keys:duplicate", async (source) => {
        const result = duplicateKey(config, location(source));
        return { config: await persist(result.config), cell: result.cell };
    });
    handle("keys:states", () => keyStates.snapshot());
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
        deviceReady = false;
        displayed = null;
        await link.close();
        const ports = await DeckLink.listPorts();
        for (const known of [...silentPorts.keys()])
            if (!ports.some((port) => port.path === known)) silentPorts.delete(known);
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
                silentPorts.clear();
                notThisDeck.clear();
                return;
            }
            silentPorts.set(port.path, silences);
        }
        await link.close();
        if (await connectWireless()) return;
        await link.close();
        const unknownDevices = ports
            .filter((port) => (silentPorts.get(port.path) ?? 0) >= SILENT_CHECKS)
            .map((port) => ({ path: port.path, label: port.label }));
        status = { connected: false, ...(unknownDevices.length ? { unknownDevices } : {}) };
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
    handle("pages:cache", (pages) =>
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
            deviceReady = false;
            if (!cacheInitialized) {
                const units =
                    status.identity.protocol >= 4
                        ? ` ${(pages as PageUpload[]).reduce((sum, page) => sum + 15 + (page.toggleFrames?.length ?? 0), 0)}`
                        : "";
                const reply = await link.command(`HELLO ${pages.length}${units}`, 2000);
                if (!reply.ok) return reply;
            }
            for (const page of pages as PageUpload[]) {
                const reply = await transferPage(page.pageId, page.frames, true, page.toggleFrames);
                if (!reply.ok) return reply;
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
        link.onEvent = (event) => {
            if (quitting) return;
            if (event.kind === "reset") {
                resetDeviceCache();
                return;
            }
            window?.webContents.send("deck:event", event);
            if (
                event.kind === "key" &&
                event.down &&
                (deviceReady || (status.connected && status.identity.protocol < 2))
            ) {
                const page =
                    status.connected && status.identity.protocol < 2
                        ? config.pages[event.page]
                        : config.pages.find((p) => p.id === config.activePageId);
                if (page)
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
