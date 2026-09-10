import { useEffect, useState } from "react";
import type { AppUpdateProgress } from "../../../../shared/api";
import Logo from "../../assets/logo-white.svg?react";
import "../firmware/firmware.css";
import "./updates.css";

const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(1);

/**
 * The whole window while Decky updates itself: downloading, then installing,
 * after which the installer closes Decky and opens the new version. Shown
 * whenever the main process reports an update stage; a cancel hides it again.
 */
export function AppUpdateScreen() {
    // A cancel is never shown: it hides the screen.
    const [progress, setProgress] = useState<Exclude<
        AppUpdateProgress,
        { stage: "cancelled" }
    > | null>(null);
    const [message, setMessage] = useState("");
    useEffect(
        () =>
            window.deck.onAppUpdateProgress((next) => {
                setMessage("");
                setProgress(next.stage === "cancelled" ? null : next);
            }),
        [],
    );
    if (!progress) return null;

    const download = (): void => {
        void window.deck
            .appUpdateDownload()
            .then((reply) => setMessage(reply.message))
            .catch((error) => setMessage(String(error)));
    };
    const percent = progress.stage === "downloading" ? Math.round(progress.percent) : 0;

    return (
        <div
            className="app-update-screen"
            role="dialog"
            aria-modal="true"
            aria-label="Updating Decky"
        >
            <div className="app-update-card">
                <Logo className="app-update-logo" aria-hidden="true" />
                {progress.stage === "failed" ? (
                    <>
                        <h2>The update didn&apos;t finish</h2>
                        <p className="app-update-detail">{progress.message}</p>
                        <p className="app-update-detail">
                            Decky keeps running the version you have. You can also download the
                            installer and run it yourself.
                        </p>
                        <div className="firmware-actions">
                            <button className="button primary" onClick={download}>
                                Download installer
                            </button>
                            <button className="button" onClick={() => setProgress(null)}>
                                Close
                            </button>
                        </div>
                        {message && (
                            <p className="app-update-detail" role="status">
                                {message}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <h2>
                            {progress.stage === "checking"
                                ? "Getting the update ready"
                                : progress.stage === "downloading"
                                  ? `Downloading Decky ${progress.version}`
                                  : `Installing Decky ${progress.version}`}
                        </h2>
                        <div
                            className={`firmware-bar ${progress.stage === "downloading" ? "" : "indeterminate"}`}
                            role="progressbar"
                            aria-label="Update progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress.stage === "downloading" ? percent : undefined}
                        >
                            <span
                                style={
                                    progress.stage === "downloading"
                                        ? { width: `${percent}%` }
                                        : undefined
                                }
                            />
                        </div>
                        <p className="app-update-detail" aria-live="polite">
                            {progress.stage === "checking"
                                ? "Asking GitHub for the newest release…"
                                : progress.stage === "downloading"
                                  ? progress.total
                                      ? // The speed shows at a glance whether a slow update is the network.
                                        `${percent}% · ${megabytes(progress.transferred)} of ${megabytes(progress.total)} MB` +
                                        (progress.bytesPerSecond
                                            ? ` · ${megabytes(progress.bytesPerSecond)} MB/s`
                                            : "")
                                      : "Starting the download…"
                                  : "Decky closes and opens again by itself in a moment."}
                        </p>
                        {progress.stage === "downloading" && (
                            <div className="firmware-actions">
                                <button
                                    className="button"
                                    onClick={() => void window.deck.appUpdateCancel()}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
