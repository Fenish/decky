import type { ReactNode } from "react";
import { ImagePlus, RotateCcw, X } from "lucide-react";
import { ICON_SIZES } from "../../../../shared/config";
import type { KeyAppearance } from "../../../../shared/config";
import { IconPicker } from "./icon-picker";
import { ArtworkPreview } from "./artwork-preview";
import { importArtwork } from "./artwork";
export function AppearanceEditor({
    value,
    change,
    onError,
    showLabel = true,
    widget = false,
    widgetIcon = false,
    widgetOptions,
}: {
    value: KeyAppearance;
    change: (value: KeyAppearance) => void;
    onError: (message: string) => void;
    showLabel?: boolean;
    /** A widget draws itself: only its colours apply, not an image. */
    widget?: boolean;
    /** A widget that draws the key's icon (a voice channel with no one in): its icon and size too. */
    widgetIcon?: boolean;
    /** A widget's own looks (a voice channel's layout), above the colours. */
    widgetOptions?: ReactNode;
}) {
    // The icon shows - no image in its place - on a key, or a widget that draws it.
    const iconShown = (!widget || widgetIcon) && !value.artwork;
    return (
        <>
            {showLabel && (
                <label className="field">
                    State title
                    <input
                        placeholder="No label"
                        maxLength={40}
                        value={value.label}
                        onChange={(e) => change({ ...value, label: e.target.value })}
                    />
                </label>
            )}
            {!widget && (
                <>
                    <div className="art-preview-wrap">
                        <div className="artwork-thumbnail">
                            <ArtworkPreview value={value} />
                            {value.artwork && (
                                <button
                                    className="remove-artwork"
                                    type="button"
                                    aria-label="Remove image"
                                    title="Remove image"
                                    onClick={() => {
                                        const { artwork: _artwork, ...rest } = value;
                                        change(rest);
                                    }}
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                    <label className="upload-button">
                        <ImagePlus size={16} /> Upload image
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                    void importArtwork(file)
                                        .then((artwork) => change({ ...value, artwork }))
                                        .catch((error) => onError(String(error)));
                                e.target.value = "";
                            }}
                        />
                    </label>
                    {value.artwork && (
                        <div className="adjustments">
                            {(
                                [
                                    { key: "zoom", label: "Zoom", min: 0.1, max: 4, step: 0.05 },
                                    {
                                        key: "x",
                                        label: "Horizontal",
                                        min: -100,
                                        max: 100,
                                        step: 1,
                                    },
                                    {
                                        key: "y",
                                        label: "Vertical",
                                        min: -100,
                                        max: 100,
                                        step: 1,
                                    },
                                    {
                                        key: "rotation",
                                        label: "Rotation",
                                        min: -180,
                                        max: 180,
                                        step: 1,
                                    },
                                    {
                                        key: "brightness",
                                        label: "Brightness",
                                        min: 0.2,
                                        max: 2,
                                        step: 0.05,
                                    },
                                ] as const
                            ).map(({ key, label, min, max, step }) => (
                                <label key={key} className="slider-field">
                                    <span>
                                        {label}
                                        <span className="slider-value">
                                            {key === "zoom"
                                                ? `${Math.round(value.artwork![key] * 100)}%`
                                                : Math.round(value.artwork![key] * 100) / 100}
                                            {key === "rotation" ? "°" : ""}
                                        </span>
                                    </span>
                                    <input
                                        type="range"
                                        aria-label={label}
                                        min={min}
                                        max={max}
                                        step={step}
                                        value={value.artwork![key]}
                                        onChange={(e) =>
                                            change({
                                                ...value,
                                                artwork: {
                                                    ...value.artwork!,
                                                    [key]: Number(e.target.value),
                                                },
                                            })
                                        }
                                    />
                                </label>
                            ))}
                            <div className="row">
                                <button
                                    className="text-button"
                                    onClick={() =>
                                        change({
                                            ...value,
                                            artwork: {
                                                ...value.artwork!,
                                                zoom: 1,
                                                x: 0,
                                                y: 0,
                                                rotation: 0,
                                                brightness: 1,
                                            },
                                        })
                                    }
                                >
                                    <RotateCcw size={13} /> Reset
                                </button>
                            </div>
                        </div>
                    )}
                    {value.label.trim() && !value.artwork && (
                        <label className="slider-field spacing-field">
                            <span>
                                Icon/text spacing
                                <span className="slider-value">{value.labelGap ?? 8} px</span>
                            </span>
                            <input
                                type="range"
                                aria-label="Icon/text spacing"
                                min={0}
                                max={32}
                                step={1}
                                value={value.labelGap ?? 8}
                                onChange={(event) =>
                                    change({ ...value, labelGap: Number(event.target.value) })
                                }
                            />
                        </label>
                    )}
                </>
            )}
            {iconShown && (
                <label className="slider-field">
                    <span>
                        Icon size
                        <span className="slider-value">{value.iconSize ?? ICON_SIZES.usual}%</span>
                    </span>
                    <input
                        type="range"
                        aria-label="Icon size"
                        min={ICON_SIZES.min}
                        max={ICON_SIZES.max}
                        step={5}
                        value={value.iconSize ?? ICON_SIZES.usual}
                        onChange={(event) => {
                            const size = Number(event.target.value);
                            // The usual size is no setting at all.
                            const { iconSize: _size, ...rest } = value;
                            change(size === ICON_SIZES.usual ? rest : { ...value, iconSize: size });
                        }}
                    />
                </label>
            )}
            {widgetOptions && <div className="widget-settings widget-looks">{widgetOptions}</div>}
            <label className="field">
                Background
                <div className="background-color-control">
                    <input
                        type="color"
                        aria-label="Button background"
                        value={value.background ?? "#000000"}
                        onChange={(event) => change({ ...value, background: event.target.value })}
                    />
                    <span>{value.background ?? "#000000"}</span>
                    <button
                        type="button"
                        onClick={() => change({ ...value, background: "#000000" })}
                        title="Reset background to black"
                    >
                        Reset
                    </button>
                </div>
            </label>
            <label className="field">
                Accent color
                <div className="color-options">
                    {["#e8dbc4", "#ffffff", "#ff9d81", "#c3dfaa", "#ceb5eb", "#9dcac6"].map(
                        (color) => (
                            <button
                                key={color}
                                aria-label={`Use ${color}`}
                                className={value.color === color ? "selected" : ""}
                                style={{ background: color }}
                                onClick={() => change({ ...value, color })}
                            />
                        ),
                    )}
                    <input
                        type="color"
                        aria-label="Custom accent color"
                        value={value.color}
                        onChange={(e) => change({ ...value, color: e.target.value })}
                    />
                </div>
            </label>
            {(!widget || widgetIcon) && (
                <div className="field">
                    Icon
                    <IconPicker
                        value={value.icon}
                        onChange={(icon) => change({ ...value, icon })}
                    />
                </div>
            )}
        </>
    );
}
