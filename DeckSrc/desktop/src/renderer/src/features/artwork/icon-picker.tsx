import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ICON_NAMES, KeyIcon, iconLabel, iconName } from "../../components/key-icon";
const DEFAULT_ICONS = [
    "Keyboard",
    "AppWindow",
    "Globe",
    "Folder",
    "Layers",
    "CodeXml",
    "Mic",
    "MicOff",
    "Video",
    "VideoOff",
    "Camera",
    "Monitor",
    "Play",
    "Pause",
    "Volume2",
    "VolumeX",
    "Headphones",
    "HeadphoneOff",
    "Music2",
    "Radio",
    "Power",
    "Settings",
    "House",
    "ArrowLeft",
    "Zap",
];
export function IconPicker({
    value,
    onChange,
}: {
    value: string;
    onChange: (name: string) => void;
}) {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
        const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        return words.length
            ? ICON_NAMES.filter((name) =>
                  words.every((word) =>
                      `${name} ${iconLabel(name)}`.toLocaleLowerCase().includes(word),
                  ),
              )
            : DEFAULT_ICONS;
    }, [query]);
    return (
        <div className="icon-picker">
            <label className="icon-search">
                <Search size={15} />
                <input
                    aria-label="Search Lucide icons"
                    placeholder="Search icons…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                {query.trim() && <span>{matches.length}</span>}
            </label>
            <div className="icon-options">
                {matches.map((name) => (
                    <button
                        type="button"
                        key={name}
                        title={iconLabel(name)}
                        aria-label={`Use ${iconLabel(name)} icon`}
                        aria-pressed={iconName(value) === name}
                        className={iconName(value) === name ? "selected" : ""}
                        onClick={() => onChange(name)}
                    >
                        <KeyIcon name={name} size={21} />
                    </button>
                ))}
            </div>
            {matches.length === 0 && <p className="empty-search">No matching icons</p>}
        </div>
    );
}
