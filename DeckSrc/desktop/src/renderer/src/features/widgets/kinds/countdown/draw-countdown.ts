import { daysUntil } from "../../../../../../shared/widgets/countdown";
import type { CountdownWidget } from "../../../../../../shared/widgets/countdown";
import { bigText, fade, FONT } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

export function drawCountdown(
    ctx: CanvasRenderingContext2D,
    widget: CountdownWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const title = widget.title.trim();
    const small = Math.round(area.h * 0.12);
    if (title) {
        ctx.fillStyle = fade(look.color, 0.7);
        ctx.font = `600 ${small}px ${FONT}`;
        ctx.fillText(title, area.x + area.w / 2, area.y + area.h * 0.18, area.w * 0.9);
    }
    if (!moment) return;
    const days = daysUntil(widget.date, moment.now);
    const middle = area.y + area.h * (title ? 0.52 : 0.44);
    if (days === 0) {
        bigText(ctx, "Today", look.color, area, 0.3, 700, middle);
        return;
    }
    bigText(ctx, String(Math.abs(days)), look.color, area, 0.42, 700, middle);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    const unit = Math.abs(days) === 1 ? "day" : "days";
    ctx.fillText(days > 0 ? unit : `${unit} ago`, area.x + area.w / 2, area.y + area.h * 0.84);
}
