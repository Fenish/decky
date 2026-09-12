/*---------------------------------------------------------------
 * Updates to Decky and to the deck's firmware.
 *
 * GitHub is asked for the newest release shortly after starting and then
 * every 15 minutes. Firmware is installed over USB, from the copy bundled
 * with the app or from that release. Decky updates itself through
 * app-update.ts, and the deck shows how far it has got.
 *--------------------------------------------------------------*/

import { app, shell } from "electron";
import { join } from "node:path";
import packageJson from "../../../package.json";
import { flashFirmware, PartitionChangeError, probeDevice } from "../device/flasher";
import {
    bundledManifest,
    latestReleases,
    loadPackage,
    repositoryOf,
    type AppRelease,
    type FirmwarePackage,
    type FirmwareRelease,
} from "../device/firmware-source";
import { formatVersion, isNewerFirmware } from "../../shared/firmware";
import { transportOf } from "../../shared/transport";
import type {
    AppUpdateProgress,
    DeviceCheck,
    FirmwareInfo,
    FirmwareInstallRequest,
    FirmwareInstallResult,
    FirmwareOffer,
    FirmwareProgress,
    Reply,
} from "../../shared/api";
import type { Lifecycle } from "../app/lifecycle";
import type { MainWindow } from "../app/main-window";
import type { DeckSession } from "../deck/session";
import type { PageSync } from "../pages/page-sync";
import { canInstallUpdates, installAppUpdate } from "./app-update";

const UPDATE_CHECK_MS = 15 * 60_000;
// Shipped inside the app: packaged under resources/ by electron-builder, and in
// development the folder PlatformIO's bundle step writes to.
const bundledFirmwareFolder = (): string => join(app.getAppPath(), "resources", "firmware");
// package.json's standard "repository" field; absent until the project is published.
const firmwareRepository = (): string | null =>
    repositoryOf((packageJson as { repository?: unknown }).repository);

export class Updates {
    // The newest GitHub firmware release, once the user has asked for it.
    private latestFirmware: FirmwareRelease | null = null;
    // The newest Decky on GitHub. Both are refreshed in the background.
    private latestApp: AppRelease | null = null;
    private updateCheck: Promise<void> | null = null;
    // Silent USB devices the user checked and that turned out to be a CrowPanel.
    // A first install is only allowed on one of these.
    private readonly confirmedCrowPanels = new Set<string>();
    // The deck shows the update too (UPDATING): the download's percent, and
    // while Decky closes for the installer it keeps saying so instead of
    // Disconnected, until the new version connects. Firmware without the command
    // answers ERR, which changes nothing.
    private deckPercent = -1;
    private installing: "deck" | "app" | null = null;

    constructor(
        private readonly session: DeckSession,
        private readonly pageSync: PageSync,
        private readonly window: MainWindow,
        private readonly lifecycle: Lifecycle,
    ) {}

    /** What is being updated now: the deck's firmware, or Decky itself. */
    get updating(): "deck" | "app" | null {
        return this.installing;
    }

