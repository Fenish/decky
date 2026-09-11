import { encodeLivePatch } from "../../../../../../shared/live-patch";
import { encodeWheelSpec } from "../../../../../../shared/wheel-spec";
import type { WidgetState } from "../../../../../../shared/widgets";
import type { LevelStyle } from "../../../../../../shared/widgets/level";
import { GREY } from "../../canvas-kit";
import { paintKey, widgetArea } from "../../draw-widget";
import type { WidgetLook } from "../../draw-widget";
import { glyphs, picture, plain, rgb565 } from "../../wheel";
import { levelFillMap, levelGeometry, paintLevel } from "./draw-level";
import type { LevelIcons } from "./draw-level";

/** A key the deck turns a level on, as its look is built. */
export interface LevelKey {
    look: WidgetLook;
    style: LevelStyle;
    icons: LevelIcons;
    muted: boolean;
    width: number;
    height: number;
}

/** A level's dial for the deck, which fills it under the finger; greyed while muted. */
export function levelDial({ look, style, icons, muted, width, height }: LevelKey): Uint8Array {
    const area = widgetArea(look, width, height);
    const at = (level: number) =>
        picture(width, height, (ctx) => {
            paintKey(ctx, look, width, height);
            paintLevel(ctx, style, icons, look, area, level, muted, false);
        });
    const empty = at(0);
    const shape = levelGeometry(style, area);
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
        map: levelFillMap(style, area, width, height),
        size: number ? glyphs(plain([..."0123456789"]), shape.textSize, 700) : null,
    });
}

/** A dial has no labels: it rests at the level. */
export function levelPlace(state: WidgetState | undefined): { values: number[]; index: number } {
    return { values: [], index: Math.round(state?.level ?? 0) };
}
