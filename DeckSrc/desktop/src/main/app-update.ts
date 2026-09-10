/*---------------------------------------------------------------
 * Decky updating itself.
 *
 * electron-updater reads latest.yml from the newest GitHub release (the release
 * workflow uploads it with the installer), downloads that installer, checks its
 * SHA-512, and runs it silently; the installer restarts Decky on the new
 * version. The window shows each stage, so nobody clicks through a setup.
 *
 * The download is differential: each release also carries the installer's
 * blockmap, and every installer leaves a copy of itself in the updater's cache,
 * so only the blocks that differ from the installed version are fetched. When
 * anything for that is missing, electron-updater downloads the whole installer.
 *
 * Only an installed Decky can do this: a development build has no installer to
 * replace, and offers the download in the browser instead.
 *--------------------------------------------------------------*/

import { app } from "electron";
import { autoUpdater, CancellationToken, type ProgressInfo } from "electron-updater";
import type { AppUpdateProgress } from "../shared/api";

let download: CancellationToken | null = null;
let cancelled = false;

/** Whether this build can replace itself: an installed copy on Windows. */
export const canInstallUpdates = (): boolean => app.isPackaged && process.platform === "win32";

/**
 * Download the newest Decky and install it, reporting every stage.
 *
 * Never throws: a failure or a cancel is reported as a stage, which is how the
 * update screen learns about it. `beforeRestart` runs just before Decky quits
 * for the installer - it has to lift the close-to-tray behaviour.
 */
export async function installAppUpdate(
    report: (progress: AppUpdateProgress) => void,
    beforeRestart: () => void,
): Promise<void> {
    if (download) return;
    if (!canInstallUpdates()) {
        report({
            stage: "failed",
            message: "This development build can't update itself. Download the installer instead.",
        });
        return;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;
    autoUpdater.disableDifferentialDownload = false;
    // Releases carry a regular installer, not the web installer's package.
    autoUpdater.disableWebInstaller = true;
    const token = new CancellationToken();
    download = token;
    cancelled = false;
    let version = "";
    const onProgress = (info: ProgressInfo): void =>
        report({
            stage: "downloading",
            version,
            percent: info.percent,
            transferred: info.transferred,
            total: info.total,
            bytesPerSecond: info.bytesPerSecond,
        });
    try {
        report({ stage: "checking" });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) {
            report({ stage: "failed", message: "Decky is already up to date." });
            return;
        }
        version = result.updateInfo.version;
        report({
            stage: "downloading",
            version,
            percent: 0,
            transferred: 0,
            total: 0,
            bytesPerSecond: 0,
        });
        autoUpdater.on("download-progress", onProgress);
        await autoUpdater.downloadUpdate(token);
    } catch (error) {
        report(cancelled ? { stage: "cancelled" } : { stage: "failed", message: describe(error) });
        return;
    } finally {
        autoUpdater.off("download-progress", onProgress);
        download = null;
    }
    report({ stage: "installing", version });
    beforeRestart();
    // A moment for the window to say Decky is restarting before it disappears.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
}

/** Stop a download in progress; the update reports itself cancelled. */
export function cancelAppUpdate(): void {
    if (!download) return;
    cancelled = true;
    download.cancel();
}

/** One readable line from electron-updater's errors, which can carry whole HTTP responses. */
function describe(error: unknown): string {
    const text = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.trim();
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/.test(text))
        return "GitHub could not be reached. Check the internet connection and try again.";
    if (/latest\.yml/.test(text))
        return "The newest release has no update information. Download the installer instead.";
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}
