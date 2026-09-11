import type { KeyLocation } from "./key-layout";
import type { InstalledProgram } from "./programs";
import type { DeckConfig, KeyStates } from "./config";
import type { WidgetStates } from "./widgets";
export interface DeckIdentity {
    portPath: string;
    protocol: number;
    serial: string;
    cells: number;
    columns: number;
    rows: number;
    keyWidth: number;
    keyHeight: number;
    pages: number;
    cacheSlots?: number;
    /** Firmware release or build, from protocol 7 on. */
    firmwareVersion?: string;
    persistentCache?: boolean;
    /**
     * The deck takes LIVE patches for widget keys (reported as live=1), into
     * live pictures kept apart from the page's own: a new version of a page
     * needs only its changed keys, sent as patches (PATCH), and LIVE with no
     * bytes drops a key's live picture.
     */
    live?: boolean;
    /** The deck reports finger movement on keys named with DRAG (drag=1). */
    drag?: boolean;
    /** The deck draws and turns picker wheels by itself (WHEEL, wheel=1). */
    wheel?: boolean;
    /** And dials: a volume arc or bar under the finger (dial=1). */
    dial?: boolean;
    /**
     * While it loads, it takes every page's widget pictures and keeps looks
     * sent ahead, counting them in its progress (warm=1).
     */
    warm?: boolean;
    /** The largest block it takes uploads in over USB, when asked with BLOCK. */
    block?: number;
    /** It slides text too long for its key along by itself (SLIDE, slide=1). */
    slide?: boolean;
    /** Why it last started: poweron, sw, panic, taskwdt, brownout... */
    resetReason?: string;
}
/** A USB-serial device that stayed silent when asked for its identity: possibly a deck without Decky firmware. */
export interface UnknownDevice {
    path: string;
    label: string;
}
export type DeckStatus =
    | { connected: true; identity: DeckIdentity }
    | {
          connected: false;
          unknownDevices?: UnknownDevice[];
          /** A deck's USB bridge that stopped answering: unplug it and plug it back in. */
          stuckPort?: string;
      };

export interface FirmwareOffer {
    source: "bundled" | "github";
    version: string;
    protocol: number;
}
export interface FirmwareInfo {
    /** This desktop app's own version. */
    appVersion: string;
    /** What the connected deck reports; version only from protocol 7 on. */
    installed: { protocol: number; version?: string } | null;
    transport: "usb" | "wifi" | null;
    bundled: { version: string; protocol: number } | null;
    /** The newest GitHub release, once checked. */
    latest: { version: string; protocol: number } | null;
    /** "owner/name" firmware releases come from, or null when not configured. */
    repository: string | null;
    /** The best newer firmware for the connected deck, if there is one. */
    update: FirmwareOffer | null;
    /** A newer Decky on GitHub, if there is one. */
    appUpdate: AppUpdateOffer | null;
}
export interface AppUpdateOffer {
    version: string;
    /** An installed Decky updates itself; a development build can only open the download. */
    canInstall: boolean;
}
/** Stages of Decky updating itself, shown on the update screen. */
export type AppUpdateProgress =
    | { stage: "checking" }
    | {
          stage: "downloading";
          version: string;
          percent: number;
          transferred: number;
          total: number;
          bytesPerSecond: number;
      }
    | { stage: "installing"; version: string }
    | { stage: "failed"; message: string }
    | { stage: "cancelled" };
export type FirmwareProgress =
    | { stage: "downloading" }
    | { stage: "connecting" }
    | { stage: "writing"; part: number; parts: number; written: number; total: number }
    | { stage: "restarting" };
export interface FirmwareInstallRequest {
    source: "bundled" | "github";
    /** For a first install from the Disconnected page; otherwise the connected deck's port. */
    path?: string;
    /** Required to write a different partition table, which can erase the Wi-Fi settings and pairing. */
    allowPartitionChange?: boolean;
}
export interface FirmwareInstallResult {
    ok: boolean;
    message: string;
    /** Set when the install stopped because it would change the partition table. */
    partitionChange?: boolean;
}
export interface DeviceCheck {
    crowPanel: boolean;
    chip: string;
    mac: string;
}
export interface WifiNetwork {
    ssid: string;
    rssi: number;
    security: "open" | "password" | "enterprise";
}
export interface WifiStatus {
    cacheStorage?: "sd" | "none";
    available: boolean;
    transport: "usb" | "wifi" | null;
    state: "connected" | "connecting" | "disconnected" | "unconfigured";
    ssid: string;
    ip: string;
    paired: boolean;
    /** False for firmware that cannot encrypt Wi-Fi, which Decky will not use. */
    encrypted?: boolean;
}
export type DeckEvent =
    | { kind: "key"; page: number; cell: number; down: boolean; at: number }
    /** A finger moving on a wheel key: its height inside the key, in pixels. */
    | { kind: "move"; page: number; cell: number; y: number; at: number }
    /** A wheel the deck turns came to rest on a new label. */
    | { kind: "wheel"; page: number; cell: number; index: number; at: number }
    /** A dial the deck turns has a new value, while a finger turns it. */
    | { kind: "value"; page: number; cell: number; value: number; at: number }
    | { kind: "page"; page: number; at: number }
    | { kind: "reset"; at: number }
    /** USB was lost and the connection continued over Wi-Fi. */
    | { kind: "fallback"; at: number }
    /** A USB-serial device was plugged in: worth a status check now. */
    | { kind: "ports"; at: number };
