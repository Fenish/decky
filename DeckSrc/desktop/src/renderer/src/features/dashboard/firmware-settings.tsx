import { useCallback, useEffect, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import type { FirmwareInfo } from "../../../../shared/api";
import { InstallProgress, formatVersion } from "../firmware/install-progress";
import { useFirmwareInstall } from "../firmware/use-firmware-install";

const clean = (error: unknown): string =>
    String(error)
        .replace(/^Error: /, "")
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/** Settings section: what firmware the deck runs, and updating it. */
export function FirmwareSettings() {
    const [info, setInfo] = useState<FirmwareInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [note, setNote] = useState("");
    const { state, install, reset } = useFirmwareInstall();

    useEffect(() => {
        let live = true;
        void window.deck
            .firmwareInfo()
            .then((next) => {
                if (live) setInfo(next);
            })
            .catch((error) => live && setNote(clean(error)));
        return () => {
            live = false;
        };
    }, []);

    const check = useCallback(async (): Promise<void> => {
        setChecking(true);
        setNote("");
        try {
            const next = await window.deck.firmwareCheck();
            setInfo(next);
            if (!next.latest) setNote("No firmware releases are published on GitHub yet.");
            else if (!next.update)
                setNote(
                    `The newest release is ${formatVersion(next.latest.version)}. You are up to date.`,
                );
        } catch (error) {
            setNote(clean(error));
        } finally {
            setChecking(false);
        }
    }, []);

    const installed = info?.installed;
    const update = info?.update ?? null;
    const idle = state.phase === "idle";

    return (
        <section className="wifi-settings firmware-settings" aria-label="Firmware">
            <div className="wifi-heading">
                <h3>
                    <Cpu size={18} /> Firmware
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
                                    ? `${formatVersion(installed.version)} · protocol ${installed.protocol}`
                                    : `protocol ${installed.protocol}`
                                : "not connected"}
                        </dd>
                    </div>
                </dl>
            )}
            {!info ? (
                <p className="wifi-help">Checking firmware…</p>
            ) : update ? (
                <p className="wifi-help">
                    Firmware {formatVersion(update.version)} (protocol {update.protocol}) is
                    available {update.source === "github" ? "on GitHub" : "with this app"}.
                </p>
            ) : (
                <p className="wifi-help">The deck&apos;s firmware is up to date.</p>
            )}
            {update && info?.transport === "wifi" && (
                <p className="wifi-help">Connect the USB cable to update the firmware.</p>
            )}
            {idle && update && info?.transport === "usb" && (
                <button
                    className="button primary wifi-wide"
                    onClick={() => void install({ source: update.source })}
                >
                    Update to {formatVersion(update.version)}
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
