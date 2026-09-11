import { ChevronRight } from "lucide-react";
import type { KeyConfig } from "../../../../shared/config";
import type { WidgetState } from "../../../../shared/widgets";
import { ArtworkPreview } from "../artwork/artwork-preview";
import { WidgetPreview } from "../widgets/widget-preview";
/**
 * What a deck key shows on the dashboard: its widget or artwork, or Back in a
 * folder, with a corner mark for a key that opens a page and ON/OFF for a toggle.
 */
export function KeyFace({
    value,
    back,
    toggled,
    widgetState,
}: {
    value: KeyConfig | undefined;
    back: boolean;
    toggled: boolean;
    widgetState: WidgetState | undefined;
}) {
    return (
        <>
            {value?.action.kind === "widget" ? (
                <WidgetPreview
                    widget={value.action.widget}
                    look={{
                        background: value.background ?? "#000000",
                        color: value.color,
                        label: value.label,
                    }}
                    state={widgetState}
                />
            ) : value ? (
                <ArtworkPreview value={value} />
            ) : back ? (
                <ArtworkPreview
                    value={{
                        label: "Back",
                        icon: "back",
                        color: "#eee8da",
                    }}
                />
            ) : null}
            {value?.action.kind === "page" && <ChevronRight size={13} className="folder-corner" />}
            {value?.behavior === "toggle" && (
                <span className={`key-state ${toggled ? "on" : ""}`}>{toggled ? "ON" : "OFF"}</span>
            )}
        </>
    );
}
