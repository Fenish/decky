import type { ReactNode } from "react";
import { validPingHost } from "../../../../../../shared/widgets/ping";
import type { PingWidget } from "../../../../../../shared/widgets/ping";
import type { SettingsProps } from "../widget-view";

export function pingSettings({ widget, onChange }: SettingsProps<PingWidget>): ReactNode {
    const valid = validPingHost(widget.host);
    return (
        <>
            <label className="field">
                Host
                <input
                    aria-label="Ping host"
                    placeholder="google.com or 192.168.1.1"
                    maxLength={253}
                    value={widget.host}
                    onChange={(event) => onChange({ ...widget, host: event.target.value.trim() })}
                />
            </label>
            {!valid && (
                <p className="firmware-error">
                    Use a name like google.com or an address like 192.168.1.1.
                </p>
            )}
            <label className="field">
                Ping every
                <select
                    aria-label="Ping interval"
                    value={widget.interval}
                    onChange={(event) =>
                        onChange({ ...widget, interval: Number(event.target.value) })
                    }
                >
                    {[5, 10, 30, 60].map((seconds) => (
                        <option key={seconds} value={seconds}>
                            {seconds < 60 ? `${seconds} seconds` : "1 minute"}
                        </option>
                    ))}
                </select>
            </label>
        </>
    );
}

export function pingHint(): string {
    return (
        "How long the host takes to answer. Green under 100 ms, amber under 250 ms, " +
        "red when slower or there is no reply. Tap to ping now."
    );
}
