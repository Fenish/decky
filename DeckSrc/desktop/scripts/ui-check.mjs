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
        };
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
                },
            }),
            getConfig: async () => config,
            getKeyStates: async () => states,
            onKeyStates: (fn) => listen(stateListeners, fn),
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
                config = { ...config, activePageId: id };
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
    await expect(page.locator(".action-options button")).toHaveCount(6);
    await page.screenshot({ path: "output/decky-action-picker.png" });
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
        .setInputFiles("src/renderer/src/assets/disconnected-obsidian-smooth.png");
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
    const inkBounds = async (locator) =>
        locator.locator("canvas").evaluate((canvas) => {
            const pixels = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
            const rows = [];
            for (let y = 0; y < canvas.height; y++)
                for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    if (pixels[i] > 150 && pixels[i + 1] > 120) {
                        rows.push(y);
                        break;
                    }
                }
            return { min: Math.min(...rows), max: Math.max(...rows), height: canvas.height };
        });
    const bounds = await inkBounds(unlabelled);
    if (Math.abs((bounds.min + bounds.max) / 2 - bounds.height / 2) > 2)
        throw new Error("Labelless icon not centered");
    const pixel = await page
        .locator(".editor-preview canvas")
        .evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(4, 4, 1, 1).data));
    if (pixel[0] !== 48 || pixel[1] !== 64 || pixel[2] !== 80)
        throw new Error("Rendered background differs from selected color");
    await page.screenshot({ path: "output/decky-labelless-key.png" });
    await expect(page.locator(".icon-options button")).toHaveCount(25);
    await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
    await page.getByLabel("Search Lucide icons", { exact: true }).fill("air vent");
    await page.getByRole("button", { name: "Use Air Vent icon", exact: true }).click();
    await page.getByLabel("Search Lucide icons", { exact: true }).fill("");
    await expect(page.locator(".icon-options button")).toHaveCount(25);
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
    const spaced = await inkBounds(vent);
    await page.getByRole("slider", { name: "Icon/text spacing", exact: true }).press("Home");
    await matchingPreviews();
    const tight = await inkBounds(vent);
    if (tight.min <= spaced.min || tight.max >= spaced.max)
        throw new Error("Spacing did not move both icon and text inward");
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
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Discard changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page.getByLabel("Key title", { exact: true })).toHaveValue("Unsaved");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByRole("button", { name: "Export profile", exact: true })).toBeVisible();
    // Firmware: the bundled release is newer than the deck's, so it is offered.
    await expect(page.getByRole("region", { name: "Firmware", exact: true })).toBeVisible();
    const versions = page.locator(".firmware-versions");
    await expect(versions).toContainText("App");
    await expect(versions).toContainText("v0.2.0");
    // Firmware from before version reporting shows its protocol, not a made-up name.
    await expect(versions).toContainText("protocol 6");
    await expect(page.getByText("development build", { exact: false })).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Check GitHub for updates", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Update to v1.4.0", exact: true }).click();
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
            installed: { protocol: 7, version: "1.4.0" },
            transport: "usb",
            bundled: { version: "1.4.0", protocol: 7 },
            latest: null,
            repository: "someone/decky",
            update: null,
        });
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("Firmware 1.4.0 installed. Decky is restarting.")).toHaveCount(0);
    await expect(page.getByText("The deck's firmware is up to date.")).toBeVisible();
    await expect(page.locator(".firmware-versions")).toContainText("v1.4.0 · protocol 7");
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
        "UI checks passed: black defaults, sliding/recentering grid, six actions, macro reorder, separate toggle artwork, success/failure, dock shortcuts, pages, program/script selectors, dirty guard, minimum window size.",
    );
} finally {
    await browser.close();
}
