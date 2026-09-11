import { pomodoroView } from "../../../../../../shared/widgets/pomodoro";
import type { PomodoroWidget } from "../../../../../../shared/widgets/pomodoro";
import { bigText, fade, FONT, pauseMark, timeRing } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

const REST = "#9fd7b8";

export function drawPomodoro(
    ctx: CanvasRenderingContext2D,
    widget: PomodoroWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (!moment) {
        timeRing(ctx, area, look.color, null);
        return;
    }
    const view = pomodoroView(widget, moment.state, moment.now);
    const running = Boolean(moment.state?.running);
    const color = view.phase === "focus" ? look.color : REST;
    const { cx, cy, r } = timeRing(ctx, area, color, view.progress, running ? 1 : 0.5);
    ctx.fillStyle = fade(color, 0.75);
    ctx.font = `700 ${Math.round(r * 0.28)}px ${FONT}`;
    ctx.fillText(view.phase === "focus" ? "FOCUS" : "BREAK", cx, cy - r * 0.42);
    const inner = { x: area.x + area.w * 0.22, y: cy - r * 0.4, w: area.w * 0.56, h: r * 0.8 };
    bigText(ctx, view.text, color, inner, 0.7, 650, cy + r * 0.08);
    if (!running) pauseMark(ctx, cx, cy + r * 0.58, r * 0.2, fade(look.color, 0.7));
    else if (view.rounds > 0) {
        ctx.fillStyle = fade(look.color, 0.6);
        ctx.font = `600 ${Math.round(r * 0.24)}px ${FONT}`;
        ctx.fillText(`× ${view.rounds}`, cx, cy + r * 0.58);
    }
}
