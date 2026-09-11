import type { ReactNode } from "react";
import type { FirmwareInstallRequest } from "../../../../shared/api";
import { describeProgress, type InstallState } from "./use-firmware-install";
import "./firmware.css";

/** What one phase of an install is shown from. */
interface PhaseProps<S extends InstallState> {
    state: S;
    onConfirmPartitionChange: (request: FirmwareInstallRequest) => void;
    onDismiss: () => void;
}

/** An install that has ended: what it said, and after a failure a way to try again. */
function ended({
    state,
    onDismiss,
}: PhaseProps<Extract<InstallState, { phase: "done" | "failed" }>>): ReactNode {
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

/** What each phase of an install shows, each taking its state as that phase. */
const PHASES: {
    [P in InstallState["phase"]]: (
        props: PhaseProps<Extract<InstallState, { phase: P }>>,
    ) => ReactNode;
} = {
    idle: () => null,
    installing: ({ state }) => {
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
    },
    "confirm-partition": ({ state, onConfirmPartitionChange, onDismiss }) => (
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
    ),
    done: ended,
    failed: ended,
};

/**
 * What an install is doing, and the decisions it can stop for.
 *
 * Renders nothing while idle, so callers can place it unconditionally.
 */
export function InstallProgress({
    state,
    onConfirmPartitionChange,
    onDismiss,
}: PhaseProps<InstallState>) {
    const show = PHASES[state.phase] as (props: PhaseProps<InstallState>) => ReactNode;
    return show({ state, onConfirmPartitionChange, onDismiss });
}
