import type { PingWidget } from "../../../../../../shared/widgets/ping";
import { bigText, DOWN, fade, FONT, SLOW, UP } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/** Round trips this fast are green, then amber; slower ones and none are red. */
const QUICK_MS = 100;
const SLOW_MS = 250;

export function drawPing(
    ctx: CanvasRenderingContext2D,
    widget: PingWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const cx = area.x + area.w / 2;
    const small = Math.round(area.h * 0.11);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    ctx.fillText(widget.host, cx, area.y + area.h * 0.86, area.w * 0.9);
    if (!moment) return;
    const middle = area.y + area.h * 0.4;
    const state = moment.state;
    if (state?.up === undefined) {
        bigText(ctx, "…", fade(look.color, 0.4), area, 0.4, 700, middle);
        return;
    }
    const ms = state.up ? (state.ms ?? 0) : null;
    const colour = ms === null || ms >= SLOW_MS ? DOWN : ms >= QUICK_MS ? SLOW : UP;
    const value = ms === null ? "—" : ms < 1 ? "<1" : String(ms);
    bigText(ctx, value, ms === null ? DOWN : look.color, area, 0.4, 700, middle);
    // Under it, a dot in the answer's colour and the unit.
    const unit = ms === null ? "no reply" : "ms";
    ctx.font = `600 ${small}px ${FONT}`;
    const r = small * 0.32;
    const left = cx - (ctx.measureText(unit).width + r * 3.6) / 2;
    const y = area.y + area.h * 0.66;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(left + r, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.textAlign = "left";
    ctx.fillText(unit, left + r * 3.6, y);
    ctx.textAlign = "center";
}
