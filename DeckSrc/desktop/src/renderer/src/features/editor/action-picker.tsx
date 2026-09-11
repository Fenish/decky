import { useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, Search, Volume2 } from "lucide-react";
import type { Action } from "../../../../shared/config";
import { WIDGET_CHOICES } from "../../../../shared/widgets/registry";
import type { WidgetType } from "../../../../shared/widgets";
import { KeyIcon } from "../../components/key-icon";
import { ACTION_KINDS } from "./actions";
import "../widgets/widgets.css";
/** The actions to pick from, in the order the picker lists them. */
export const ACTION_CHOICES: {
    kind: Exclude<Action["kind"], "widget">;
    label: string;
    icon: string;
}[] = (["hotkey", "program", "page", "macro", "website", "script"] as const).map((kind) => ({
    kind,
    label: ACTION_KINDS[kind].label,
    icon: ACTION_KINDS[kind].icon,
}));
/** The picker's two panels: actions, with widgets one step in. */
export type PickerPanel = "actions" | "widgets";
function WidgetOptions({
    types,
    onWidget,
}: {
    types: WidgetType[];
    onWidget: (type: WidgetType) => void;
}) {
    return (
        <div className="action-options" role="group" aria-label="Widgets">
            {WIDGET_CHOICES.filter((item) => types.includes(item.type)).map((item) => (
                <button key={item.type} onClick={() => onWidget(item.type)}>
                    <KeyIcon name={item.icon} size={24} />
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
}
export function ActionPicker({
    panel,
    onPanel,
    onSelect,
    onWidget,
}: {
    panel: PickerPanel;
    onPanel: (panel: PickerPanel) => void;
    onSelect: (kind: Exclude<Action["kind"], "widget">) => void;
    onWidget: (type: WidgetType) => void;
}) {
    const [query, setQuery] = useState("");
    if (panel === "widgets")
        return (
            <div className="action-picker">
                <div className="picker-heading">
                    <button
                        className="picker-back"
                        aria-label="Back to actions"
                        onClick={() => onPanel("actions")}
                    >
                        <ChevronLeft size={18} />
                        <span>Back</span>
                    </button>
                    <h3>Widgets</h3>
                </div>
                <WidgetOptions
                    types={WIDGET_CHOICES.map((item) => item.type)}
                    onWidget={onWidget}
                />
            </div>
        );
    const matches = (label: string): boolean => label.toLowerCase().includes(query.toLowerCase());
    const choices = ACTION_CHOICES.filter((item) => matches(item.label));
    // Searching finds widgets too, by name or what they are for ("music"),
    // without opening their panel.
    const widgets = query
        ? WIDGET_CHOICES.filter((item) => matches(item.label) || matches(item.words))
        : [];
    const entry = !query || matches("widgets");
    return (
        <div className="action-picker">
            <label className="action-search">
                <Search size={18} />
                <input
                    aria-label="Find an action"
                    placeholder="Find an action or widget"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>
            {choices.length > 0 && (
                <div className="action-options">
                    {choices.map((item) => (
                        <button key={item.kind} onClick={() => onSelect(item.kind)}>
                            <KeyIcon name={item.icon} size={24} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
            {entry && (
                <button className="widgets-entry" onClick={() => onPanel("widgets")}>
                    <LayoutGrid size={24} />
                    <span>
                        Widgets
                        <small>Clock, now playing, volume and more</small>
                    </span>
                    <ChevronRight size={18} />
                </button>
            )}
            {widgets.length > 0 && (
                <>
                    <p className="action-group-title">Widgets</p>
                    <WidgetOptions types={widgets.map((item) => item.type)} onWidget={onWidget} />
                </>
            )}
            {choices.length === 0 && widgets.length === 0 && !entry && (
                <p className="empty-search">No matching actions</p>
            )}
            {!query && (
                <button className="soundpad-option" disabled>
                    <Volume2 size={22} />
                    <span>Soundpad</span>
                    <small>Soon</small>
                </button>
            )}
        </div>
    );
}
