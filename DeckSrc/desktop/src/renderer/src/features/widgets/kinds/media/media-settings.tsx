import type { ReactNode } from "react";
import type { MediaWidget } from "../../../../../../shared/widgets/media";
import { StylePicker } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

export function mediaSettings({ widget, look, onChange }: SettingsProps<MediaWidget>): ReactNode {
    return (
        <StylePicker
            label="Style"
            widget={widget}
            look={look}
            field="style"
            options={[
                { value: "cover", label: "Cover" },
                { value: "card", label: "Card" },
            ]}
            onChange={onChange}
        />
    );
}

export function mediaHint(): string {
    return (
        "What is playing in any app Windows knows of: Spotify, a browser, a game. " +
        "Tap to play or pause; hold for the next track."
    );
}
