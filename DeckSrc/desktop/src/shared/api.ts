import type { KeyLocation } from "./key-layout";
import type { InstalledProgram } from "./programs";
import type { DeckConfig, KeyStates } from "./config";
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
}
/** A USB-serial device that stayed silent when asked for its identity: possibly a deck without Decky firmware. */
export interface UnknownDevice {
    path: string;
    label: string;
}
export type DeckStatus =
    | { connected: true; identity: DeckIdentity }
    | { connected: false; unknownDevices?: UnknownDevice[] };

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
    | { kind: "page"; page: number; at: number }
    | { kind: "reset"; at: number }
    /** USB was lost and the connection continued over Wi-Fi. */
    | { kind: "fallback"; at: number };
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
export interface DeckApi {
    wifiStatus(): Promise<WifiStatus>;
    wifiScan(): Promise<WifiNetwork[]>;
    wifiJoin(ssid: string, password: string): Promise<Reply>;
    wifiForget(): Promise<Reply>;
    cachePages(pages: PageUpload[]): Promise<Reply>;
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
