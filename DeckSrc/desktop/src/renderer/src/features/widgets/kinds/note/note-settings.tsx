import type { ReactNode } from "react";
import type { NoteSize, NoteWidget } from "../../../../../../shared/widgets/note";
import { Segmented } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

export function noteSettings({ widget, onChange }: SettingsProps<NoteWidget>): ReactNode {
    const sizes: { value: NoteSize; label: string }[] = [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
    ];
    return (
        <>
            <label className="field">
                Text
                <textarea
                    aria-label="Note text"
                    maxLength={120}
                    rows={3}
                    value={widget.text}
                    onChange={(event) => onChange({ ...widget, text: event.target.value })}
                />
            </label>
            {!widget.text.trim() && <p className="firmware-error">Write something to show.</p>}
            <Segmented
                label="Size"
                value={widget.size}
                options={sizes}
                onChange={(size) => onChange({ ...widget, size })}
            />
        </>
    );
}
