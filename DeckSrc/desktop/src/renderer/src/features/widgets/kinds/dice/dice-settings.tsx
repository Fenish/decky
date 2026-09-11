import type { ReactNode } from "react";
import { listOptions } from "../../../../../../shared/widgets/dice";
import type { DiceWidget } from "../../../../../../shared/widgets/dice";
import { Segmented } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

export function diceSettings({ widget, onChange }: SettingsProps<DiceWidget>): ReactNode {
    const options = listOptions(widget.options);
    return (
        <>
            <Segmented
                label="Roll"
                value={widget.mode}
                options={[
                    { value: "die", label: "Dice" },
                    { value: "coin", label: "Coin" },
                    { value: "yesno", label: "Yes / No" },
                    { value: "list", label: "List" },
                ]}
                onChange={(mode) => onChange({ ...widget, mode })}
            />
            {widget.mode === "list" && (
                <label className="field">
                    Choices
                    <input
                        aria-label="Choices"
                        maxLength={120}
                        placeholder="Pizza, Burger, Sushi"
                        value={widget.options}
                        onChange={(event) => onChange({ ...widget, options: event.target.value })}
                    />
                </label>
            )}
            {widget.mode === "list" && options.length < 2 && (
                <p className="firmware-error">Give at least two choices, with commas between.</p>
            )}
        </>
    );
}

export function diceHint(widget: DiceWidget): string {
    return widget.mode === "list"
        ? "Up to 8 choices of 14 characters. Tap to roll."
        : "Tap to roll.";
}
