import type { ReactNode } from "react";
import type { LevelWidget } from "../../../../../../shared/widgets/level";
import { StylePicker } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

/** A level's style: the arc or the bar, each drawn as it looks. */
export function levelSettings<W extends LevelWidget>({
    widget,
    look,
    onChange,
}: SettingsProps<W>): ReactNode {
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
