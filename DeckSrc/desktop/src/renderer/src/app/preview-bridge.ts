import { duplicateKey, moveKey } from "../../../shared/key-layout";
import type { DeckApi } from "../../../shared/api";
import { createConfig, retireWidgets, validateConfig } from "../../../shared/config";
// Browser previews use their own storage. Native actions remain unavailable there.
export function installPreviewBridge(): void {
    if (window.deck) return;
    let config = createConfig();
    try {
        const saved: unknown = JSON.parse(localStorage.getItem("decky-preview") ?? "null");
        retireWidgets(saved);
        validateConfig(saved);
        config = saved;
    } catch {
        /* First preview. */
    }
    const unavailable = async () => ({
        ok: false,
        message: "Open Decky desktop to use device and system actions.",
    });
    let maximized = false;
    const onlyProfile = {
        active: "default",
        profiles: [{ id: "default", name: "Default", madeAt: 0, usedAt: 0 }],
    };
    const api: DeckApi = {
        wifiStatus: async () => ({
            available: false,
            transport: null,
            state: "unconfigured",
            ssid: "",
            ip: "",
            paired: false,
        }),
        wifiScan: async () => [],
        wifiJoin: unavailable,
        wifiForget: unavailable,
        // No apps are reached from the browser preview.
        integrationStatus: async (id) => ({
            id,
            health: "closed",
            version: "",
            values: {},
            saved: {},
        }),
        integrationSave: async () => {
            throw new Error("Open Decky desktop to connect apps.");
        },
        onIntegrationStatus: () => () => {},
        integrationOpen: async () => ({ ok: false, message: "Open Decky desktop to start apps." }),
        integrationDownload: async () => {},
        integrationAuthorize: async () => ({
            ok: false,
            message: "Open Decky desktop to connect apps.",
        }),
        integrationCall: async () => {
            throw new Error("Open Decky desktop to connect apps.");
        },
        // Discord is out of reach from the browser preview.
        presenceStatus: async () => ({ enabled: false, discord: "closed", card: null }),
        presenceSet: async () => {
            throw new Error("Open Decky desktop to show it on Discord.");
        },
        onPresenceStatus: () => () => {},
        presenceEditing: async () => {},
        firmwareInfo: async () => ({
            appVersion: "preview",
            installed: null,
            transport: null,
            bundled: null,
            latest: null,
            repository: null,
            update: null,
            appUpdate: null,
        }),
        firmwareCheck: async () => ({
            appVersion: "preview",
            installed: null,
            transport: null,
            bundled: null,
            latest: null,
            repository: null,
            update: null,
            appUpdate: null,
        }),
        firmwareProbe: async () => {
            throw new Error("Open Decky desktop to check devices.");
        },
        firmwareInstall: unavailable,
        onFirmwareProgress: () => () => {},
        onUpdatesChanged: () => () => {},
        appUpdateInstall: async () => {},
        appUpdateCancel: async () => {},
        appUpdateDownload: unavailable,
        onAppUpdateProgress: () => () => {},
        cachePages: unavailable,
        moveKey: async (from, to) => {
            config = moveKey(config, from, to).config;
            localStorage.setItem("decky-preview", JSON.stringify(config));
            return structuredClone(config);
        },
        duplicateKey: async (from) => {
            const result = duplicateKey(config, from);
            config = result.config;
            localStorage.setItem("decky-preview", JSON.stringify(config));
            return { config: structuredClone(config), cell: result.cell };
        },
        listPrograms: async () => [],
        programIcon: async () => null,
        getWindowState: async () => ({ maximized }),
        windowAction: async (action) => {
            if (action === "maximize") maximized = !maximized;
            return { maximized };
        },
        onWindowState: () => () => {},
        getKeyStates: async () => ({}),
        onKeyStates: () => () => {},
        widgetStates: async () => ({}),
        onWidgetStates: () => () => {},
        liveKey: unavailable,
        wheelKey: unavailable,
        status: async () => ({ connected: false }),
        getConfig: async () => structuredClone(config),
        saveConfig: async (next) => {
            validateConfig(next);
            localStorage.setItem("decky-preview", JSON.stringify(next));
            config = next;
            return structuredClone(config);
        },
        navigate: async (pageId) => {
            config = { ...config, activePageId: pageId };
            return structuredClone(config);
        },
        back: async (pageId) => {
            const parent = config.pages.find((page) => page.id === pageId)?.parentId ?? "home";
            config = { ...config, activePageId: parent };
            return structuredClone(config);
        },
        runKey: unavailable,
        syncPage: unavailable,
        autoStart: async () => ({ on: false, available: false }),
        setAutoStart: async () => ({ on: false, available: false }),
        exportConfig: unavailable,
        inspectProfileFile: async () => null,
        inspectProfile: async () => {
            throw new Error("Open Decky desktop to use profiles.");
        },
        takeProfile: async (name?: string) => ({ id: "default", name: name ?? "Default" }),
        // One profile in the browser preview: the one in local storage.
        profiles: async () => onlyProfile,
        useProfile: async () => config,
        addProfile: async () => onlyProfile,
        renameProfile: async () => onlyProfile,
        removeProfile: async () => onlyProfile,
        onProfiles: () => () => {},
        onProfileOffer: () => () => {},
        waitingProfile: async () => null,
        pickTarget: async () => {
            throw new Error("File selection is available in Decky desktop.");
        },
        cancel: async () => {},
        onEvent: () => () => {},
        onConfig: () => () => {},
        onActivity: () => () => {},
    };
    window.deck = api;
}
