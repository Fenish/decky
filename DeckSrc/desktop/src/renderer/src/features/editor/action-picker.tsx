import { useState } from "react";
import { Search, Volume2 } from "lucide-react";
import type { Action } from "../../../../shared/config";
import { KeyIcon } from "../../components/key-icon";
export const ACTION_CHOICES: { kind: Action["kind"]; label: string; icon: string }[] = [
    { kind: "hotkey", label: "Hotkey", icon: "keyboard" },
    { kind: "program", label: "Program", icon: "program" },
    { kind: "page", label: "Page", icon: "page" },
    { kind: "macro", label: "Macro", icon: "macro" },
    { kind: "website", label: "Website", icon: "website" },
    { kind: "script", label: "Script", icon: "script" },
];
export function ActionPicker({ onSelect }: { onSelect: (kind: Action["kind"]) => void }) {
    const [query, setQuery] = useState("");
    const choices = ACTION_CHOICES.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()),
    );
    return (
        <div className="action-picker">
            <label className="action-search">
                <Search size={18} />
                <input
                    aria-label="Find an action"
                    placeholder="Find an action"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>
            <div className="action-options">
                {choices.map((item) => (
                    <button key={item.kind} onClick={() => onSelect(item.kind)}>
                        <KeyIcon name={item.icon} size={24} />
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>
            {choices.length === 0 && <p className="empty-search">No matching actions</p>}
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
