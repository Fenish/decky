import type { ReactNode } from "react";
import type { CounterWidget } from "../../../../../../shared/widgets/counter";
import { NumberField } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

export function counterSettings({ widget, onChange }: SettingsProps<CounterWidget>): ReactNode {
    return (
        <div className="widget-row">
            <NumberField
                label="Start at"
                value={widget.start}
                min={-999_999}
                max={999_999}
                onChange={(start) => onChange({ ...widget, start })}
            />
            <NumberField
                label="Step"
                value={widget.step}
                min={1}
                max={1000}
                onChange={(step) => onChange({ ...widget, step })}
            />
        </div>
    );
}

export function counterHint(): string {
    return "Tap to count. Hold to go back to the start.";
}
