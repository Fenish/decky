import type { SlideLine } from "../../../../shared/slide-spec";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { fade, FONT } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import { viewOf } from "./kinds/registry";

/** The key's own colours and caption, which every widget style follows. */
export interface WidgetLook {
    background: string;
    color: string;
    label: string;
}

/** What only a running widget knows. Absent, the widget draws its base picture. */
export interface WidgetMoment {
    state: WidgetState | undefined;
    now: number;
    /**
     * Where the deck slides text too long for its key along (slide=1): such
     * lines go here instead of onto the picture. Without it they are cut
     * short with an ellipsis.
     */
    slides?: SlideLine[];
}

/**
 * Draw a widget key: the key, then the widget as its view draws it (kinds/).
 *
 * Without `moment` it draws only what its settings decide - the face of an
 * analog clock, a note - and nothing that depends on the time or on state.
 * Page uploads use that base picture, so the page's checksum stays the same
 * from one launch to the next and the deck's cache keeps matching; the live
 * parts arrive as patches once the page is on screen.
 */
export function drawWidget(
    ctx: CanvasRenderingContext2D,
    widget: Widget,
    look: WidgetLook,
    w: number,
    h: number,
    moment?: WidgetMoment,
): void {
    ctx.save();
    paintKey(ctx, look, w, h);
    const area = widgetArea(look, w, h);
    viewOf(widget).draw(ctx, widget, look, area, moment);
    ctx.restore();
}

/** The key under any widget: its background, and its caption at the top. */
export function paintKey(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    w: number,
    h: number,
): void {
    ctx.fillStyle = look.background;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const caption = look.label.trim();
    if (caption) {
        ctx.fillStyle = fade(look.color, 0.7);
        ctx.font = `600 ${Math.round(h * 0.1)}px ${FONT}`;
        ctx.fillText(caption, w / 2, h * 0.12, w * 0.9);
    }
}

/** Where a widget draws: all of the key, or below its caption. */
export function widgetArea(look: WidgetLook, w: number, h: number): Area {
    const top = look.label.trim() ? h * 0.2 : 0;
    return { x: 0, y: top, w, h: h - top };
}