    async firmwareInfo(): Promise<FirmwareInfo> {
        const bundled = await bundledManifest(bundledFirmwareFolder());
        const { status } = this.session;
        const installed = status.connected
            ? { protocol: status.identity.protocol, version: status.identity.firmwareVersion }
            : null;
        const offers: FirmwareOffer[] = [];
        if (bundled)
            offers.push({
                source: "bundled",
                version: bundled.version,
                protocol: bundled.protocol,
            });
        if (this.latestFirmware)
            offers.push({
                source: "github",
                version: this.latestFirmware.version,
                protocol: this.latestFirmware.protocol,
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
                (a, b) =>
                    b.protocol - a.protocol || (isNewerFirmware(a.version, b.version) ? -1 : 1),
            )[0];
        return {
            appVersion: app.getVersion(),
            installed,
            transport: status.connected ? transportOf(status.identity) : null,
            bundled: bundled ? { version: bundled.version, protocol: bundled.protocol } : null,
            latest: this.latestFirmware
                ? { version: this.latestFirmware.version, protocol: this.latestFirmware.protocol }
                : null,
            repository: firmwareRepository(),
            update: best ?? null,
            appUpdate:
                this.latestApp && isNewerFirmware(this.latestApp.version, app.getVersion())
                    ? { version: this.latestApp.version, canInstall: canInstallUpdates() }
                    : null,
        };
    }

    /**
     * Ask GitHub for the newest release, for Decky and the deck's firmware alike,
     * and tell the window. One check at a time: a manual check during the
     * background one waits for it rather than asking twice.
     */
    checkForUpdates(): Promise<void> {
        this.updateCheck ??= (async () => {
            const repository = firmwareRepository();
            if (!repository) throw new Error("No GitHub repository is set for releases.");
            // Passing what is already known: an unchanged release is not downloaded again.
            const found = await latestReleases(repository, this.latestFirmware);
            this.latestFirmware = found.firmware;
            this.latestApp = found.app;
            this.window.sendIfOpen("updates:changed");
        })().finally(() => {
            this.updateCheck = null;
        });
        return this.updateCheck;
    }

    // Look for newer releases shortly after starting, then every 15 minutes -
    // also while Decky sits in the tray. Offline just means trying again later.
    checkInBackground(): void {
        const backgroundCheck = (): void => void this.checkForUpdates().catch(() => {});
        setTimeout(backgroundCheck, 5_000).unref();
        setInterval(backgroundCheck, UPDATE_CHECK_MS).unref();
    }

    /** Restart a silent USB device into its bootloader, and read what chip it is. */
    probe(path: unknown): Promise<DeviceCheck> {
        const { session } = this;
        return session.serial(async () => {
            const waiting = !session.status.connected ? (session.status.unknownDevices ?? []) : [];
            if (typeof path !== "string" || !waiting.some((device) => device.path === path))
                throw new Error("That device is not waiting to be checked.");
            await session.link.close();
            const probe = await probeDevice(path);
            if (probe.crowPanel) this.confirmedCrowPanels.add(path);
            else this.confirmedCrowPanels.delete(path);
            return { crowPanel: probe.crowPanel, chip: probe.chip, mac: probe.mac };
        });
    }

    installFirmware(request: unknown): Promise<FirmwareInstallResult> {
        const { session } = this;
        return session.serial(async (): Promise<FirmwareInstallResult> => {
            const { source, path, allowPartitionChange } = (request ??
                {}) as Partial<FirmwareInstallRequest>;
            if (source !== "bundled" && source !== "github")
                throw new Error("Invalid firmware source.");
            let target: string;
            let firstInstall = false;
            if (path !== undefined) {
                if (typeof path !== "string" || !this.confirmedCrowPanels.has(path))
                    throw new Error("Check the device before installing firmware on it.");
                target = path;
                firstInstall = true;
            } else {
                if (!session.status.connected) throw new Error("Connect Decky first.");
                if (transportOf(session.status.identity) !== "usb")
                    return { ok: false, message: "Connect the USB cable to update the firmware." };
                target = session.status.identity.portPath;
            }
            const progress = (update: FirmwareProgress): void => {
                this.window.send("firmware:progress", update);
            };
            let firmware: FirmwarePackage;
            if (source === "github") {
                if (!this.latestFirmware) throw new Error("Check GitHub for firmware first.");
                // Downloaded and checked when GitHub was last asked.
                firmware = this.latestFirmware.firmware;
            } else {
                firmware = await loadPackage(bundledFirmwareFolder());
            }
            // From here the flasher owns the port. This runs inside the serial queue,
            // so heartbeats wait for it instead of reopening the port, and status
            // checks are answered at once: offline (DeckSession.flashing).
            await session.link.close();
            session.status = { connected: false };
            session.flashing = true;
            this.installing = "deck";
            this.pageSync.resetDeviceCache();
            try {
                await flashFirmware(
                    target,
                    firmware.manifest,
                    firmware.images,
                    firstInstall || allowPartitionChange === true,
                    progress,
                );
                // A deck just written takes a few seconds to start: it is offered as
                // a device to set up again only if it never answers.
                await session.awaitDeck(target);
            } catch (error) {
                if (error instanceof PartitionChangeError)
                    return { ok: false, partitionChange: true, message: error.message };
                return {
                    ok: false,
                    message: `Firmware was not installed: ${error instanceof Error ? error.message : String(error)}`,
                };
            } finally {
                session.flashing = false;
                this.installing = null;
                this.confirmedCrowPanels.delete(target);
                session.forgetSilentPort(target);
            }
            return {
                ok: true,
                message: `Firmware ${formatVersion(firmware.manifest.version)} installed. Decky is restarting.`,
            };
        });
    }

    /** Update Decky itself, showing each stage in the window and on the deck. */
    installApp(): Promise<void> {
        this.deckPercent = -1;
        this.installing = "app";
        return installAppUpdate(
            (progress: AppUpdateProgress) => {
                this.window.sendIfOpen("app-update:progress", progress);
                (this.deckStages[progress.stage] as (progress: AppUpdateProgress) => void)(
                    progress,
                );
            },
            // Quitting for the installer is a real quit, not a hide to the tray.
            () => {
                this.lifecycle.quitting = true;
                this.lifecycle.restartingForUpdate = true;
            },
        ).catch((error: unknown) => {
            this.installing = null;
            throw error;
        });
    }

    /** Open the newest installer's download in the browser. */
    async openDownload(): Promise<Reply> {
        // Only a URL this process read from GitHub itself is ever opened.
        const target = this.latestApp?.installer ?? this.latestApp?.page;
        if (!target?.startsWith("https://github.com/"))
            return {
                ok: false,
                message: "No Decky release is known yet. Check GitHub for updates.",
            };
        await shell.openExternal(target);
        return { ok: true, message: "The download opened in your browser." };
    }

    /** What the deck is told at each stage of Decky's update. */
    private readonly deckStages: {
        [S in AppUpdateProgress["stage"]]: (
            progress: Extract<AppUpdateProgress, { stage: S }>,
        ) => void;
    } = {
        checking: () => {
            this.deckPercent = -1;
            this.tellDeck("UPDATING 0");
        },
        downloading: (progress) => {
            const percent = Math.floor(progress.percent);
            if (percent !== this.deckPercent) {
                this.deckPercent = percent;
                this.tellDeck(`UPDATING ${percent}`);
            }
        },
        installing: () => this.tellDeck("UPDATING 100"),
        failed: () => {
            this.installing = null;
            this.tellDeck("UPDATING END");
        },
        cancelled: () => {
            this.installing = null;
            this.tellDeck("UPDATING END");
        },
    };

    private tellDeck(line: string): void {
        if (!this.session.status.connected) return;
        void this.session.serial(() => this.session.link.command(line, 1500)).catch(() => {});
    }
}
