import type { ReactNode } from "react";
import type { CountdownWidget } from "../../../../../../shared/widgets/countdown";
import type { SettingsProps } from "../widget-view";

export function countdownSettings({ widget, onChange }: SettingsProps<CountdownWidget>): ReactNode {
    return (
        <>
            <label className="field">
                Title
                <input
                    aria-label="Countdown title"
                    maxLength={24}
                    placeholder="Optional"
                    value={widget.title}
                    onChange={(event) => onChange({ ...widget, title: event.target.value })}
                />
            </label>
            <label className="field">
                Date
                <input
                    type="date"
                    aria-label="Countdown date"
                    value={widget.date}
                    onChange={(event) =>
                        event.target.value && onChange({ ...widget, date: event.target.value })
                    }
                />
            </label>
        </>
    );
}
