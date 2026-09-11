import { ChevronRight } from "lucide-react";
import type { KeyConfig } from "../../../../shared/config";
import { stateNames } from "../editor/actions";
import { widgetLook } from "../widgets/draw-widget";
import type { WidgetState } from "../../../../shared/widgets";
import { ArtworkPreview } from "../artwork/artwork-preview";
import { WidgetPreview } from "../widgets/widget-preview";
/**
 * What a deck key shows on the dashboard: its widget or artwork, or Back in a
 * folder, with a corner mark for a key that opens a page and a toggle's state
 * (ON/OFF, or its app control's own words: MUTED).
 */
export function KeyFace({
    value,
    back,
    toggled,
    widgetState,
    disabled,
}: {
    value: KeyConfig | undefined;
    back: boolean;
    toggled: boolean;
    widgetState: WidgetState | undefined;
    /** The app it controls is out of reach. */
    disabled: boolean;
}) {
    return (
        <>
            {value?.action.kind === "widget" ? (
                <WidgetPreview
                    widget={value.action.widget}
                    look={widgetLook(value)}
                    state={widgetState}
                />
            ) : value ? (
                <ArtworkPreview value={value} disabled={disabled} />
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
                <span className={`key-state ${toggled ? "on" : ""}`}>
                    {stateNames(value.action)[toggled ? "on" : "off"]}
                </span>
            )}
        </>
    );
}
