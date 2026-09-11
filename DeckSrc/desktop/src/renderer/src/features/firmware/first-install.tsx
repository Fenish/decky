import { useState } from "react";
import { CircleAlert, Download, LoaderCircle, Usb } from "lucide-react";
import type { DeviceCheck, UnknownDevice } from "../../../../shared/api";
import { InstallProgress } from "./install-progress";
import { useFirmwareInstall } from "./use-firmware-install";
import "./firmware.css";
import { errorText } from "../../app/error-text";

type Step = "offer" | "checking" | "other";

/**
 * Set up a deck that does not run Decky yet.
 *
 * A USB device that stays silent when asked who it is could be a brand-new
 * CrowPanel - or anything else behind the same USB chip, and telling them apart
 * means restarting it into the chip's bootloader. So nothing happens until the
 * user asks: the one button checks the device, and installs only once the check
 * has found an ESP32-S3 with 4 MB of flash. Anything else is left as it was.
 */
export function FirstInstall({ device }: { device: UnknownDevice }) {
    const [step, setStep] = useState<Step>("offer");
    const [found, setFound] = useState<DeviceCheck | null>(null);
    const [message, setMessage] = useState("");
    const { state, install, reset } = useFirmwareInstall();

    const setUp = async (): Promise<void> => {
        setStep("checking");
        setMessage("");
        try {
            const [result, info] = await Promise.all([
                window.deck.firmwareProbe(device.path),
                window.deck.firmwareInfo(),
            ]);
            setFound(result);
            if (!result.crowPanel) {
                setStep("other");
                return;
            }
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
        } catch (error) {
            setMessage(errorText(error));
        }
        setStep("offer");
    };

    const [title, detail] =
        step === "checking"
            ? ["Checking the device…", "It restarts for a moment."]
            : step === "other"
              ? [
                    "This isn't a CrowPanel",
                    `${found ? `Found ${found.chip}. ` : ""}Nothing was changed.`,
                ]
              : [
                    "Install Decky on this device?",
                    `The device on ${device.path} isn't running Decky yet.`,
                ];

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
            ) : (
                <>
                    <div className="first-install-main">
                        <span className={`first-install-icon ${step}`} aria-hidden="true">
                            {step === "checking" ? (
                                <LoaderCircle />
                            ) : step === "other" ? (
                                <CircleAlert />
                            ) : (
                                <Usb />
                            )}
                        </span>
                        <div
                            className="first-install-text"
                            role={step === "checking" ? "status" : undefined}
                        >
                            <p className="first-install-title">{title}</p>
                            <p className="first-install-detail">{detail}</p>
                        </div>
                        {step === "offer" && (
                            <button className="button primary" onClick={() => void setUp()}>
                                <Download aria-hidden="true" />
                                Install Decky
                            </button>
                        )}
                        {step === "other" && (
                            <button className="button" onClick={() => setStep("offer")}>
                                OK
                            </button>
                        )}
                    </div>
                    {step !== "other" && (
                        <p className="first-install-note">
                            Decky checks that it&apos;s a CrowPanel first and leaves anything else
                            untouched.
                        </p>
                    )}
                </>
            )}
            {message && <p className="firmware-error">{message}</p>}
        </section>
    );
}
