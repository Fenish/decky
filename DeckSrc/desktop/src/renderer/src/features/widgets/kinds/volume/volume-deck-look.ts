import { encodeLivePatch } from "../../../../../../shared/live-patch";
import { encodeWheelSpec } from "../../../../../../shared/wheel-spec";
import type { WidgetState } from "../../../../../../shared/widgets";
import type { VolumeWidget } from "../../../../../../shared/widgets/volume";
import { GREY } from "../../canvas-kit";
import { paintKey, widgetArea } from "../../draw-widget";
import type { WidgetLook } from "../../draw-widget";
import { glyphs, picture, plain, rgb565 } from "../../wheel";
import type { DeckKey } from "../widget-view";
import { paintVolume, volumeFillMap, volumeGeometry } from "./draw-volume";

function volume(
    look: WidgetLook,
    widget: VolumeWidget,
    muted: boolean,
    width: number,
    height: number,
): Uint8Array {
    const area = widgetArea(look, width, height);
    const at = (level: number) =>
        picture(width, height, (ctx) => {
            paintKey(ctx, look, width, height);
            paintVolume(ctx, widget, look, area, level, muted, false);
        });
    const empty = at(0);
    const shape = volumeGeometry(widget, area);
    // The arc writes its value; the bar shows none.
    const number = shape.kind === "arc";
    return encodeWheelSpec({
        kind: "dial",
        min: 0,
        max: 100,
        // A key's height of swipe runs the whole range.
        unitPx: 1.2,
        textY: number ? shape.textY : 0,
        color: rgb565(muted ? GREY : look.color),
        backdrop: encodeLivePatch(null, empty, width, height),
        fill: encodeLivePatch(empty, at(100), width, height),
        map: volumeFillMap(widget, area, width, height),
        size: number ? glyphs(plain([..."0123456789"]), shape.textSize, 700) : null,
    });
}

/** The volume: a dial the deck fills under the finger, greyed while muted. */
export function volumeWheel({
    look,
    widget,
    muted,
    width,
    height,
}: DeckKey<VolumeWidget>): Uint8Array {
    return volume(look, widget, muted, width, height);
}

/** Muted, the dial greys out: a look of its own. */
export function volumeMuted(state: WidgetState | undefined): boolean {
    return state?.muted === true;
}

/** A dial has no labels: it rests at the volume. */
export function volumePlace(
    _widget: VolumeWidget,
    state: WidgetState | undefined,
): { values: number[]; index: number } {
    return { values: [], index: Math.round(state?.level ?? 0) };
}
