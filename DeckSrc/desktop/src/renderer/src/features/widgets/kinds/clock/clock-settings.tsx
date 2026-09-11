import type { ReactNode } from "react";
import type { ClockStyle, ClockWidget } from "../../../../../../shared/widgets/clock";
import { Segmented, Switch } from "../../form-controls";
import { StyleChoice } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

export function clockSettings({
    widget,
    look,
    onChange,
    zones,
}: SettingsProps<ClockWidget>): ReactNode {
    const styles: { value: ClockStyle; label: string }[] = [
        { value: "digital", label: "Digital" },
        { value: "analog", label: "Analog" },
        { value: "minimal", label: "Minimal" },
    ];
    return (
        <>
            <div className="field">
                Style
                <div className="widget-styles" role="group" aria-label="Clock style">
                    {styles.map((style) => (
                        <StyleChoice
                            key={style.value}
                            widget={{ ...widget, style: style.value }}
                            look={look}
                            active={widget.style === style.value}
                            label={style.label}
                            onPick={() => onChange({ ...widget, style: style.value })}
                        />
                    ))}
                </div>
            </div>
            <Segmented
                label="Format"
                value={widget.hour12 ? "12" : "24"}
                options={[
                    { value: "24", label: "24-hour" },
                    { value: "12", label: "12-hour" },
                ]}
                onChange={(value) => onChange({ ...widget, hour12: value === "12" })}
            />
            <Switch
                label="Show seconds"
                on={widget.seconds}
                onChange={(seconds) => onChange({ ...widget, seconds })}
            />
            {widget.style === "digital" && (
                <Switch
                    label="Show date"
                    on={widget.date}
                    onChange={(date) => onChange({ ...widget, date })}
                />
            )}
            <label className="field">
                Time zone
                <select
                    aria-label="Time zone"
                    value={widget.timeZone}
                    onChange={(event) => onChange({ ...widget, timeZone: event.target.value })}
                >
                    <option value="">This PC&apos;s time</option>
                    {zones.map((zone) => (
                        <option key={zone} value={zone}>
                            {zone.replaceAll("_", " ").replaceAll("/", " / ")}
                        </option>
                    ))}
                </select>
            </label>
        </>
    );
}

export function clockHint(widget: ClockWidget): string {
    return widget.seconds
        ? "Seconds redraw the key every second, which keeps a USB connection a little busier."
        : "";
}