export interface Reply {
    ok: boolean;
    message: string;
}
export interface Activity {
    at: number;
    label: string;
    ok: boolean;
    message: string;
}
export interface WindowState {
    maximized: boolean;
}
export type WindowAction = "minimize" | "maximize" | "close";
export interface PageUpload {
    pageId: string;
    frames: Uint8Array[];
    toggleFrames?: { cell: number; frame: Uint8Array }[];
}
/**
 * What loading brings up to date besides the pages themselves: every widget
 * key's picture as it is now, with the text the deck slides on it (slide=1),
 * and the looks of the keys the deck turns, so no page opens on placeholders.
 */
export interface Warmup {
    widgets: { pageId: string; cell: number; frame: Uint8Array; slide?: Uint8Array | null }[];
    looks: { pageId: string; spec: Uint8Array }[];
}
export interface DeckApi {
    wifiStatus(): Promise<WifiStatus>;
    wifiScan(): Promise<WifiNetwork[]>;
    wifiJoin(ssid: string, password: string): Promise<Reply>;
    wifiForget(): Promise<Reply>;
    cachePages(pages: PageUpload[], warmup?: Warmup): Promise<Reply>;
    moveKey(from: KeyLocation, to: KeyLocation): Promise<DeckConfig>;
    duplicateKey(from: KeyLocation): Promise<{ config: DeckConfig; cell: number }>;
    listPrograms(): Promise<InstalledProgram[]>;
    programIcon(path: string): Promise<string | null>;
    getWindowState(): Promise<WindowState>;
    windowAction(action: WindowAction): Promise<WindowState>;
    onWindowState(handler: (state: WindowState) => void): () => void;
    status(): Promise<DeckStatus>;
    firmwareInfo(): Promise<FirmwareInfo>;
    /** Ask GitHub for the newest release, for both Decky and the deck's firmware. */
    firmwareCheck(): Promise<FirmwareInfo>;
    /** GitHub was checked in the background and may know of newer releases. */
    onUpdatesChanged(handler: () => void): () => void;
    /** Download the newest Decky and install it silently; stages arrive through onAppUpdateProgress. */
    appUpdateInstall(): Promise<void>;
    appUpdateCancel(): Promise<void>;
    /** Open the newest installer's download in the browser. */
    appUpdateDownload(): Promise<Reply>;
    onAppUpdateProgress(handler: (progress: AppUpdateProgress) => void): () => void;
    /** Restart a silent USB device into its bootloader and read what chip it is. */
    firmwareProbe(path: string): Promise<DeviceCheck>;
    firmwareInstall(request: FirmwareInstallRequest): Promise<FirmwareInstallResult>;
    onFirmwareProgress(handler: (progress: FirmwareProgress) => void): () => void;
    getConfig(): Promise<DeckConfig>;
    getKeyStates(): Promise<KeyStates>;
    onKeyStates(handler: (states: KeyStates) => void): () => void;
    /** Counts, running timers and server results, by key address. */
    widgetStates(): Promise<WidgetStates>;
    onWidgetStates(handler: (states: WidgetStates) => void): () => void;
    /**
     * Show a widget key's new picture on the deck, as a patch where it can,
     * and where the deck slides text along (slide=1) the text it slides on
     * it: a SLIDE payload, or null for none. Undefined leaves that alone.
     */
    liveKey(
        pageId: string,
        cell: number,
        frame: Uint8Array,
        slide?: Uint8Array | null,
    ): Promise<Reply>;
    /**
     * Hand an adjustable countdown at rest to the deck to draw and turn: its
     * wheel's look (src/shared/wheel-spec.ts), the times behind its labels,
     * and the label to show.
     */
    wheelKey(
        pageId: string,
        cell: number,
        spec: Uint8Array,
        values: number[],
        index: number,
    ): Promise<Reply>;
    saveConfig(config: DeckConfig): Promise<DeckConfig>;
    pickTarget(kind: "program" | "script"): Promise<string | null>;
    runKey(pageId: string, cell: number): Promise<Reply>;
    cancel(): Promise<void>;
    navigate(pageId: string): Promise<DeckConfig>;
    exportConfig(): Promise<Reply>;
    importConfig(): Promise<DeckConfig | null>;
    syncPage(
        pageId: string,
        frames: Uint8Array[],
        toggleFrames?: PageUpload["toggleFrames"],
    ): Promise<Reply>;
    onEvent(handler: (event: DeckEvent) => void): () => void;
    onConfig(handler: (config: DeckConfig) => void): () => void;
    onActivity(handler: (activity: Activity) => void): () => void;
}
declare global {
    interface Window {
        deck: DeckApi;
    }
}
