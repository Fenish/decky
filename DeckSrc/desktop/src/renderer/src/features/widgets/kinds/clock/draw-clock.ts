import { clockParts } from "../../../../../../shared/widgets/clock";
import type { ClockWidget } from "../../../../../../shared/widgets/clock";
import { bigText, DOWN, fade, FONT } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

export function drawClock(
    ctx: CanvasRenderingContext2D,
    widget: ClockWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (widget.style === "analog") {
        drawAnalog(ctx, widget, look, area, moment);
        return;
    }
    if (!moment) return;
    const parts = clockParts(widget, moment.now);
    if (widget.style === "minimal") {
        // Hours over minutes, large, the minutes a shade quieter.
        const minutes = String(parts.minutes).padStart(2, "0");
        const half = { ...area, h: area.h / 2 };
        bigText(ctx, parts.hour, look.color, half, 0.9, 700, area.y + area.h * 0.3);
        bigText(ctx, minutes, fade(look.color, 0.55), half, 0.9, 700, area.y + area.h * 0.72);
        if (widget.hour12) {
            ctx.font = `600 ${Math.round(area.h * 0.1)}px ${FONT}`;
            ctx.fillStyle = fade(look.color, 0.55);
            ctx.textAlign = "right";
            ctx.fillText(parts.period, area.x + area.w * 0.95, area.y + area.h * 0.9);
            ctx.textAlign = "center";
        }
        return;
    }
    // Digital: the time, the period under it for 12-hour, the date below.
    const withDate = widget.date;
    const timeY = area.y + area.h * (withDate ? 0.42 : 0.5);
    bigText(ctx, parts.time, look.color, area, widget.seconds ? 0.24 : 0.32, 650, timeY);
    const small = Math.round(area.h * 0.11);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    const below = [widget.hour12 ? parts.period : "", withDate ? parts.date : ""]
        .filter(Boolean)
        .join("  ·  ");
    if (below) ctx.fillText(below, area.x + area.w / 2, area.y + area.h * 0.72, area.w * 0.92);
}

function drawAnalog(
    ctx: CanvasRenderingContext2D,
    widget: ClockWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.42;
    // The face: twelve marks, the quarters longer.
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const quarter = i % 3 === 0;
        const inner = r * (quarter ? 0.78 : 0.86);
        ctx.strokeStyle = fade(look.color, quarter ? 0.9 : 0.45);
        ctx.lineWidth = Math.max(1, r * (quarter ? 0.07 : 0.04));
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(angle) * inner, cy - Math.cos(angle) * inner);
        ctx.lineTo(cx + Math.sin(angle) * r, cy - Math.cos(angle) * r);
        ctx.stroke();
    }
    if (moment) {
        const { hours, minutes, seconds } = clockParts(widget, moment.now);
        const hand = (turn: number, length: number, width: number, color: string): void => {
            const angle = turn * Math.PI * 2;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(cx - Math.sin(angle) * r * 0.12, cy + Math.cos(angle) * r * 0.12);
            ctx.lineTo(cx + Math.sin(angle) * r * length, cy - Math.cos(angle) * r * length);
            ctx.stroke();
        };
        const secondTurn = widget.seconds ? seconds / 60 : 0;
        hand(((hours % 12) + minutes / 60) / 12, 0.5, r * 0.11, look.color);
        hand((minutes + secondTurn) / 60, 0.74, r * 0.07, look.color);
        if (widget.seconds) hand(seconds / 60, 0.82, Math.max(1, r * 0.03), DOWN);
    }
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
}
