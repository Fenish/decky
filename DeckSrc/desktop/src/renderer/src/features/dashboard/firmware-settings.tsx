import { useCallback, useEffect, useState } from "react";
import { CircleArrowUp, RefreshCw } from "lucide-react";
import type { FirmwareInfo } from "../../../../shared/api";
import { formatVersion } from "../../../../shared/firmware";
import { InstallProgress } from "../firmware/install-progress";
import { useFirmwareInstall } from "../firmware/use-firmware-install";

const clean = (error: unknown): string =>
    String(error)
        .replace(/^Error: /, "")
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/** Settings section: the versions running, and updating Decky and the deck's firmware. */
export function FirmwareSettings() {
    const [info, setInfo] = useState<FirmwareInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [note, setNote] = useState("");
    const { state, install, reset } = useFirmwareInstall();

    useEffect(() => {
        let live = true;
        const load = (): void => {
            void window.deck
                .firmwareInfo()
                .then((next) => {
                    if (live) setInfo(next);
                })
                .catch((error) => live && setNote(clean(error)));
        };
        load();
        // The background check can find a release while Settings is open.
        const off = window.deck.onUpdatesChanged(load);
        return () => {
            live = false;
            off();
        };
    }, []);

    const check = useCallback(async (): Promise<void> => {
        setChecking(true);
        setNote("");
        try {
            const next = await window.deck.firmwareCheck();
            setInfo(next);
            if (!next.latest && !next.appUpdate)
                setNote("No releases are published on GitHub yet.");
            else if (!next.update && !next.appUpdate)
                setNote("Decky and the deck's firmware are up to date.");
        } catch (error) {
            setNote(clean(error));
        } finally {
            setChecking(false);
        }
    }, []);

    const openDownload = (): void => {
        void window.deck
            .appUpdateDownload()
            .then((reply) => setNote(reply.message))
            .catch((error) => setNote(clean(error)));
    };

    const installed = info?.installed;
    const update = info?.update ?? null;
    const appUpdate = info?.appUpdate ?? null;
    const idle = state.phase === "idle";

    return (
        <section className="wifi-settings firmware-settings" aria-label="Updates">
            <div className="wifi-heading">
                <h3>
                    <CircleArrowUp size={18} /> Updates
                </h3>
            </div>
            {info && (
                <dl className="firmware-versions">
                    <div>
                        <dt>App</dt>
                        <dd>{formatVersion(info.appVersion)}</dd>
                    </div>
                    <div>
                        <dt>Firmware</dt>
                        <dd>
                            {installed
                                ? installed.version
                                    ? formatVersion(installed.version)
                                    : "older firmware"
                                : "not connected"}
                        </dd>
                    </div>
                </dl>
            )}
            {appUpdate && (
                <>
                    <p className="wifi-help">
                        Decky {formatVersion(appUpdate.version)} is available.
                    </p>
                    {appUpdate.canInstall ? (
                        <button
                            className="button primary wifi-wide"
                            onClick={() => void window.deck.appUpdateInstall()}
                        >
                            Update Decky to {formatVersion(appUpdate.version)}
                        </button>
                    ) : (
                        <button className="button primary wifi-wide" onClick={openDownload}>
                            Download Decky {formatVersion(appUpdate.version)}
                        </button>
                    )}
                </>
            )}
            {!info && <p className="wifi-help">Checking for updates…</p>}
            {update && (
                <p className="wifi-help">
                    Firmware {formatVersion(update.version)} is available{" "}
                    {update.source === "github" ? "on GitHub" : "with this app"}.
                </p>
            )}
            {update && info?.transport === "wifi" && (
                <p className="wifi-help">Connect the USB cable to update the firmware.</p>
            )}
            {idle && update && info?.transport === "usb" && (
                <button
                    className="button primary wifi-wide"
                    onClick={() => void install({ source: update.source })}
                >
                    Update firmware to {formatVersion(update.version)}
                </button>
            )}
            {idle && info?.repository && (
                <button
                    className="button wifi-wide"
                    disabled={checking}
                    onClick={() => void check()}
                >
                    <RefreshCw size={16} className={checking ? "spin" : ""} />
                    {checking ? "Checking…" : "Check GitHub for updates"}
                </button>
            )}
            <InstallProgress
                state={state}
                onConfirmPartitionChange={(request) =>
                    void install({ ...request, allowPartitionChange: true })
                }
                onDismiss={reset}
            />
            {note && (
                <p className="wifi-message" role="status">
                    {note}
                </p>
            )}
        </section>
    );
}
