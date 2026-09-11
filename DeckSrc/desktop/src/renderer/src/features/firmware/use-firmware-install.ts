import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmwareInstallRequest, FirmwareProgress } from "../../../../shared/api";

export type InstallState =
    | { phase: "idle" }
    | { phase: "installing"; progress: FirmwareProgress | null }
    | { phase: "confirm-partition"; request: FirmwareInstallRequest; message: string }
    | { phase: "done"; message: string }
    | { phase: "failed"; message: string };

/** Where an install has got to: a line to show, and how far along the bar is. */
interface ProgressLine {
    text: string;
    fraction: number | null;
}

/** The line for each stage of an install, each taking its progress as that stage. */
const STAGES: {
    [S in FirmwareProgress["stage"]]: (
        progress: Extract<FirmwareProgress, { stage: S }>,
    ) => ProgressLine;
} = {
    downloading: () => ({ text: "Downloading from GitHub…", fraction: null }),
    connecting: () => ({ text: "Starting the deck's bootloader…", fraction: null }),
    writing: (progress) => ({
        text: `Writing and verifying part ${progress.part} of ${progress.parts}`,
        fraction: progress.total ? progress.written / progress.total : null,
    }),
    restarting: () => ({ text: "Restarting the deck…", fraction: 1 }),
};

/** A short, human line for where an install has got to. */
export function describeProgress(progress: FirmwareProgress | null): ProgressLine {
    if (!progress) return { text: "Preparing…", fraction: null };
    const describe = STAGES[progress.stage] as (progress: FirmwareProgress) => ProgressLine;
    return describe(progress);
}

const clean = (error: unknown): string =>
    String(error)
        .replace(/^Error: /, "")
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/**
 * Run one firmware install and follow its progress.
 *
 * A partition-table change is not an error the user should just see; it
 * pauses in "confirm-partition" so the caller can ask before anything that
 * would erase stored artwork is written.
 */
export function useFirmwareInstall(): {
    state: InstallState;
    install: (request: FirmwareInstallRequest) => Promise<boolean>;
    reset: () => void;
} {
    const [state, setState] = useState<InstallState>({ phase: "idle" });
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        const stop = window.deck.onFirmwareProgress((progress) => {
            if (mounted.current) setState({ phase: "installing", progress });
        });
        return () => {
            mounted.current = false;
            stop();
        };
    }, []);

    const install = useCallback(async (request: FirmwareInstallRequest): Promise<boolean> => {
        setState({ phase: "installing", progress: null });
        try {
            const result = await window.deck.firmwareInstall(request);
            if (!mounted.current) return result.ok;
            if (result.partitionChange)
                setState({ phase: "confirm-partition", request, message: result.message });
            else
                setState(
                    result.ok
                        ? { phase: "done", message: result.message }
                        : { phase: "failed", message: result.message },
                );
            return result.ok;
        } catch (error) {
            if (mounted.current) setState({ phase: "failed", message: clean(error) });
            return false;
        }
    }, []);

    const reset = useCallback(() => setState({ phase: "idle" }), []);
    return { state, install, reset };
}
