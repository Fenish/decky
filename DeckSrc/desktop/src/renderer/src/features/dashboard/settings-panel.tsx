import { Download, RefreshCw, Upload, X } from "lucide-react";
import type { DeckConfig } from "../../../../shared/config";
import { WifiSettings } from "./wifi-settings";
import { FirmwareSettings } from "./firmware-settings";
export function SettingsPanel({
    config,
    busy,
    save,
    onImport,
    sync,
    onClose,
    notify,
    firmwareKey,
}: {
    config: DeckConfig;
    busy: boolean;
    save: (config: DeckConfig) => Promise<void>;
    onImport: (config: DeckConfig) => void;
    sync: () => Promise<void>;
    onClose: () => void;
    notify: (message: string) => void;
    firmwareKey: string;
}) {
    return (
        <section className="utility-panel settings-panel" aria-label="Settings">
            <header>
                <h2>Settings</h2>
                <button aria-label="Close settings" onClick={onClose}>
                    <X size={22} />
                </button>
            </header>
            {/* Only the body scrolls, so the title and close button stay in place. */}
            <div className="settings-body">
                <div className="preference-row">
                    <label id="motion-label">Reduce motion</label>
                    <button
                        role="switch"
                        aria-labelledby="motion-label"
                        aria-checked={config.reducedMotion}
                        className={`toggle ${config.reducedMotion ? "on" : ""}`}
                        onClick={() =>
                            void save({ ...config, reducedMotion: !config.reducedMotion }).catch(
                                (e) => notify(String(e)),
                            )
                        }
                    >
                        <span />
                    </button>
                </div>
                <div className="settings-actions">
                    <button
                        onClick={() =>
                            void window.deck
                                .exportConfig()
                                .then((reply) => notify(reply.message))
                                .catch((e) => notify(String(e)))
                        }
                    >
                        <Download size={19} />
                        Export profile
                    </button>
                    <button
                        onClick={() =>
                            void window.deck
                                .importConfig()
                                .then((next) => {
                                    if (next) onImport(next);
                                })
                                .catch((e) => notify(String(e)))
                        }
                    >
                        <Upload size={19} />
                        Import profile
                    </button>
                    <button disabled={busy} onClick={() => void sync()}>
                        <RefreshCw size={19} className={busy ? "spin" : ""} />
                        {busy ? "Syncing…" : "Sync keys"}
                    </button>
                </div>
                <WifiSettings />
                {/* Keyed to the deck's firmware: an install's "restarting" message and the
                versions it showed belong to the firmware it replaced. When the deck
                drops out and returns running the new one, the section starts over. */}
                <FirmwareSettings key={firmwareKey} />
                <p className="settings-footnote">Decky stays in the system tray when closed.</p>
            </div>
        </section>
    );
}
