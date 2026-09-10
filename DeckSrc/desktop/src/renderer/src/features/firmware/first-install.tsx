import { useState } from "react";
import type { DeviceCheck, UnknownDevice } from "../../../../shared/api";
import { InstallProgress, formatVersion } from "./install-progress";
import { useFirmwareInstall } from "./use-firmware-install";
import "./firmware.css";

type Step = "offer" | "confirm" | "checking" | "found" | "other";

const clean = (error: unknown): string =>
    String(error)
        .replace(/^Error: /, "")
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/**
 * Set up a deck that does not run Decky yet.
 *
 * A USB device that stays silent when asked who it is could be a brand-new
 * CrowPanel - or anything else behind the same USB chip. So it is only offered,
 * never touched: checking it restarts it into the chip's bootloader, which the
 * user agrees to first, and the install button appears only once that check
 * has found an ESP32-S3 with 4 MB of flash.
 */
export function FirstInstall({ device }: { device: UnknownDevice }) {
    const [step, setStep] = useState<Step>("offer");
    const [found, setFound] = useState<DeviceCheck | null>(null);
    const [message, setMessage] = useState("");
    const [version, setVersion] = useState<string | undefined>();
    const { state, install, reset } = useFirmwareInstall();

    const check = async (): Promise<void> => {
        setStep("checking");
        setMessage("");
        try {
            const [result, info] = await Promise.all([
                window.deck.firmwareProbe(device.path),
                window.deck.firmwareInfo(),
            ]);
            setFound(result);
            setVersion(info.bundled?.version);
            setStep(result.crowPanel ? "found" : "other");
        } catch (error) {
            setMessage(clean(error));
            setStep("offer");
        }
    };

    const start = async (): Promise<void> => {
        const info = await window.deck.firmwareInfo();
        if (info.bundled) {
            await install({ source: "bundled", path: device.path });
            return;
        }
        if (info.repository) {
            const latest = await window.deck.firmwareCheck().catch(() => null);
            if (latest?.latest) {
                await install({ source: "github", path: device.path });
                return;
            }
        }
        setMessage(
            "This copy of Decky has no firmware to install. Build the firmware, or connect to the internet.",
        );
    };

    return (
        <section className="first-install" aria-label="Set up a new deck">
            {state.phase !== "idle" ? (
                <InstallProgress
                    state={state}
                    onConfirmPartitionChange={(request) =>
                        void install({ ...request, allowPartitionChange: true })
                    }
                    onDismiss={() => {
                        reset();
                        setStep("offer");
                    }}
                />
            ) : step === "offer" ? (
                <>
                    <p>A device on {device.path} isn&apos;t running Decky.</p>
                    <button className="button" onClick={() => setStep("confirm")}>
                        Check device
                    </button>
                </>
            ) : step === "confirm" ? (
                <>
                    <p>Checking restarts the device for a moment. Nothing is written.</p>
                    <div className="firmware-actions">
                        <button className="button primary" onClick={() => void check()}>
                            Check it
                        </button>
                        <button className="button" onClick={() => setStep("offer")}>
                            Cancel
                        </button>
                    </div>
                </>
            ) : step === "checking" ? (
                <p role="status">Checking {device.path}…</p>
            ) : step === "found" ? (
                <>
                    <p>
                        CrowPanel found{found?.mac ? ` (${found.mac})` : ""}. Install Decky firmware
                        {version ? ` ${formatVersion(version)}` : ""} on it?
                    </p>
                    <button className="button primary" onClick={() => void start()}>
                        Install Decky firmware
                    </button>
                </>
            ) : (
                <>
                    <p>
                        This isn&apos;t a CrowPanel{found ? ` (found ${found.chip})` : ""}. Nothing
                        was changed.
                    </p>
                    <button className="button" onClick={() => setStep("offer")}>
                        OK
                    </button>
                </>
            )}
            {message && <p className="firmware-error">{message}</p>}
        </section>
    );
}
