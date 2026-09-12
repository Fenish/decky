import type { KeyLocation } from "./key-layout";
import type { InstalledProgram } from "./programs";
import type { DeckConfig, KeyStates } from "./config";
import type { WidgetStates } from "./widgets";
import type { IntegrationId, IntegrationStatus } from "./integrations/integration";
import type { PresenceStatus } from "./presence";
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
    /** It moves rings' arcs by itself (SWEEP, sweep=1). */
    sweep?: boolean;
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
    /**
     * It was for the profile as it was: the profile changed meanwhile, and the
     * window sends what it draws again - nothing to tell anyone.
     */
    stale?: boolean;
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
 * What the deck draws over a widget key by itself, by kind: text too long for
 * the key, to slide (SLIDE payload, slide=1), and a ring's arc, to move
 * (SWEEP payload, sweep=1). Null takes that kind away; left out, it is left
 * as it is.
 */
export interface KeyOverlays {
    slide?: Uint8Array | null;
    sweep?: Uint8Array | null;
}
/**
 * What loading brings up to date besides the pages themselves: every widget
 * key's picture as it is now, with what the deck draws over it, and the looks
 * of the keys the deck turns, so no page opens on placeholders.
 */
export interface Warmup {
    widgets: { pageId: string; cell: number; frame: Uint8Array; overlays?: KeyOverlays }[];
    looks: { pageId: string; spec: Uint8Array }[];
}
export interface DeckApi {
    wifiStatus(): Promise<WifiStatus>;
    wifiScan(): Promise<WifiNetwork[]>;
    wifiJoin(ssid: string, password: string): Promise<Reply>;
    wifiForget(): Promise<Reply>;
    /** How Decky stands with an app (shared/integrations); asking tries the app now. */
    integrationStatus(id: IntegrationId): Promise<IntegrationStatus>;
    /** Save an app's settings - a secret left null keeps the one saved, "" clears it - and try it. */
    integrationSave(
        id: IntegrationId,
        values: Record<string, string | null>,
    ): Promise<IntegrationStatus>;
    onIntegrationStatus(handler: (status: IntegrationStatus) => void): () => void;
    /** Start an app from where it is installed; it connects once it runs. */
    integrationOpen(id: IntegrationId): Promise<Reply>;
    /** Open the page to get an app from (its declaration's `download`). */
    integrationDownload(id: IntegrationId): Promise<void>;
    /** Ask an app's permission (Discord's Authorize); resolves once it is clicked, or not. */
    integrationAuthorize(id: IntegrationId): Promise<Reply>;
    /** Ask an app something by name, for a key's settings: Discord's "currentChannel". */
    integrationCall(id: IntegrationId, name: string): Promise<unknown>;
    /** Decky on Discord (Rich Presence): on or off, Discord there or not, and the card friends see. */
    presenceStatus(): Promise<PresenceStatus>;
    presenceSet(enabled: boolean): Promise<PresenceStatus>;
    onPresenceStatus(handler: (status: PresenceStatus) => void): () => void;
    /** A key is being edited in the app, or no longer: the card says so. */
    presenceEditing(editing: boolean): Promise<void>;
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
     * with what the deck draws over it by itself where it does (KeyOverlays).
     */
    liveKey(
        pageId: string,
        cell: number,
        frame: Uint8Array,
        overlays?: KeyOverlays,
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
    /** Whether Decky starts with Windows, and whether this Decky can. */
    autoStart(): Promise<AutoStart>;
    setAutoStart(on: boolean): Promise<AutoStart>;
    saveConfig(config: DeckConfig): Promise<DeckConfig>;
    pickTarget(kind: "program" | "script"): Promise<string | null>;
    runKey(pageId: string, cell: number): Promise<Reply>;
    cancel(): Promise<void>;
    navigate(pageId: string): Promise<DeckConfig>;
    /** A page's Back: the page it was opened from, else its parent. */
    back(pageId: string): Promise<DeckConfig>;
    /** The profiles on this PC, and switching between them. */
    profiles(): Promise<ProfileSet>;
    useProfile(id: string): Promise<DeckConfig>;
    addProfile(name: string): Promise<ProfileSet>;
    renameProfile(id: string, name: string): Promise<ProfileSet>;
    removeProfile(id: string): Promise<ProfileSet>;
    onProfiles(handler: (profiles: ProfileSet) => void): () => void;
    /** A .deckyprofile was opened with Decky: what is in it, to offer. */
    onProfileOffer(handler: (report: ProfileReport) => void): () => void;
    /** A profile as one file; the one in use without an id. */
    exportConfig(id?: string): Promise<Reply>;
    /** Look inside a .deckyprofile - one chosen, or one opened with Decky - and keep it. */
    inspectProfileFile(path?: string): Promise<ProfileReport | null>;
    inspectProfile(id: string): Promise<ProfileReport>;
    /** Keep the profile last looked at, under a name of your choosing. */
    takeProfile(name?: string): Promise<{ id: string; name: string }>;
    /** A profile opened with Decky that has not been answered yet. */
    waitingProfile(): Promise<ProfileReport | null>;
    syncPage(
        pageId: string,
        frames: Uint8Array[],
        toggleFrames?: PageUpload["toggleFrames"],
    ): Promise<Reply>;
    onEvent(handler: (event: DeckEvent) => void): () => void;
    onConfig(handler: (config: DeckConfig) => void): () => void;
    onActivity(handler: (activity: Activity) => void): () => void;
}
/** Whether Decky starts with Windows; `available` is false for a build that cannot. */
export interface AutoStart {
    on: boolean;
    available: boolean;
}
/** A program or script a profile's key would run. */
export interface ProfileRun {
    path: string;
    /** A script the profile carries, or a program it expects to be installed. */
    kind: "script" | "program";
    /** Whether the file itself came with the profile. */
    carried: boolean;
}
/**
 * What is in a profile, shown before it is imported or switched to: what it
 * came from, what it holds, and - the part worth reading - everything its
 * keys would run.
 */
export interface ProfileReport {
    name: string;
    /** When it was exported, and by which Decky; both 0 or empty for a profile of your own. */
    madeAt: number;
    app: string;
    pages: number;
    keys: number;
    /** Its widgets by type, the ones this Decky no longer has marked. */
    widgets: { type: string; label: string; count: number; retired: boolean }[];
    runs: ProfileRun[];
    /** The apps it is set up for; `secrets` says a password must be typed again. */
    apps: { id: string; name: string; settings: number; secrets: boolean }[];
    files: { count: number; bytes: number };
}
/** A profile as the window lists it. */
export interface ProfileCard {
    id: string;
    name: string;
    madeAt: number;
    usedAt: number;
}
/** The profiles there are, and which is in use. */
export interface ProfileSet {
    active: string;
    profiles: ProfileCard[];
}
declare global {
    interface Window {
        deck: DeckApi;
    }
}
