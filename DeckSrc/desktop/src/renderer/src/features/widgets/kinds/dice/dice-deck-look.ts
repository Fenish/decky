import { encodeLivePatch } from "../../../../../../shared/live-patch";
import { DICE_FEEL, DIE_FEEL, encodeWheelSpec } from "../../../../../../shared/wheel-spec";
import { DIE_SHARE, packPose } from "../../../../../../shared/die";
import { diceFaces, diceLabels } from "../../../../../../shared/widgets/dice";
import type { DiceWidget } from "../../../../../../shared/widgets/dice";
import type { WidgetState } from "../../../../../../shared/widgets";
import { paintKey, widgetArea } from "../../draw-widget";
import type { WidgetLook } from "../../draw-widget";
import { glyphs, picture, rgb565 } from "../../wheel";
import type { DeckKey } from "../widget-view";
import { diceGeometry, diePose, pipColor } from "./draw-dice";

/** A coin, yes or no, or a list: a drum of words the deck spins to a side. */
function dice(look: WidgetLook, widget: DiceWidget, width: number, height: number): Uint8Array {
    const area = widgetArea(look, width, height);
    const faces = diceFaces(widget);
    let geometry = { row: 0, center: 0, font: 0 };
    const backdrop = picture(width, height, (ctx) => {
        paintKey(ctx, look, width, height);
        geometry = diceGeometry(ctx, widget, area);
    });
    // Every character the words use, under ids from 33 on.
    const chars = [...new Set(faces.join(""))];
    const id = (char: string): string => String.fromCharCode(33 + chars.indexOf(char));
    const size = glyphs(
        chars.map((char) => ({ id: id(char), char })),
        geometry.font,
        700,
    );
    const texts = faces.map((face) => [...face].map(id).join(""));
    return encodeWheelSpec({
        kind: "drum",
        row: geometry.row,
        center: geometry.center,
        clipTop: Math.round(area.y),
        clipBottom: Math.round(area.y + area.h),
        color: rgb565(look.color),
        feel: DICE_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
        sizes: [size],
        labels: diceLabels(widget).map((face) => ({ size: 0, text: texts[face]! })),
    });
}

/** A die: the deck draws it in 3D and throws it; it needs only the key under it. */
function die(look: WidgetLook, width: number, height: number): Uint8Array {
    const backdrop = picture(width, height, (ctx) => paintKey(ctx, look, width, height));
    return encodeWheelSpec({
        kind: "die",
        size: Math.round(DIE_SHARE * Math.min(width, height)),
        color: rgb565(look.color),
        pip: rgb565(pipColor(look.color)),
        feel: DIE_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
    });
}

/** Dice: a die the deck throws, or a drum it spins - a coin, yes or no, or a list. */
export function diceWheel({ look, widget, width, height }: DeckKey<DiceWidget>): Uint8Array {
    return widget.mode === "die" ? die(look, width, height) : dice(look, widget, width, height);
}

/** Where it rests: a die by how it lies, a drum by the side it landed on. */
export function dicePlace(
    widget: DiceWidget,
    state: WidgetState | undefined,
): { values: number[]; index: number } {
    if (widget.mode === "die")
        return { values: [], index: packPose(diePose(state?.value, state?.rest)) };
    return {
        values: diceLabels(widget),
        index: (state?.value ?? 0) + diceFaces(widget).length,
    };
}
