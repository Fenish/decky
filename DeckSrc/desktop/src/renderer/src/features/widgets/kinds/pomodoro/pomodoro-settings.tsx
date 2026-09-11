import type { ReactNode } from "react";
import type { PomodoroWidget } from "../../../../../../shared/widgets/pomodoro";
import { NumberField } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

export function pomodoroSettings({ widget, onChange }: SettingsProps<PomodoroWidget>): ReactNode {
    return (
        <div className="widget-row">
            <NumberField
                label="Focus minutes"
                value={widget.focus}
                min={1}
                max={180}
                onChange={(focus) => onChange({ ...widget, focus })}
            />
            <NumberField
                label="Break minutes"
                value={widget.rest}
                min={1}
                max={180}
                onChange={(rest) => onChange({ ...widget, rest })}
            />
        </div>
    );
}

export function pomodoroHint(): string {
    return "Tap to start or pause. Hold to skip to the next focus or break.";
}
