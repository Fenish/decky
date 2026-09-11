/*---------------------------------------------------------------
 * The key's own icon on a widget's face - any in the library, in the key's
 * colour, at the size its Appearance gives it - and that icon struck through
 * while what the widget shows is out of reach. For any widget that draws the
 * key's icon when it has nothing else to show (its view's `icon`).
 *--------------------------------------------------------------*/

import { fade, GREY, strike } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import type { WidgetLook } from "./draw-widget";
import { drawKeyIcon } from "./key-icon-canvas";

/** The key's icon's size in `room`: `share` of it at 100%, as its Appearance scales it; never past the room. */
export function iconSize(look: WidgetLook, room: Area, share = 0.36): number {
    const side = Math.min(room.w, room.h);
    return Math.min(side * 0.95, side * share * ((look.iconSize ?? 100) / 100));
}

/** The key's icon (`fallback` when it has none), centred on (x, y), in its colour or `color`. */
export function keyGlyph(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    fallback: string,
    x: number,
    y: number,
    size: number,
    color = look.color,
): void {
    drawKeyIcon(ctx, look.icon || fallback, x, y, size, color);
}

/**
 * Out of reach, whatever the reason (the app's card in the window says which):
 * the icon greyed, a slash through it - as every key of an app out of reach
 * wears.
 */
export function unreachable(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    fallback: string,
    x: number,
    y: number,
    size: number,
): void {
    keyGlyph(ctx, look, fallback, x, y, size, fade(GREY, 0.45));
    strike(ctx, x, y, size * 0.62, Math.max(1.5, size * 0.08), look.background);
}
