import type { FirmwareInstallRequest } from "../../../../shared/api";
import { describeProgress, type InstallState } from "./use-firmware-install";
import "./firmware.css";

/** "1.4.0" as "v1.4.0"; anything else, such as a local "dev" build, exactly as reported. */
export function formatVersion(version: string | undefined): string {
    if (!version) return "unknown";
    return /^\d/.test(version) ? `v${version}` : version;
}

/**
 * What an install is doing, and the decisions it can stop for.
 *
 * Renders nothing while idle, so callers can place it unconditionally.
 */
export function InstallProgress({
    state,
    onConfirmPartitionChange,
    onDismiss,
}: {
    state: InstallState;
    onConfirmPartitionChange: (request: FirmwareInstallRequest) => void;
    onDismiss: () => void;
}) {
    if (state.phase === "idle") return null;
    if (state.phase === "installing") {
        const { text, fraction } = describeProgress(state.progress);
        return (
            <div className="firmware-progress" role="status" aria-live="polite">
                <p>{text}</p>
                <div
                    className={`firmware-bar ${fraction === null ? "indeterminate" : ""}`}
                    role="progressbar"
                    aria-label="Firmware install progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
                >
                    <span
                        style={
                            fraction === null
                                ? undefined
                                : { width: `${Math.round(fraction * 100)}%` }
                        }
                    />
                </div>
                <p className="firmware-hint">
                    Keep the USB cable connected until the deck restarts.
                </p>
            </div>
        );
    }
    if (state.phase === "confirm-partition")
        return (
            <div className="firmware-progress" role="alert">
                <p>{state.message} Continue anyway?</p>
                <div className="firmware-actions">
                    <button
                        className="button primary"
                        onClick={() => onConfirmPartitionChange(state.request)}
                    >
                        Update anyway
                    </button>
                    <button className="button" onClick={onDismiss}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    return (
        <div className="firmware-progress" role={state.phase === "failed" ? "alert" : "status"}>
            <p className={state.phase === "failed" ? "firmware-error" : ""}>{state.message}</p>
            {state.phase === "failed" && (
                <div className="firmware-actions">
                    <button className="button" onClick={onDismiss}>
                        Try again
                    </button>
                </div>
            )}
        </div>
    );
}
