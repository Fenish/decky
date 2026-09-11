/*---------------------------------------------------------------
 * Decky's window and its tray icon.
 *
 * Closing the window only hides it: Decky stays in the tray so the deck's
 * keys keep working, and quits from the tray's menu.
 *--------------------------------------------------------------*/

import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import type { WindowState } from "../../shared/api";
import type { Lifecycle } from "./lifecycle";

// Every size from 16 to 256 px, so the tray and taskbar stay sharp at any display scale.
const appIcon = join(__dirname, "../../resources/icon.ico");

export class MainWindow {
    browserWindow: BrowserWindow | null = null;
    private tray: Tray | null = null;

    constructor(private readonly lifecycle: Lifecycle) {}

    /** Make the window, hidden until its page is ready, and the tray icon. */
    create(): void {
        Menu.setApplicationMenu(null);
        const window = new BrowserWindow({
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
        this.browserWindow = window;
        const publishWindowState = (): void => {
            if (this.browserWindow && !this.browserWindow.isDestroyed())
                this.browserWindow.webContents.send("window:state", {
                    maximized: this.browserWindow.isMaximized(),
                });
        };
        window.on("maximize", publishWindowState);
        window.on("unmaximize", publishWindowState);
        const tray = new Tray(nativeImage.createFromPath(appIcon));
        this.tray = tray;
        tray.setToolTip("Decky");
        const showWindow = (): void => {
            this.browserWindow?.show();
            this.browserWindow?.restore();
            this.browserWindow?.focus();
        };
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: "Open Decky", click: showWindow },
                { type: "separator" },
                {
                    label: "Quit Decky",
                    click: () => {
                        this.lifecycle.quitting = true;
                        app.quit();
                    },
                },
            ]),
        );
        tray.on("double-click", showWindow);
        window.on("close", (event) => {
            if (!this.lifecycle.quitting) {
                event.preventDefault();
                this.browserWindow?.hide();
            }
        });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) => event.preventDefault());
        window.webContents.session.setPermissionRequestHandler(
            (_webContents, _permission, callback) => callback(false),
        );
    }

    /** Load the app into the window, which shows once it is ready. */
    async load(): Promise<void> {
        const window = this.browserWindow!;
        window.once("ready-to-show", () => this.browserWindow?.show());
        const url = process.env["ELECTRON_RENDERER_URL"];
        if (url) await window.loadURL(url);
        else await window.loadFile(join(__dirname, "../renderer/index.html"));
    }

    /** Decky started again: this one's window comes forward instead. */
    restore(): void {
        this.browserWindow?.restore();
        this.browserWindow?.focus();
    }

    /** Tell the window something. */
    send(channel: string, ...args: unknown[]): void {
        this.browserWindow?.webContents.send(channel, ...args);
    }

    /**
     * The same, but never to a window already destroyed: for what timers and
     * background work report, which can outlive it.
     */
    sendIfOpen(channel: string, ...args: unknown[]): void {
        if (this.browserWindow && !this.browserWindow.isDestroyed())
            this.browserWindow.webContents.send(channel, ...args);
    }

    state(): WindowState {
        return { maximized: this.browserWindow?.isMaximized() ?? false };
    }

    /** The title bar's minimize, maximize/restore and close. */
    control(action: unknown): WindowState {
        if (action !== "minimize" && action !== "maximize" && action !== "close")
            throw new Error("Invalid window action.");
        if (action === "minimize") this.browserWindow?.minimize();
        else if (action === "maximize") {
            if (this.browserWindow?.isMaximized()) this.browserWindow.unmaximize();
            else this.browserWindow?.maximize();
        } else this.browserWindow?.close();
        return { maximized: this.browserWindow?.isMaximized() ?? false };
    }

    destroyTray(): void {
        this.tray?.destroy();
    }
}
