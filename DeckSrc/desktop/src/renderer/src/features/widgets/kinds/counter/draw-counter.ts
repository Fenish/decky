import type { CounterWidget } from "../../../../../../shared/widgets/counter";
import { bigText } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

export function drawCounter(
    ctx: CanvasRenderingContext2D,
    widget: CounterWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (moment) {
        const value = moment.state?.value ?? widget.start;
        bigText(ctx, String(value), look.color, area, 0.42, 700);
    }
}
