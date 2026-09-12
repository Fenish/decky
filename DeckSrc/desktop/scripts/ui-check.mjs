/* global URL, window, document, console, getComputedStyle, Buffer, Event, structuredClone */
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("out/renderer");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://decky.test/**", async (route) => {
        const path = resolve(
            root,
            decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "") ||
                "index.html",
        );
        if (!path.startsWith(root + sep)) {
            await route.abort();
            return;
        }
        try {
            await route.fulfill({
                body: await readFile(path),
                contentType:
                    {
                        ".js": "text/javascript",
                        ".css": "text/css",
                        ".html": "text/html",
                        ".png": "image/png",
                        ".webp": "image/webp",
                        ".obj": "text/plain",
                    }[extname(path)] ?? "application/octet-stream",
            });
        } catch {
            await route.fulfill({ status: 404, body: "Not found" });
        }
    });
    const appIcon =
        "data:image/png;base64," +
        (
            await readFile("output/openvpn-app-icon.png").catch(() =>
                readFile("resources/icon.png"),
            )
        ).toString("base64");
    await page.addInitScript((appIcon) => {
        let config = {
            version: 2,
            activePageId: "home",
            reducedMotion: true,
            pages: [{ id: "home", name: "Home", parentId: null, keys: {} }],
        };
        const states = {};
        const configListeners = new Set();
        const stateListeners = new Set();
        const widgetListeners = new Set();
        window.__profiles = {
            active: "default",
            profiles: [{ id: "default", name: "Default", madeAt: 0, usedAt: 0 }],
        };
        // Widget state as the main process would push it, for the checks.
        window.__setWidgetStates = (next) => widgetListeners.forEach((fn) => fn(next));
        // Sound is heard, not seen: the checks follow what the page asks of it.
        window.__playing = false;
        window.HTMLMediaElement.prototype.play = function () {
            Object.defineProperty(this, "paused", { value: false, configurable: true });
            window.__playing = true;
            window.__sound = this.src;
            return Promise.resolve();
        };
        window.HTMLMediaElement.prototype.pause = function () {
            Object.defineProperty(this, "paused", { value: true, configurable: true });
            window.__playing = false;
        };
        const listen = (set, fn) => {
            set.add(fn);
            return () => set.delete(fn);
        };
        let maximized = false;
        const wifi = {
            available: true,
            transport: "usb",
            state: "unconfigured",
            ssid: "",
            ip: "",
            paired: false,
        };
        window.__windowActions = [];
        const firmware = {
            appVersion: "0.2.0",
            installed: { protocol: 6 },
            transport: "usb",
            bundled: { version: "1.4.0", protocol: 7 },
            latest: null,
            repository: "someone/decky",
            update: { source: "bundled", version: "1.4.0", protocol: 7 },
            appUpdate: null,
        };
        const updateListeners = new Set();
        const appUpdateListeners = new Set();
        window.__updatesChanged = () => updateListeners.forEach((fn) => fn());
        window.__appUpdate = (progress) => appUpdateListeners.forEach((fn) => fn(progress));
        window.__appUpdateCalls = { install: 0, cancel: 0, download: 0 };
        window.__apps = {
            obs: {
                id: "obs",
                health: "closed",
                version: "",
                values: { address: "localhost:4455" },
                saved: { password: false },
            },
            // Discord: not authorized until its card's Authorize.
            discord: { id: "discord", health: "off", version: "", values: {}, saved: {} },
        };
        window.__appCalls = { open: 0, download: 0 };
        window.__presence = { enabled: false, discord: "closed", card: null };
        const appListeners = new Set();
        const appChanged = (id) => appListeners.forEach((fn) => fn({ ...window.__apps[id] }));
        window.deck = {
            firmwareInfo: async () => ({ ...firmware }),
            firmwareCheck: async () => ({ ...firmware, latest: { version: "1.4.0", protocol: 7 } }),
            firmwareProbe: async () => ({
                crowPanel: true,
                chip: "ESP32-S3",
                mac: "a4:cb:8f:cd:d2:74",
            }),
            firmwareInstall: async (request) => {
                window.__firmwareInstall = request;
                return { ok: true, message: "Firmware 1.4.0 installed. Decky is restarting." };
            },
            onFirmwareProgress: () => () => {},
            onUpdatesChanged: (fn) => listen(updateListeners, fn),
            appUpdateInstall: async () => {
                window.__appUpdateCalls.install += 1;
            },
            appUpdateCancel: async () => {
                window.__appUpdateCalls.cancel += 1;
            },
            appUpdateDownload: async () => {
                window.__appUpdateCalls.download += 1;
                return { ok: true, message: "The download opened in your browser." };
            },
            onAppUpdateProgress: (fn) => listen(appUpdateListeners, fn),
            wifiStatus: async () => ({ ...wifi }),
            wifiScan: async () => [
                { ssid: "Home Wi-Fi", rssi: -42, security: "password" },
                { ssid: "Guest", rssi: -70, security: "open" },
                { ssid: "Office", rssi: -65, security: "enterprise" },
            ],
            wifiJoin: async (ssid, password) => {
                if (password === "refused-password")
                    return { ok: false, message: "Could not start Wi-Fi connection." };
                window.__wifiCredentials = { ssid, password };
                // Like the firmware: the network being joined is reported while connecting.
                wifi.state = "connecting";
                wifi.ssid = ssid;
                window.__finishJoin = () => {
                    wifi.state = "connected";
                    wifi.ip = "192.168.1.20";
                    wifi.paired = true;
                };
                return { ok: true, message: "Connecting" };
            },
            wifiForget: async () => {
                window.__wifiForgotten = true;
                wifi.state = "unconfigured";
                wifi.ssid = "";
                wifi.ip = "";
                wifi.paired = false;
                return { ok: true, message: "Decky forgot the Wi-Fi network." };
            },
            // OBS: closed; opened, its WebSocket server is off until its settings are saved.
            integrationStatus: async (id) => ({ ...window.__apps[id] }),
            integrationOpen: async (id) => {
                window.__appCalls.open += 1;
                window.__apps[id] = { ...window.__apps[id], health: "off" };
                appChanged(id);
                return { ok: true, message: "OBS is open, but its WebSocket server is off." };
            },
            integrationDownload: async () => {
                window.__appCalls.download += 1;
            },
            integrationAuthorize: async (id) => {
                window.__apps[id] = { ...window.__apps[id], health: "ready", version: "Fenish" };
                appChanged(id);
                return { ok: true, message: "Connected to Discord as Fenish." };
            },
            integrationCall: async (id, name) =>
                id === "discord" && name === "currentChannel"
                    ? { id: "1328777481595125844", name: "General" }
                    : null,
            integrationSave: async (id, values) => {
                window.__apps[id] = {
                    ...window.__apps[id],
                    health: "ready",
                    version: "31.0.2",
                    values: { address: values.address },
                    saved: { password: values.password ? true : window.__apps[id].saved.password },
                };
                return { ...window.__apps[id] };
            },
            // Discord: off until Settings turns it on; then connected, at the deck.
            presenceStatus: async () => ({ ...window.__presence }),
            presenceSet: async (enabled) => {
                window.__presence = enabled
                    ? {
                          enabled: true,
                          discord: "connected",
                          card: {
                              details: "At the deck",
                              state: "128 presses today",
                              since: Date.now() - 2_530_000,
                          },
                      }
                    : { enabled: false, discord: "closed", card: null };
                return { ...window.__presence };
            },
            onPresenceStatus: () => () => {},
            presenceEditing: async (editing) => {
                window.__presenceEditing = editing;
            },
            onIntegrationStatus: (fn) => {
                appListeners.add(fn);
                return () => appListeners.delete(fn);
            },
            wifiTransport: async (transport) => {
                wifi.transport = transport;
                return { ok: true, message: `Using ${transport}` };
            },
            listPrograms: async () => [
                { name: "OpenVPN Connect", path: "C:\\Menu\\OpenVPN.lnk", source: "start-menu" },
                { name: "OpenVPN GUI", path: "C:\\Apps\\OpenVPN-GUI.exe", source: "registered" },
                {
                    name: "Calculator",
                    path: "app:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
                    source: "windows",
                },
            ],
            programIcon: async () => appIcon,
            duplicateKey: async (from) => {
                const page = config.pages.find((p) => p.id === from.pageId);
                const cell = Array.from({ length: 15 }, (_, i) => (from.cell + i + 1) % 15).find(
                    (i) => !page.keys[i] && !(page.parentId && i === 10),
                );
                if (cell === undefined) throw new Error("Full page");
                config = {
                    ...config,
                    pages: config.pages.map((p) =>
                        p.id === page.id
                            ? {
                                  ...p,
                                  keys: {
                                      ...p.keys,
                                      [cell]: structuredClone(page.keys[from.cell]),
                                  },
                              }
                            : p,
                    ),
                };
                configListeners.forEach((fn) => fn(config));
                return { config, cell };
            },
            moveKey: async (from, to) => {
                const source = config.pages.find((p) => p.id === from.pageId).keys[from.cell];
                const target = config.pages.find((p) => p.id === to.pageId).keys[to.cell];
                config = {
                    ...config,
                    pages: config.pages.map((p) => {
                        const keys = { ...p.keys };
                        if (p.id === from.pageId) {
                            if (target) keys[from.cell] = target;
                            else delete keys[from.cell];
                        }
                        if (p.id === to.pageId) keys[to.cell] = source;
                        return { ...p, keys };
                    }),
                };
                configListeners.forEach((fn) => fn(config));
                return config;
            },
            getWindowState: async () => ({ maximized }),
            windowAction: async (action) => {
                window.__windowActions.push(action);
                if (action === "maximize") maximized = !maximized;
                return { maximized };
            },
            onWindowState: () => () => {},
            status: async () => ({
                connected: true,
                identity: {
                    portPath: "TEST",
                    protocol: 1,
                    serial: "a4cb8fcdd274",
                    cells: 15,
                    columns: 5,
                    rows: 3,
                    keyWidth: 118,
                    keyHeight: 123,
                    pages: 2,
                    live: true,
                },
            }),
            getConfig: async () => config,
            getKeyStates: async () => states,
            onKeyStates: (fn) => listen(stateListeners, fn),
            widgetStates: async () => ({}),
            onWidgetStates: (fn) => listen(widgetListeners, fn),
            // Profiles: one of its own, and nothing opened with Decky.
            profiles: async () => window.__profiles,
            useProfile: async (id) => {
                window.__profiles = { ...window.__profiles, active: id };
                return config;
            },
            addProfile: async (name) => {
                window.__profiles = {
                    ...window.__profiles,
                    profiles: [
                        ...window.__profiles.profiles,
                        { id: `p${window.__profiles.profiles.length}`, name, madeAt: 0, usedAt: 0 },
                    ],
                };
                return window.__profiles;
            },
            renameProfile: async (id, name) => {
                window.__profiles = {
                    ...window.__profiles,
                    profiles: window.__profiles.profiles.map((item) =>
                        item.id === id ? { ...item, name } : item,
                    ),
                };
                return window.__profiles;
            },
            removeProfile: async (id) => {
                window.__profiles = {
                    ...window.__profiles,
                    profiles: window.__profiles.profiles.filter((item) => item.id !== id),
                };
                return window.__profiles;
            },
            onProfiles: () => () => {},
            onProfileOffer: () => () => {},
            waitingProfile: async () => null,
            inspectProfileFile: async () => null,
            inspectProfile: async (id) => ({
                name: window.__profiles.profiles.find((item) => item.id === id)?.name ?? id,
                madeAt: 0,
                app: "",
                pages: config.pages.length,
                keys: config.pages.reduce((sum, page) => sum + Object.keys(page.keys).length, 0),
                widgets: [],
                runs: [],
                apps: [],
                files: { count: 0, bytes: 0 },
            }),
            takeProfile: async () => ({ id: "taken", name: "Taken" }),
            liveKey: async (pageId, cell, frame) => {
                (window.__liveFrames ??= []).push({ pageId, cell, bytes: frame.length });
                return { ok: true, message: "" };
            },
            wheelKey: async (pageId, cell, spec, values, index) => {
                (window.__wheels ??= []).push({ pageId, cell, bytes: spec.length, values, index });
                return { ok: true, message: "" };
            },
            onConfig: (fn) => listen(configListeners, fn),
            onEvent: (fn) => {
                window.__deviceEvent = fn;
                return () => {};
            },
            onActivity: () => () => {},
            saveConfig: async (next) => {
                config = next;
                configListeners.forEach((fn) => fn(config));
                return config;
            },
            navigate: async (id) => {
                // As main does: a page remembers the one it was opened from, for its Back.
                if (id !== config.activePageId)
                    window.__cameFrom = { ...window.__cameFrom, [id]: config.activePageId };
                config = { ...config, activePageId: id };
                configListeners.forEach((fn) => fn(config));
                return config;
            },
            back: async (id) => {
                const from = window.__cameFrom?.[id];
                const to = config.pages.some((p) => p.id === from)
                    ? from
                    : config.pages.find((p) => p.id === id).parentId;
                config = { ...config, activePageId: to };
                configListeners.forEach((fn) => fn(config));
                return config;
            },
            runKey: async (id, cell) => {
                if (window.__failAction) return { ok: false, message: "Test action failed" };
                const key = config.pages.find((p) => p.id === id).keys[cell];
                if (key?.behavior === "toggle") {
                    states[`${id}:${cell}`] = !states[`${id}:${cell}`];
                    stateListeners.forEach((fn) => fn({ ...states }));
                }
                return { ok: true, message: "Test action succeeded" };
            },
            cancel: async () => {},
            pickTarget: async (kind) =>
                kind === "program" ? "C:\\Windows\\notepad.exe" : "C:\\Decky\\example.ps1",
            syncPage: async () => ({ ok: true, message: "Test sync" }),
            exportConfig: async () => ({ ok: true, message: "Test export" }),
            importConfig: async () => null,
        };
    }, appIcon);
    await page.goto("https://decky.test/");
    await expect(page.locator(".floating-deck")).toBeVisible();
    await expect(page.locator(".titlebar-brand svg")).toBeVisible();
    const logoBox = await page.locator(".titlebar-brand svg").boundingBox();
    if (logoBox.width > 32 || logoBox.height > 34) throw new Error("Titlebar logo is oversized");
    await page.getByRole("button", { name: "Maximize window", exact: true }).click();
    await page.getByRole("button", { name: "Restore window", exact: true }).click();
    await page.getByRole("button", { name: "Minimize window", exact: true }).click();
    if ((await page.evaluate(() => window.__windowActions)).join() !== "maximize,maximize,minimize")
        throw new Error("Window controls did not dispatch expected actions");
    // The title bar names the connection in use, and a USB link that came back
    // over Wi-Fi is announced rather than looking like nothing happened.
    await expect(page.locator(".titlebar-transport")).toHaveText("USB");
    await page.evaluate(() => window.__deviceEvent({ kind: "fallback", at: Date.now() }));
    await expect(page.getByText("USB unplugged. Decky is continuing over Wi-Fi.")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss notification" }).click();

    await expect(page.locator(".deck-key.empty")).toHaveCount(15);
    const empty = await page
        .locator(".deck-key.empty")
        .evaluateAll((elements) =>
            elements.every(
                (el) =>
                    el.textContent.trim() === "" &&
                    getComputedStyle(el).backgroundColor === "rgb(0, 0, 0)",
            ),
        );
    if (!empty) throw new Error("Empty keys are not completely black and unlabelled");
    await mkdir("output", { recursive: true });
    await page.screenshot({ path: "output/decky-dashboard-empty.png" });
    // Example assignments exist only inside this browser fixture.
    await page.evaluate(async () => {
        const config = await window.deck.getConfig();
        config.pages.push({ id: "obs", name: "OBS", parentId: "home", keys: {} });
        config.pages[0].keys = {
            0: {
                label: "Mic",
                icon: "mic",
                color: "#eee8da",
                action: { kind: "hotkey", keys: "Ctrl+Shift+M" },
            },
            1: {
                label: "OBS",
                icon: "video",
                color: "#eee8da",
                action: { kind: "page", pageId: "obs" },
            },
            2: {
                label: "Browser",
                icon: "website",
                color: "#eee8da",
                action: { kind: "website", url: "https://example.com" },
            },
        };
        await window.deck.saveConfig(config);
    });
    await page.getByRole("button", { name: "Key 1: Mic", exact: true }).waitFor();
    await page.screenshot({ path: "output/decky-floating-dashboard.png" });
    const wide = await page.locator(".floating-deck").boundingBox();
    await page.getByRole("button", { name: "Key 4: Unassigned", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hotkey", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const narrow = await page.locator(".floating-deck").boundingBox();
    if (!wide || !narrow || narrow.width >= wide.width || narrow.x >= wide.x)
        throw new Error("Grid did not shrink and slide left");
    await expect(page.locator(".action-options").first().locator("button")).toHaveCount(6);
    // Widgets are one step in, behind their own entry, with a way back.
    await expect(page.getByRole("group", { name: "Widgets", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "output/decky-action-picker.png" });
    await page.locator(".picker-entry", { hasText: "Widgets" }).click();
    await expect(
        page.getByRole("group", { name: "Widgets", exact: true }).getByRole("button"),
    ).toHaveCount(14);
    await page.screenshot({ path: "output/decky-widget-picker.png" });
    await page.getByRole("button", { name: "Back to actions", exact: true }).click();
    // Apps are one step in too, each app's keys one further, with a way back from each.
    await page.locator(".picker-entry", { hasText: "Apps" }).click();
    // An app's row is its name alone.
    await expect(
        page.locator(".picker-entry", { hasText: "OBS Studio" }).locator("small"),
    ).toHaveCount(0);
    await page.locator(".picker-entry", { hasText: "OBS Studio" }).click();
    await expect(
        page.getByRole("group", { name: "OBS Studio", exact: true }).getByRole("button"),
    ).toHaveText(["Recording", "Streaming"]);
    // Its page opens with a line on how Decky stands with OBS, a rule under
    // it, then OBS's keys.
    const obsCard = page.getByRole("region", { name: "OBS Studio connection", exact: true });
    await expect(obsCard).toContainText("OBS is closed");
    await expect(
        page.locator('.picker-heading + .app-card + hr.picker-divider + [role="group"]'),
    ).toHaveCount(1);
    await page.screenshot({ path: "output/decky-obs-closed.png" });
    // Closed, its button starts OBS; the small one beside it opens its settings.
    const connect = page.getByRole("dialog", { name: "Connect OBS Studio", exact: true });
    await obsCard.getByRole("button", { name: "OBS Studio settings", exact: true }).click();
    await expect(connect).toContainText("OBS Studio is closed.");
    await connect.getByRole("button", { name: "Cancel", exact: true }).click();
    await obsCard.getByRole("button", { name: "Open OBS", exact: true }).click();
    await expect(obsCard).toContainText("WebSocket server off");
    if ((await page.evaluate(() => window.__appCalls.open)) !== 1)
        throw new Error("Open OBS did not ask main to start OBS");
    // Open with its WebSocket server off, Connect… opens its address and
    // password, and saving connects it and closes the dialog.
    await expect(obsCard.getByRole("button", { name: "OBS Studio settings" })).toHaveCount(0);
    await obsCard.getByRole("button", { name: "Connect…", exact: true }).click();
    await expect(connect).toContainText("its WebSocket server is off");
    await page.screenshot({ path: "output/decky-obs-connect.png" });
    await connect.getByLabel("OBS Studio password", { exact: true }).fill("from-obs");
    await connect.getByRole("button", { name: "Save and connect", exact: true }).click();
    await expect(connect).toHaveCount(0);
    await expect(obsCard).toContainText("Connected · OBS 31.0.2");
    await page.screenshot({ path: "output/decky-obs-page.png" });
    // The password is never shown again: the dialog says one is saved.
    await obsCard.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(connect.getByLabel("OBS Studio password", { exact: true })).toHaveAttribute(
        "placeholder",
        "Saved - type to replace",
    );
    await connect.getByRole("button", { name: "Cancel", exact: true }).click();
    // Picked, an app's key changes only to another of that app's widgets, its
    // editor has the same card, and the choice is taken back to the app's page.
    await page
        .getByRole("group", { name: "OBS Studio", exact: true })
        .getByRole("button", { name: "Recording", exact: true })
        .click();
    await expect(obsCard).toContainText("Connected · OBS 31.0.2");
    await expect(page.getByLabel("Widget type", { exact: true }).locator("option")).toHaveText([
        "Recording",
        "Streaming",
    ]);
    await page.getByRole("button", { name: "Back to OBS Studio", exact: true }).click();
    await page.getByRole("button", { name: "Back to apps", exact: true }).click();
    // Discord: its card asks for permission, then its controls and its widget.
    await page.locator(".picker-entry", { hasText: "Discord" }).click();
    const discordCard = page.getByRole("region", { name: "Discord connection", exact: true });
    await expect(discordCard).toContainText("Not authorized yet");
    // No settings to type: no small settings button.
    await expect(discordCard.getByRole("button", { name: "Discord settings" })).toHaveCount(0);
    await discordCard.getByRole("button", { name: "Authorize", exact: true }).click();
    await expect(discordCard).toContainText("Connected as Fenish");
    await expect(
        page.getByRole("group", { name: "Discord controls", exact: true }).getByRole("button"),
    ).toHaveText([
        "Mute",
        "Deafen",
        "Camera",
        "Screen share",
        "Noise suppression",
        "Echo cancellation",
        "Auto gain",
        "Leave call",
    ]);
    await expect(
        page.getByRole("group", { name: "Discord", exact: true }).getByRole("button"),
    ).toHaveText([
        "Voice channel",
        "Current call",
        "Mic switcher",
        "Output switcher",
        "Notifications",
    ]);
    await page.screenshot({ path: "output/decky-discord-page.png" });
    // Mute is a toggle from the start: OFF as Discord is at rest, ON muted in red.
    await page
        .getByRole("group", { name: "Discord controls", exact: true })
        .getByRole("button", { name: "Mute", exact: true })
        .click();
    await expect(page.getByLabel("Discord control", { exact: true })).toHaveValue("mute");
    await expect(
        page
            .getByRole("group", { name: "Button behavior" })
            .getByRole("button", { name: "Toggle" }),
    ).toHaveClass(/active/);
    await expect(page.getByLabel("Key title", { exact: true })).toHaveValue("Mute");
    await page.getByRole("button", { name: "Back to Discord", exact: true }).click();
    // Leave call too: ON, in red, while you are in a call.
    await page
        .getByRole("group", { name: "Discord controls", exact: true })
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
    await expect(
        page
            .getByRole("group", { name: "Button behavior" })
            .getByRole("button", { name: "Toggle" }),
    ).toHaveClass(/active/);
    // Its two looks are named as its states, not OFF and ON.
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(
        page
            .getByRole("group", { name: "Edit toggle appearance", exact: true })
            .getByRole("button"),
    ).toHaveText(["Not in a call", "In a call"]);
    await page.getByRole("tab", { name: "Action", exact: true }).click();
    await page.getByRole("button", { name: "Back to Discord", exact: true }).click();
    // The voice channel's key takes the channel you are in.
    await page
        .getByRole("group", { name: "Discord", exact: true })
        .getByRole("button", { name: "Voice channel", exact: true })
        .click();
    await page.getByRole("button", { name: "Use current", exact: true }).click();
    await expect(page.getByLabel("Voice channel ID", { exact: true })).toHaveValue(
        "1328777481595125844",
    );
    await expect(page.locator(".channel-name")).toHaveText("General");
    await page.screenshot({ path: "output/decky-discord-channel.png" });
    // Its looks are in Appearance: how people sit, its name or not, and the
    // icon it shows with no one there, at the size picked.
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    const people = page.getByRole("group", { name: "People", exact: true });
    await expect(people.getByRole("button")).toHaveText(["Grid", "Row", "Stack"]);
    await people.getByRole("button", { name: "Stack", exact: true }).click();
    await expect(people.getByRole("button", { name: "Stack", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    const channelName = page.getByRole("switch", { name: "Channel name", exact: true });
    await expect(channelName).toHaveAttribute("aria-checked", "true");
    await channelName.click();
    await expect(channelName).toHaveAttribute("aria-checked", "false");
    await page.getByLabel("Search icons", { exact: true }).fill("headset");
    await page.getByRole("button", { name: "Use Headset icon", exact: true }).click();
    await page.getByLabel("Icon size", { exact: true }).fill("150");
    await expect(page.locator(".slider-value", { hasText: "150%" })).toBeVisible();
    await page.screenshot({ path: "output/decky-discord-looks.png" });
    // The channel kept through it all.
    await page.getByRole("tab", { name: "Widget", exact: true }).click();
    await expect(page.getByLabel("Voice channel ID", { exact: true })).toHaveValue(
        "1328777481595125844",
    );
    await page.getByRole("button", { name: "Back to Discord", exact: true }).click();
    await page.getByRole("button", { name: "Back to apps", exact: true }).click();
    await page.getByRole("button", { name: "Back to actions", exact: true }).click();
    await page.getByLabel("Find an action", { exact: true }).fill("spotify");
    await expect(
        page.getByRole("group", { name: "Widgets", exact: true }).getByRole("button"),
    ).toHaveText(["Now playing"]);
    await page.getByLabel("Find an action", { exact: true }).fill("");
    // A choice made in the picker can be taken back until the key is saved.
    await page.getByRole("button", { name: "Macro", exact: true }).click();
    await page.getByRole("button", { name: "Back to actions", exact: true }).click();
    await expect(page.locator(".action-options").first().locator("button")).toHaveCount(6);
    await page.getByRole("button", { name: "Macro", exact: true }).click();
    await page.getByLabel("Key title", { exact: true }).fill("Go live");
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.getByRole("button", { name: "Hotkey", exact: true }).click();
    await page.getByRole("button", { name: "Move step 2 up", exact: true }).click();
    // A new hotkey step reserves a free F13-F24 combination by itself, and an
    // auto-assigned key shows no key field at all.
    await expect(page.getByLabel("Step hotkey", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.getByRole("button", { name: "Hotkey", exact: true }).click();
    await expect(page.getByLabel("Step hotkey", { exact: true })).toHaveCount(0);
    // Switching auto-assign off reveals the field, pre-filled with what was
    // reserved - F14, because the unsaved sibling above already holds F13.
    await page.getByRole("switch", { name: "Auto-assign key", exact: true }).nth(1).click();
    await expect(page.getByLabel("Step hotkey", { exact: true })).toHaveValue("F14");
    await page.getByLabel("Step hotkey", { exact: true }).fill("Ctrl+Shift+R");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(page.getByRole("status", { name: "Connected", exact: true })).toBeVisible();
    const macro = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[3].action,
    );
    if (macro.kind !== "macro" || macro.steps.map((s) => s.kind).join() !== "hotkey,delay,hotkey")
        throw new Error("Macro order not saved");
    const [first, , last] = macro.steps;
    if (first.keys !== "F13" || first.auto !== true)
        throw new Error(`Auto-assigned step saved wrong: ${JSON.stringify(first)}`);
    if (last.keys !== "Ctrl+Shift+R" || last.auto !== false)
        throw new Error(`Hand-set step saved wrong: ${JSON.stringify(last)}`);
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.screenshot({ path: "output/decky-macro-editor.png" });
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.waitForTimeout(500);
    const restored = await page.locator(".floating-deck").boundingBox();
    if (Math.abs(restored.width - wide.width) > 2 || Math.abs(restored.x - wide.x) > 2)
        throw new Error("Grid did not recenter");
    await page.getByRole("button", { name: "Key 1: Mic", exact: true }).click();
    await page.getByRole("button", { name: "Toggle", exact: true }).click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.getByLabel("State title", { exact: true }).fill("Mic off");
    await page.locator("input[type=file]").setInputFiles("resources/icon.png");
    await page.getByRole("button", { name: "Remove image", exact: true }).waitFor();
    await page.getByRole("button", { name: "ON appearance", exact: true }).click();
    await page.getByLabel("State title", { exact: true }).fill("Mic on");
    await page
        .locator("input[type=file]")
        .setInputFiles("src/renderer/src/assets/decky-studio-fallback.png");
    await page.getByRole("button", { name: "Remove image", exact: true }).waitFor();
    await page.getByRole("slider", { name: "Zoom", exact: true }).press("End");
    await page.getByRole("slider", { name: "Rotation", exact: true }).press("End");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const toggle = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[0],
    );
    if (
        toggle.behavior !== "toggle" ||
        toggle.artwork.source === toggle.activeAppearance.artwork.source ||
        toggle.activeAppearance.artwork.rotation !== 180 ||
        toggle.artwork.rotation !== 0
    )
        throw new Error("OFF/ON artwork was not kept separate");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await page.getByRole("button", { name: "Key 1: Mic on", exact: true }).waitFor();
    await page.evaluate(() => {
        window.__cacheCalls = 0;
        window.deck.cachePages = async (pages) => {
            window.__cacheCalls++;
            window.__cachedPageIds = pages.map((page) => page.pageId);
            window.__hardwareFrames = pages
                .find((page) => page.pageId === "home")
                .frames.map((frame) => Array.from(frame));
            return { ok: true, message: "Preloaded" };
        };
        window.__failAction = true;
    });
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByRole("button", { name: "Key 1: Mic on", exact: true })).toBeVisible();
    await page.evaluate(() => {
        window.__failAction = false;
    });
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await page.getByRole("button", { name: "Key 1: Mic off", exact: true }).waitFor();
    await page.screenshot({ path: "output/decky-toggle-editor.png" });
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.getByRole("button", { name: "Key 1: Mic off", exact: true }).click();
    await page.getByRole("button", { name: "Manage pages", exact: true }).click();
    await page.getByRole("button", { name: "Rename OBS", exact: true }).click();
    await page.getByLabel("Page name", { exact: true }).fill("Streaming");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    // Opening a page from the list keeps the Pages panel open.
    await page.locator(".page-open", { hasText: "Streaming" }).click();
    await expect(page.locator('select[aria-label="Current page"] option:checked')).toHaveText(
        "Streaming",
    );
    await expect(page.getByRole("region", { name: "Pages", exact: true })).toBeVisible();
    await page.locator(".page-open", { hasText: "Home" }).click();
    await expect(page.locator('select[aria-label="Current page"] option:checked')).toHaveText(
        "Home",
    );
    await expect(page.getByRole("region", { name: "Pages", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close pages", exact: true }).click();
    await page.getByRole("button", { name: "Key 2: OBS", exact: true }).dblclick();
    await page.getByRole("button", { name: "Key 11: Back", exact: true }).waitFor();
    await page.getByRole("button", { name: "Key 11: Back", exact: true }).click();
    await page.getByRole("button", { name: "Create page", exact: true }).click();
    await page.getByLabel("Page name", { exact: true }).fill("Work");
    await page.getByRole("button", { name: "Create page", exact: true }).last().click();
    await page.getByRole("button", { name: "Key 11: Back", exact: true }).waitFor();
    await page.getByRole("button", { name: "Key 11: Back", exact: true }).click();
    await page.getByRole("button", { name: "Key 5: Unassigned", exact: true }).click();
    await page.getByRole("button", { name: "Program", exact: true }).click();
    await page.getByRole("combobox", { name: "Search programs", exact: true }).fill("openvpn");
    await expect(
        page.getByRole("listbox", { name: "Installed applications", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
    await expect(
        page.getByRole("listbox").getByRole("option").first().locator("img"),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Search programs", exact: true })).toHaveCSS(
        "outline-style",
        "none",
    );
    await page.screenshot({ path: "output/decky-program-search.png" });
    await page.getByRole("combobox", { name: "Search programs", exact: true }).press("Enter");
    await expect(page.getByRole("combobox", { name: "Search programs", exact: true })).toHaveValue(
        "OpenVPN Connect",
    );
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await page.getByRole("button", { name: "Key 6: Unassigned", exact: true }).click();
    await page.getByRole("button", { name: "Script", exact: true }).click();
    await page.getByRole("button", { name: "Browse files", exact: true }).click();
    await expect(page.getByLabel("PowerShell script", { exact: true })).toHaveValue(
        /example\.ps1$/,
    );
    await expect(
        page.getByRole("switch", { name: "Run in background", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
        page.getByRole("switch", { name: "Wait for completion", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Script timeout seconds", { exact: true })).toHaveValue("30");
    await page.getByRole("switch", { name: "Run in background", exact: true }).click();
    await page.getByRole("switch", { name: "Wait for completion", exact: true }).click();
    await expect(page.getByLabel("Script timeout seconds", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await page.getByRole("button", { name: "Key 3: Browser", exact: true }).click();
    await page.getByLabel("Key title", { exact: true }).fill("");
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.getByLabel("Button background", { exact: true }).fill("#304050");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const unlabelled = page.getByRole("button", { name: "Key 3: Unlabelled action", exact: true });
    await expect(unlabelled.locator(".key-label")).toHaveCount(0);
    await expect(unlabelled).toHaveCSS("background-color", "rgb(48, 64, 80)");
    // Where the key's ink starts and ends down the key; `part` looks at that
    // much of it from the top, to weigh the icon without the label under it.
    const inkBounds = async (locator, part = 1) =>
        locator.locator("canvas").evaluate((canvas, share) => {
            const pixels = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, Math.round(canvas.height * share)).data;
            const rows = [];
            const bottom = Math.round(canvas.height * share);
            for (let y = 0; y < bottom; y++)
                for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    if (pixels[i] > 150 && pixels[i + 1] > 120) {
                        rows.push(y);
                        break;
                    }
                }
            return { min: Math.min(...rows), max: Math.max(...rows), height: canvas.height };
        }, part);
    const bounds = await inkBounds(unlabelled);
    if (Math.abs((bounds.min + bounds.max) / 2 - bounds.height / 2) > 2)
        throw new Error("Labelless icon not centered");
    const pixel = await page
        .locator(".editor-preview canvas")
        .evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(4, 4, 1, 1).data));
    if (pixel[0] !== 48 || pixel[1] !== 64 || pixel[2] !== 80)
        throw new Error("Rendered background differs from selected color");
    await page.screenshot({ path: "output/decky-labelless-key.png" });
    // Lucide's everyday icons, then a few brands' logos (Simple Icons).
    await expect(page.locator(".icon-options button")).toHaveCount(32);
    await expect(page.getByRole("button", { name: "Use Discord icon", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
    await page.getByLabel("Search icons", { exact: true }).fill("battle");
    await expect(
        page.getByRole("button", { name: "Use Battle.net icon", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search icons", { exact: true }).fill("air vent");
    await page.getByRole("button", { name: "Use Air Vent icon", exact: true }).click();
    await page.getByLabel("Search icons", { exact: true }).fill("");
    await expect(page.locator(".icon-options button")).toHaveCount(32);
    await page.getByLabel("Key title", { exact: true }).fill("Vent");
    await page.getByLabel("Custom accent color", { exact: true }).fill("#eebb77");
    const vent = page.getByRole("button", { name: "Key 3: Vent", exact: true });
    const matchingPreviews = async () =>
        expect
            .poll(() =>
                page.evaluate(() => {
                    const canvases = [
                        ...document.querySelectorAll(
                            ".deck-key.selected canvas, .floating-editor canvas",
                        ),
                    ];
                    return (
                        canvases.length >= 2 &&
                        new Set(canvases.map((canvas) => canvas.toDataURL())).size === 1
                    );
                }),
            )
            .toBe(true);
    await matchingPreviews();
    // A label leaves the icon where it was, in the middle of the key: only the
    // top of the key is weighed, so the label's own ink is left out of it. The
    // key is taken as the selected one, since its name follows its title.
    const selected = page.locator(".deck-key.selected");
    const labelled = await inkBounds(selected, 0.62);
    await page.getByLabel("Key title", { exact: true }).fill("");
    await matchingPreviews();
    const bare = await inkBounds(selected, 0.62);
    if (Math.abs(labelled.min - bare.min) > 1 || Math.abs(labelled.max - bare.max) > 1)
        throw new Error("A label moved the icon");
    await page.getByLabel("Key title", { exact: true }).fill("Vent");
    // A big icon gives way to the label instead of running into it: with the
    // label there it is drawn smaller, and stays in the middle of the key.
    await page.getByLabel("Icon size", { exact: true }).fill("200");
    await matchingPreviews();
    const bigLabelled = await inkBounds(selected, 0.75);
    await page.getByLabel("Key title", { exact: true }).fill("");
    await matchingPreviews();
    const bigBare = await inkBounds(selected, 0.75);
    if (bigLabelled.min <= bigBare.min || bigLabelled.max >= bigBare.max)
        throw new Error("A big icon did not give way to the label");
    await page.getByLabel("Key title", { exact: true }).fill("Vent");
    // Back to the usual size, which is no setting at all: the slider has to
    // rest on it, not spring back to the size it had and skip over it.
    const iconSize = page.getByLabel("Icon size", { exact: true });
    await iconSize.fill("95");
    await matchingPreviews();
    await iconSize.fill("100");
    await matchingPreviews();
    await expect(iconSize).toHaveValue("100");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const accent = await vent.locator("canvas").evaluate((canvas) => {
        const pixels = canvas
            .getContext("2d")
            .getImageData(0, canvas.height / 2, canvas.width, canvas.height / 2).data;
        return pixels.some(
            (_, i) =>
                i % 4 === 0 && pixels[i] === 238 && pixels[i + 1] === 187 && pixels[i + 2] === 119,
        );
    });
    if (!accent) throw new Error("Label accent not rendered");
    await expect(vent).toHaveCSS("user-select", "none");
    await page.getByRole("button", { name: "Key 1: Mic off", exact: true }).click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.locator(".artwork-thumbnail").hover();
    await expect(page.getByRole("button", { name: "Remove image", exact: true })).toHaveCSS(
        "opacity",
        "1",
    );
    await page.getByRole("button", { name: "Remove image", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove image", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const removed = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[0],
    );
    if (removed.artwork || !removed.activeAppearance.artwork)
        throw new Error("Image removal affected the wrong toggle state");
    // Widgets: a clock with settings of its own, drawn live instead of an icon.
    await page.getByRole("button", { name: "Key 12: Unassigned", exact: true }).click();
    const pickClock = () =>
        page
            .getByRole("group", { name: "Widgets", exact: true })
            .getByRole("button", { name: "Clock", exact: true })
            .click();
    await page.locator(".picker-entry", { hasText: "Widgets" }).click();
    await pickClock();
    // Back from a widget goes to the widgets, not all the way out.
    await page.getByRole("button", { name: "Back to widgets", exact: true }).click();
    await pickClock();
    await expect(page.getByRole("tab", { name: "Widget", exact: true })).toBeVisible();
    // A widget is always a normal button: its presses are its own.
    await expect(page.getByRole("button", { name: "Toggle", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Analog style", exact: true }).click();
    await page
        .getByRole("group", { name: "Format", exact: true })
        .getByRole("button", { name: "12-hour", exact: true })
        .click();
    await page.getByRole("switch", { name: "Show seconds", exact: true }).click();
    // The date belongs to the digital face only.
    await expect(page.getByRole("switch", { name: "Show date", exact: true })).toHaveCount(0);
    await page.getByLabel("Time zone", { exact: true }).selectOption("Asia/Tokyo");
    await expect(page.locator(".widget-hint")).toContainText("every second");
    await page.screenshot({ path: "output/decky-clock-widget.png" });
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    // A widget draws its own face: no icon or image to choose.
    await expect(page.locator(".icon-options button")).toHaveCount(0);
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const clock = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[11],
    );
    const face = clock.action.widget;
    if (
        clock.behavior !== "normal" ||
        face?.type !== "clock" ||
        face.style !== "analog" ||
        !face.hour12 ||
        !face.seconds ||
        face.timeZone !== "Asia/Tokyo"
    )
        throw new Error(`Clock widget saved wrong: ${JSON.stringify(clock)}`);
    // Seconds on: the deck gets a whole key picture every second.
    const clockKey = page.getByRole("button", { name: "Key 12: Clock widget", exact: true });
    await page.waitForFunction(
        () =>
            (window.__liveFrames ?? []).filter(
                (frame) => frame.pageId === "home" && frame.cell === 11 && frame.bytes === 29028,
            ).length >= 2,
    );
    const tick = await clockKey.locator("canvas").evaluate((canvas) => canvas.toDataURL());
    await expect
        .poll(() => clockKey.locator("canvas").evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(tick);
    // Saved, the key is no longer new: nothing to go back to.
    await expect(page.getByRole("button", { name: "Back to widgets", exact: true })).toHaveCount(0);
    // A countdown whose time is set on the deck, with a swipe.
    await page.getByRole("button", { name: "Key 13: Unassigned", exact: true }).click();
    await page.locator(".picker-entry", { hasText: "Widgets" }).click();
    await page
        .getByRole("group", { name: "Widgets", exact: true })
        .getByRole("button", { name: "Timer", exact: true })
        .click();
    await page
        .getByRole("group", { name: "Mode", exact: true })
        .getByRole("button", { name: "Countdown", exact: true })
        .click();
    await page.getByRole("switch", { name: "Set time on the deck", exact: true }).click();
    await expect(page.locator(".widget-hint")).toContainText("Swipe up or down");
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const wheel = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[12].action.widget,
    );
    if (wheel.type !== "timer" || wheel.mode !== "countdown" || wheel.adjustable !== true)
        throw new Error(`Adjustable countdown saved wrong: ${JSON.stringify(wheel)}`);
    await page.screenshot({ path: "output/decky-countdown-wheel.png" });
    // Its sound is on unless switched off: it rings once it has run out, and
    // stops when a tap sets it back.
    await expect(
        page.getByRole("switch", { name: "Sound when it ends", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() =>
        window.__setWidgetStates({
            "home:12": { running: true, since: Date.now() - 301_000, elapsed: 0 },
        }),
    );
    await page.waitForFunction(() => window.__playing === true);
    if (!(await page.evaluate(() => window.__sound)).includes("kalimba"))
        throw new Error("The countdown rang with the wrong sound");
    await page.evaluate(() => window.__setWidgetStates({}));
    await page.waitForFunction(() => window.__playing === false);
    // A crypto price: its styles drawn side by side, then its coin. Prices are
    // live, in dollars, with no currency to pick.
    await page.getByRole("button", { name: "Key 14: Unassigned", exact: true }).click();
    await page.locator(".picker-entry", { hasText: "Widgets" }).click();
    await page
        .getByRole("group", { name: "Widgets", exact: true })
        .getByRole("button", { name: "Crypto", exact: true })
        .click();
    await expect(
        page.getByRole("group", { name: "Style", exact: true }).locator("canvas"),
    ).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Currency", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Ticker style", exact: true }).click();
    await page.getByLabel("Coin", { exact: true }).selectOption("ethereum");
    // Live, so there is no interval to pick either.
    await expect(page.getByRole("group", { name: "Update every", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "output/decky-crypto-widget.png" });
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    const crypto = await page.evaluate(
        async () => (await window.deck.getConfig()).pages[0].keys[13].action.widget,
    );
    if (
        crypto.type !== "crypto" ||
        crypto.style !== "ticker" ||
        crypto.coin !== "ethereum" ||
        "currency" in crypto ||
        "interval" in crypto
    )
        throw new Error(`Crypto widget saved wrong: ${JSON.stringify(crypto)}`);
    await page.getByRole("button", { name: "Key 4: Go live", exact: true }).click();
    await page.getByRole("button", { name: "Duplicate key", exact: true }).click();
    await page.getByRole("button", { name: "Key 7: Go live", exact: true }).waitFor();
    await page
        .getByRole("button", { name: "Key 7: Go live", exact: true })
        .dragTo(page.getByRole("button", { name: "Key 9: Unassigned", exact: true }));
    await page.getByRole("button", { name: "Key 9: Go live", exact: true }).waitFor();
    await expect(
        page.getByRole("button", { name: "Key 7: Unassigned", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Key 9: Go live", exact: true })
        .dragTo(page.getByRole("button", { name: "Key 5: OpenVPN Connect", exact: true }));
    await page.getByRole("button", { name: "Key 5: Go live", exact: true }).waitFor();
    await expect(
        page.getByRole("button", { name: "Key 9: OpenVPN Connect", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Key title", { exact: true }).fill("Unsaved");
    // An open key editor tells Discord a key is being edited.
    if (!(await page.evaluate(() => window.__presenceEditing)))
        throw new Error("The key editor did not say a key is being edited");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Discard changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page.getByLabel("Key title", { exact: true })).toHaveValue("Unsaved");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sync keys", exact: true })).toBeVisible();
    if (await page.evaluate(() => window.__presenceEditing))
        throw new Error("The closed key editor still says a key is being edited");
    // Profiles: the setups on this PC, beside Pages under the deck. Switching
    // to one shows what is in it first; nothing happens on the click itself.
    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    const profiles = page.getByRole("region", { name: "Profiles", exact: true });
    await expect(profiles.getByText("Default", { exact: true })).toBeVisible();
    await expect(profiles.getByRole("button", { name: "Import", exact: true })).toBeVisible();
    // Any profile can be exported, not only the one in use.
    await expect(
        profiles.getByRole("button", { name: "Export Default", exact: true }),
    ).toBeVisible();
    await profiles.getByRole("button", { name: "Add profile", exact: true }).click();
    await expect(profiles.getByText("New profile", { exact: true })).toBeVisible();
    await profiles.getByRole("button", { name: "Rename New profile", exact: true }).click();
    await page.getByLabel("Name for New profile", { exact: true }).fill("Streaming");
    await page.getByLabel("Name for New profile", { exact: true }).press("Enter");
    await expect(profiles.getByText("Streaming", { exact: true })).toBeVisible();
    // What is in it, before switching to it.
    await profiles.getByRole("button", { name: /^Streaming/ }).click();
    const inside = page.getByRole("region", { name: "Profile contents", exact: true });
    await expect(inside.getByRole("button", { name: /^Switch to Streaming/ })).toBeVisible();
    await inside.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(profiles.getByRole("button", { name: "Add profile", exact: true })).toBeVisible();
    // Hovering is felt: the row lifts, and the bin reddens.
    await profiles.getByRole("button", { name: "Delete Streaming", exact: true }).hover();
    await page.screenshot({ path: "output/decky-profiles.png" });
    // Deleting one takes two presses: the bin arms, and a tick asks to be sure.
    await expect(
        profiles.getByRole("button", { name: "Export Streaming", exact: true }),
    ).toBeVisible();
    const bin = profiles.getByRole("button", { name: "Delete Streaming", exact: true });
    await bin.click();
    // Armed, it says what deleting takes with it.
    await expect(page.getByText(/removes the scripts it brought/)).toBeVisible();
    await expect(profiles.getByText("Streaming", { exact: true })).toBeVisible();
    const sure = profiles.getByRole("button", { name: "Confirm deleting Streaming", exact: true });
    await expect(sure).toBeVisible();
    await sure.click();
    await expect(profiles.getByText("Streaming", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    // Discord: off by default, one switch; on, the card friends see.
    const discord = page.getByRole("region", { name: "Discord", exact: true });
    const onDiscord = discord.getByRole("switch", { name: "Show on Discord", exact: true });
    const friendsSee = discord.getByRole("group", { name: "What friends see", exact: true });
    await expect(onDiscord).toHaveAttribute("aria-checked", "false");
    await expect(friendsSee).toHaveCount(0);
    await onDiscord.click();
    await expect(onDiscord).toHaveAttribute("aria-checked", "true");
    await expect(friendsSee).toContainText("Watching");
    await expect(friendsSee).toContainText("At the deck");
    await expect(friendsSee).toContainText("128 presses today");
    await discord.screenshot({ path: "output/decky-discord-settings.png" });
    await onDiscord.click();
    await expect(friendsSee).toHaveCount(0);
    // Firmware: the bundled release is newer than the deck's, so it is offered,
    // and the title bar counts it.
    await expect(
        page.getByRole("button", { name: "1 update available", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Updates", exact: true })).toBeVisible();
    const versions = page.locator(".firmware-versions");
    await expect(versions).toContainText("App");
    await expect(versions).toContainText("0.2.0");
    // Firmware from before version reporting is called that; no protocol numbers.
    await expect(versions).toContainText("older firmware");
    await expect(versions).not.toContainText("protocol");
    await expect(page.getByText("development build", { exact: false })).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Check GitHub for updates", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Update firmware to 1.4.0", exact: true }).click();
    await expect(page.getByText("Firmware 1.4.0 installed. Decky is restarting.")).toBeVisible();
    if ((await page.evaluate(() => window.__firmwareInstall))?.source !== "bundled")
        throw new Error("Settings did not install the bundled firmware");
    // The deck restarts and comes back running the new firmware: the install's
    // "restarting" message belongs to the old one and must not survive that.
    await page.evaluate(() => {
        const previous = window.deck.status;
        window.deck.status = async () => {
            const result = await previous();
            return result.connected
                ? {
                      ...result,
                      identity: { ...result.identity, protocol: 7, firmwareVersion: "1.4.0" },
                  }
                : result;
        };
        window.deck.firmwareInfo = async () => ({
            appVersion: "0.2.0",
            // A local build names itself after the release it follows.
            installed: { protocol: 7, version: "1.4.0-3-gabc1234-dirty" },
            transport: "usb",
            bundled: { version: "1.4.0", protocol: 7 },
            latest: null,
            repository: "someone/decky",
            update: null,
            appUpdate: null,
        });
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("Firmware 1.4.0 installed. Decky is restarting.")).toHaveCount(0);
    // Nothing to update: no update line and no button, just the versions.
    await expect(page.getByText("up to date", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Update firmware/ })).toHaveCount(0);
    // Shown as the release it follows: no build detail, no protocol.
    await expect(page.locator(".firmware-versions")).toContainText("1.4.0");
    await expect(page.locator(".firmware-versions")).not.toContainText("gabc1234");
    await expect(page.locator(".firmware-versions")).not.toContainText("v1.4.0");
    await expect(page.locator(".firmware-versions")).not.toContainText("protocol");
    await page.getByRole("button", { name: "Find Wi-Fi networks", exact: true }).click();
    await page.getByRole("option", { name: "Home Wi-Fi Strong" }).click();
    await expect(page.getByRole("option", { name: "Office Enterprise" })).toBeDisabled();
    // Under the buttons only errors appear.
    await page.getByLabel("Wi-Fi password", { exact: true }).fill("refused-password");
    await page.getByRole("button", { name: "Connect to Home Wi-Fi", exact: true }).click();
    await expect(page.locator(".wifi-message")).toHaveText("Could not start Wi-Fi connection.");
    await page.getByLabel("Wi-Fi password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Connect to Home Wi-Fi", exact: true }).click();
    // Nothing to forget until the deck has actually joined; the button says it is connecting.
    await expect(page.getByRole("button", { name: "Connecting…", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Forget/ })).toHaveCount(0);
    await expect(page.locator(".wifi-message")).toHaveCount(0);
    await page.evaluate(() => window.__finishJoin());
    // Joining a network is all there is: USB stays first, Wi-Fi takes over only
    // without a cable, so there is no transport switch to show.
    await expect(page.locator(".wifi-connected")).toContainText("Home Wi-Fi");
    await expect(page.getByRole("button", { name: "Use Wi-Fi", exact: true })).toHaveCount(0);
    // The green line says it once; no second "Connected to" under the buttons.
    await expect(page.locator(".wifi-message")).toHaveCount(0);
    // Joined: the network list and password form close; scanning again stays possible.
    await expect(page.getByRole("listbox", { name: "Wi-Fi networks" })).toHaveCount(0);
    await expect(page.getByLabel("Wi-Fi password", { exact: true })).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Find Wi-Fi networks", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Forget Home Wi-Fi", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "output/decky-wifi-settings.png" });
    // Forgetting asks first, then clears the network on the deck.
    await page.getByRole("button", { name: "Forget Home Wi-Fi", exact: true }).click();
    if (await page.evaluate(() => window.__wifiForgotten))
        throw new Error("Wi-Fi was forgotten before the user confirmed");
    await page.locator(".wifi-forget").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/decky-wifi-forget.png" });
    await page.getByRole("button", { name: "Forget", exact: true }).click();
    await expect(page.locator(".wifi-connected")).toHaveCount(0);
    await expect(page.locator(".wifi-message")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forget Home Wi-Fi", exact: true })).toHaveCount(
        0,
    );
    // Scrolled to the bottom, the title and close button stay in view.
    await page.evaluate(() => {
        for (const selector of [".settings-body", ".settings-panel"]) {
            const element = document.querySelector(selector);
            if (element) element.scrollTop = element.scrollHeight;
        }
    });
    await expect(page.getByText("Decky stays in the system tray when closed.")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeInViewport();
    await expect(
        page.getByRole("button", { name: "Close settings", exact: true }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();

    // Nothing to update: no pill.
    await expect(page.locator(".titlebar-updates")).toHaveCount(0);
    // The background check finds a new Decky and new firmware: the pill counts
    // both and opens Settings at the Updates section.
    await page.evaluate(() => {
        const previous = window.deck.firmwareInfo;
        window.deck.firmwareInfo = async () => ({
            ...(await previous()),
            appUpdate: { version: "0.3.0", canInstall: true },
            update: { source: "github", version: "1.5.0", protocol: 7 },
        });
        window.__updatesChanged();
    });
    const pill = page.getByRole("button", { name: "2 updates available", exact: true });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.getByRole("region", { name: "Updates", exact: true })).toBeInViewport();
    await expect(page.getByText("Decky 0.3.0 is available.")).toBeInViewport();
    await expect(
        page.getByRole("button", { name: "Update firmware to 1.5.0", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "output/decky-updates.png" });

    // Decky updates itself on its own screen: download with progress, then install.
    await page.getByRole("button", { name: "Update Decky to 0.3.0", exact: true }).click();
    if ((await page.evaluate(() => window.__appUpdateCalls.install)) !== 1)
        throw new Error("Update Decky did not start the update");
    await page.evaluate(() =>
        window.__appUpdate({
            stage: "downloading",
            version: "0.3.0",
            percent: 42.4,
            transferred: 44_000_000,
            total: 104_000_000,
            bytesPerSecond: 12_900_000,
        }),
    );
    const updating = page.getByRole("dialog", { name: "Updating Decky", exact: true });
    await expect(updating).toContainText("Downloading Decky 0.3.0");
    await expect(updating).toContainText("42% · 42.0 of 99.2 MB · 12.3 MB/s");
    await expect(updating.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    await page.screenshot({ path: "output/decky-app-update.png" });
    await updating.getByRole("button", { name: "Cancel", exact: true }).click();
    if ((await page.evaluate(() => window.__appUpdateCalls.cancel)) !== 1)
        throw new Error("Cancel did not reach the updater");
    await page.evaluate(() => window.__appUpdate({ stage: "cancelled" }));
    await expect(updating).toHaveCount(0);
    // A failed update keeps this version and offers the installer instead.
    await page.evaluate(() =>
        window.__appUpdate({ stage: "failed", message: "GitHub could not be reached." }),
    );
    await expect(updating).toContainText("The update didn't finish");
    await expect(updating).toContainText("GitHub could not be reached.");
    await updating.getByRole("button", { name: "Download installer", exact: true }).click();
    await expect(updating).toContainText("The download opened in your browser.");
    await updating.getByRole("button", { name: "Close", exact: true }).click();
    await expect(updating).toHaveCount(0);
    // Installing needs nothing from the user: Decky restarts by itself.
    await page.evaluate(() => window.__appUpdate({ stage: "installing", version: "0.3.0" }));
    await expect(updating).toContainText("Installing Decky 0.3.0");
    await expect(updating).toContainText("Decky closes and opens again by itself in a moment.");
    await expect(updating.getByRole("button")).toHaveCount(0);
    await page.evaluate(() => window.__appUpdate({ stage: "cancelled" }));

    // A development build cannot replace itself, so it offers the download.
    await page.evaluate(() => {
        const previous = window.deck.firmwareInfo;
        window.deck.firmwareInfo = async () => ({
            ...(await previous()),
            appUpdate: { version: "0.3.0", canInstall: false },
        });
        window.__updatesChanged();
    });
    await page.getByRole("button", { name: "Download Decky 0.3.0", exact: true }).click();
    await expect(page.getByText("The download opened in your browser.")).toBeVisible();
    // Back to nothing to update for the rest of the check.
    await page.evaluate(() => {
        const previous = window.deck.firmwareInfo;
        window.deck.firmwareInfo = async () => ({
            ...(await previous()),
            appUpdate: null,
            update: null,
        });
        window.__updatesChanged();
    });
    await expect(page.locator(".titlebar-updates")).toHaveCount(0);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.setViewportSize({ width: 1080, height: 760 });
    await page.getByRole("button", { name: "Key 4: Go live", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "Save key", exact: true })).toBeInViewport();
    const panel = await page.locator(".floating-editor").boundingBox();
    if (panel.x + panel.width > 1080 || panel.y + panel.height > 760)
        throw new Error("Editor exceeds minimum window size");
    await page.screenshot({ path: "output/decky-dashboard-1080.png" });
    await page.evaluate(() => {
        window.deck.syncPage = async (_id, frames) => {
            window.__hardwareFrames = frames.map((frame) => Array.from(frame));
            return { ok: true, message: "Fixture captured" };
        };
        window.deck.status = async () => ({
            connected: true,
            identity: {
                portPath: "TEST",
                protocol: 4,
                cacheSlots: 8,
                serial: "a4cb8fcdd274",
                cells: 15,
                columns: 5,
                rows: 3,
                keyWidth: 118,
                keyHeight: 123,
                pages: 64,
            },
        });
        window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(() => window.__hardwareFrames?.length === 15);
    if (
        await page.evaluate(
            async () =>
                window.__cachedPageIds.length !== (await window.deck.getConfig()).pages.length,
        )
    )
        throw new Error("Not all pages preloaded");
    await page.evaluate(async () => {
        await window.deck.navigate("obs");
    });
    await page.getByRole("button", { name: "Key 11: Back", exact: true }).waitFor();
    if ((await page.evaluate(() => window.__cacheCalls)) !== 1)
        throw new Error("Page switch repeated warmup");
    await page.evaluate(() => window.__deviceEvent({ kind: "reset", at: Date.now() }));
    await page.waitForFunction(() => window.__cacheCalls === 2);
    await page.evaluate(async () => {
        const config = await window.deck.getConfig();
        config.pages.find((page) => page.id === "home").keys[0].label = "Changed while elsewhere";
        await window.deck.saveConfig(config);
    });
    await page.waitForFunction(() => window.__cacheCalls === 3);
    await page.evaluate(async () => {
        window.__extraSyncs = 0;
        window.deck.syncPage = async () => {
            window.__extraSyncs++;
            return { ok: true, message: "Unexpected sync" };
        };
        for (let i = 0; i < 8; i++) await window.deck.runKey("home", 0);
    });
    await page.waitForTimeout(150);
    if (await page.evaluate(() => window.__cacheCalls !== 3 || window.__extraSyncs !== 0))
        throw new Error("Toggle state triggered image synchronization on v4");
    await writeFile(
        "output/home-page.rgb565",
        Buffer.from((await page.evaluate(() => window.__hardwareFrames)).flat()),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    console.error(
        "UI checks passed: black defaults, sliding/recentering grid, six actions, fourteen widgets, widget search by purpose, apps and their settings, live clock widget, crypto settings, macro reorder, separate toggle artwork, success/failure, dock shortcuts, profiles, pages, program/script selectors, dirty guard, minimum window size.",
    );
} finally {
    await browser.close();
}
