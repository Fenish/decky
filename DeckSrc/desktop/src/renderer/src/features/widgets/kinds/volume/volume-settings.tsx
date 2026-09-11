import type { ReactNode } from "react";
import type { VolumeWidget } from "../../../../../../shared/widgets/volume";
import { StylePicker } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

export function volumeSettings({ widget, look, onChange }: SettingsProps<VolumeWidget>): ReactNode {
    return (
        <StylePicker
            label="Style"
            widget={widget}
            look={look}
            field="style"
            options={[
                { value: "arc", label: "Arc" },
                { value: "bar", label: "Bar" },
            ]}
            onChange={onChange}
        />
    );
}

export function volumeHint(): string {
    return (
        "Swipe up or down on the key to set the PC's volume; it follows your finger. " +
        "Tap to mute or unmute."
    );
}
