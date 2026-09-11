import { contextBridge, ipcRenderer } from "electron";
import type { DeckApi } from "../shared/api";
function listen<T>(channel: string, handler: (data: T) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, data: T): void => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}
const api: DeckApi = {
    wifiStatus: () => ipcRenderer.invoke("wifi:status"),
    firmwareInfo: () => ipcRenderer.invoke("firmware:info"),
    firmwareCheck: () => ipcRenderer.invoke("firmware:check"),
    firmwareProbe: (path) => ipcRenderer.invoke("firmware:probe", path),
    firmwareInstall: (request) => ipcRenderer.invoke("firmware:install", request),
    onFirmwareProgress: (handler) => listen("firmware:progress", handler),
    onUpdatesChanged: (handler) => listen("updates:changed", handler),
    appUpdateInstall: () => ipcRenderer.invoke("app-update:install"),
    appUpdateCancel: () => ipcRenderer.invoke("app-update:cancel"),
    appUpdateDownload: () => ipcRenderer.invoke("app-update:download"),
    onAppUpdateProgress: (handler) => listen("app-update:progress", handler),
    wifiScan: () => ipcRenderer.invoke("wifi:scan"),
    wifiJoin: (ssid, password) => ipcRenderer.invoke("wifi:join", ssid, password),
    wifiForget: () => ipcRenderer.invoke("wifi:forget"),
    integrationStatus: (id) => ipcRenderer.invoke("integration:status", id),
    integrationSave: (id, values) => ipcRenderer.invoke("integration:save", id, values),
    onIntegrationStatus: (handler) => listen("integration:status", handler),
    integrationOpen: (id) => ipcRenderer.invoke("integration:open", id),
    integrationDownload: (id) => ipcRenderer.invoke("integration:download", id),
    integrationAuthorize: (id) => ipcRenderer.invoke("integration:authorize", id),
    integrationCall: (id, name) => ipcRenderer.invoke("integration:call", id, name),
    presenceStatus: () => ipcRenderer.invoke("presence:status"),
    presenceSet: (enabled) => ipcRenderer.invoke("presence:set", enabled),
    onPresenceStatus: (handler) => listen("presence:status", handler),
    presenceEditing: (editing) => ipcRenderer.invoke("presence:editing", editing),
    cachePages: (pages, warmup) => ipcRenderer.invoke("pages:cache", pages, warmup),
    moveKey: (from, to) => ipcRenderer.invoke("keys:move", from, to),
    duplicateKey: (from) => ipcRenderer.invoke("keys:duplicate", from),
    listPrograms: () => ipcRenderer.invoke("programs:list"),
    programIcon: (path) => ipcRenderer.invoke("programs:icon", path),
    getWindowState: () => ipcRenderer.invoke("window:state"),
    windowAction: (action) => ipcRenderer.invoke("window:control", action),
    onWindowState: (handler) => listen("window:state", handler),
    status: () => ipcRenderer.invoke("deck:status"),
    getKeyStates: () => ipcRenderer.invoke("keys:states"),
    onKeyStates: (handler) => listen("keys:states", handler),
    widgetStates: () => ipcRenderer.invoke("widgets:states"),
    onWidgetStates: (handler) => listen("widgets:states", handler),
    liveKey: (page, cell, frame, overlays) =>
        ipcRenderer.invoke("deck:live", page, cell, frame, overlays),
    wheelKey: (page, cell, spec, values, index) =>
        ipcRenderer.invoke("deck:wheel", page, cell, spec, values, index),
    getConfig: () => ipcRenderer.invoke("config:get"),
    saveConfig: (config) => ipcRenderer.invoke("config:save", config),
    pickTarget: (kind) => ipcRenderer.invoke("target:pick", kind),
    runKey: (page, cell) => ipcRenderer.invoke("action:run", page, cell),
    cancel: () => ipcRenderer.invoke("action:cancel"),
    navigate: (page) => ipcRenderer.invoke("page:navigate", page),
    back: (page) => ipcRenderer.invoke("page:back", page),
    exportConfig: () => ipcRenderer.invoke("config:export"),
    importConfig: () => ipcRenderer.invoke("config:import"),
    syncPage: (pageId, frames, toggleFrames) =>
        ipcRenderer.invoke("page:sync", pageId, frames, toggleFrames),
    onEvent: (handler) => listen("deck:event", handler),
    onConfig: (handler) => listen("config:changed", handler),
    onActivity: (handler) => listen("action:activity", handler),
};
contextBridge.exposeInMainWorld("deck", api);
