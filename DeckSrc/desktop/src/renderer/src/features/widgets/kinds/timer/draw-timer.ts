import { formatDuration, runTime } from "../../../../../../shared/widgets";
import {
    hasWheel,
    timerSeconds,
    timerView,
    wheelValues,
} from "../../../../../../shared/widgets/timer";
import type { TimerWidget } from "../../../../../../shared/widgets/timer";
import { drumRow, WHEEL_FEEL } from "../../../../../../shared/wheel-spec";
import { bigText, DOWN, fade, FONT, pauseMark, timeRing } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/** A wheel's rows in its area: the label spacing at the band, and the band's middle. */
export function wheelGeometry(area: Area): { row: number; center: number } {
    return { row: Math.round(area.h * 0.3), center: Math.round(area.y + area.h / 2) };
}

/**
 * The wheel's two font sizes: minutes and seconds large, hours (six
 * characters and up) as large as the longest still fits.
 */
export function wheelFonts(
    ctx: CanvasRenderingContext2D,
    area: Area,
    row: number,
): [number, number] {
    const room = area.w * 0.88;
    const fit = (size: number, text: string): number => {
        ctx.font = `650 ${size}px ${FONT}`;
        const width = ctx.measureText(text).width;
        return width > room ? Math.floor((size * room) / width) : size;
    };
    const large = fit(Math.round(row * 0.8), "59:59");
    return [large, fit(large, "3:00:00")];
}

/**
 * An adjustable countdown at rest: its times on a drum, the one it will run
 * in the band - shorter above, longer below, so a swipe up rolls more time
 * in. The deck draws and turns the same drum by itself, with drumRow's sums
 * (firmware/src/keys/drum/); this is its picture at rest. The band is in the
 * base picture too; the times are not.
 */
function drawWheel(
    ctx: CanvasRenderingContext2D,
    widget: TimerWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const { row, center } = wheelGeometry(area);
    ctx.fillStyle = fade(look.color, 0.1);
    ctx.beginPath();
    ctx.roundRect(area.x + area.w * 0.08, center - row / 2, area.w * 0.84, row, row * 0.25);
    ctx.fill();
    if (!moment) return;
    const values = wheelValues(widget);
    const index = values.indexOf(timerSeconds(widget, moment.state));
    const [large, small] = wheelFonts(ctx, area, row);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.fillStyle = look.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = Math.max(0, index - 3); i <= Math.min(values.length - 1, index + 3); i++) {
        const place = drumRow(i - index, row, WHEEL_FEEL);
        if (!place || place.alpha <= 0) continue;
        const text = formatDuration(values[i]! * 1000);
        ctx.save();
        ctx.translate(area.x + area.w / 2, center + place.offset);
        ctx.scale(1, place.squash);
        ctx.globalAlpha = place.alpha;
        ctx.font = `650 ${text.length > 5 ? small : large}px ${FONT}`;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

export function drawTimer(
    ctx: CanvasRenderingContext2D,
    widget: TimerWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    // An adjustable countdown shows its wheel until it has run at all.
    if (hasWheel(widget) && (!moment || runTime(moment.state, moment.now) === 0)) {
        drawWheel(ctx, widget, look, area, moment);
        return;
    }
    if (!moment) {
        timeRing(ctx, area, look.color, null);
        return;
    }
    const view = timerView(widget, moment.state, moment.now);
    const running = Boolean(moment.state?.running);
    const color = view.done ? DOWN : look.color;
    const { cy, r } = timeRing(ctx, area, color, view.progress, running || view.done ? 1 : 0.5);
    const inner = { x: area.x + area.w * 0.2, y: cy - r * 0.5, w: area.w * 0.6, h: r };
    bigText(ctx, view.text, color, inner, 0.62, 650, cy);
    if (!running && !view.done && runTime(moment.state, moment.now) > 0)
        pauseMark(ctx, area.x + area.w / 2, cy + r * 0.55, r * 0.22, fade(look.color, 0.7));
}
