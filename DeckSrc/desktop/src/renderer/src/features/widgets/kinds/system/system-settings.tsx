import type { ReactNode } from "react";
import type { SystemWidget } from "../../../../../../shared/widgets/system";
import { Segmented } from "../../form-controls";
import { StylePicker } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

export function systemSettings({ widget, look, onChange }: SettingsProps<SystemWidget>): ReactNode {
    return (
        <>
            <StylePicker
                label="Style"
                widget={widget}
                look={look}
                field="style"
                options={[
                    { value: "graph", label: "Graph" },
                    { value: "rings", label: "Rings" },
                ]}
                onChange={onChange}
            />
            <Segmented
                label="Show"
                value={widget.show}
                options={[
                    { value: "cpu", label: "CPU" },
                    { value: "ram", label: "Memory" },
                    { value: "both", label: "Both" },
                ]}
                onChange={(show) => onChange({ ...widget, show })}
            />
            <Segmented
                label="Update every"
                value={String(widget.interval)}
                options={[
                    { value: "1", label: "1 s" },
                    { value: "2", label: "2 s" },
                    { value: "5", label: "5 s" },
                ]}
                onChange={(interval) => onChange({ ...widget, interval: Number(interval) })}
            />
        </>
    );
}

export function systemHint(): string {
    return "Tap to open Task Manager.";
}
