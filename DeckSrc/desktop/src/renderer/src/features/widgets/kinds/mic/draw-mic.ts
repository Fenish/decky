import type { MicWidget } from "../../../../../../shared/widgets/mic";
import { DOWN, fade, GREY, icon, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/**
 * The microphone: a lit disc and the mic, red and struck through while
 * Windows has it muted - the colour says so, no words needed. Grey with "No
 * mic" when there is none.
 */
export function drawMic(
    ctx: CanvasRenderingContext2D,
    _widget: MicWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const state = moment?.state;
    const missing = state?.missing === true;
    const muted = !missing && state?.muted === true;
    const tint = missing ? GREY : muted ? DOWN : look.color;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.3;
    const y = missing ? cy - area.h * 0.06 : cy;
    const disc = ctx.createRadialGradient(cx, y - r * 0.3, r * 0.2, cx, y, r);
    disc.addColorStop(0, fade(tint, 0.24));
    disc.addColorStop(1, fade(tint, 0.07));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fade(tint, 0.38);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    icon(ctx, muted || missing ? "micOff" : "mic", cx, y, r * 1.02, tint);
    if (missing)
        write(ctx, "No mic", cx, y + r + area.h * 0.12, Math.round(area.h * 0.1), tint, 700);
}
