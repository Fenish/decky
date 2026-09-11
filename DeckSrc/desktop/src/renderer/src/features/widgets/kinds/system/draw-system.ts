import type { SystemWidget } from "../../../../../../shared/widgets/system";
import { fade, fitSize, ring, sparkline, TEAL, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

const last = (values: number[] | undefined): number | undefined => values?.[values.length - 1];

export function drawSystem(
    ctx: CanvasRenderingContext2D,
    widget: SystemWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const state = moment?.state;
    const series = (
        [
            {
                name: "CPU",
                values: state?.cpu ?? [],
                color: look.color,
                show: widget.show !== "ram",
            },
            {
                name: "RAM",
                values: state?.ram ?? [],
                color: widget.show === "both" ? TEAL : look.color,
                show: widget.show !== "cpu",
            },
        ] as const
    ).filter((s) => s.show);
    const value = (values: readonly number[]): string =>
        values.length ? `${Math.round(values[values.length - 1]!)}` : "–";
    const cx = area.x + area.w / 2;
    if (widget.style === "rings") {
        const cy = area.y + area.h / 2;
        const outer = Math.min(area.w, area.h) * 0.4;
        series.forEach((s, i) => {
            const r = outer - i * (outer * 0.3);
            ring(
                ctx,
                cx,
                cy,
                r,
                outer * 0.16,
                { share: (last([...s.values]) ?? 0) / 100 },
                s.color,
            );
        });
        const main = series[0]!;
        const big = Math.round(outer * (series.length > 1 ? 0.5 : 0.62));
        write(
            ctx,
            `${value(main.values)}%`,
            cx,
            cy - (series.length > 1 ? outer * 0.12 : outer * 0.06),
            big,
            main.color,
            700,
        );
        if (series.length > 1) {
            const second = series[1]!;
            write(
                ctx,
                `${second.name} ${value(second.values)}%`,
                cx,
                cy + outer * 0.3,
                Math.round(outer * 0.22),
                fade(second.color, 0.9),
                600,
            );
        } else
            write(
                ctx,
                main.name,
                cx,
                cy + outer * 0.34,
                Math.round(outer * 0.22),
                fade(main.color, 0.6),
                700,
            );
        return;
    }
    // Graph: a panel per measure, its name, its value, and its last minute.
    const gap = area.h * 0.04;
    const panel = (area.h - gap * (series.length - 1)) / series.length;
    series.forEach((s, i) => {
        const top = area.y + i * (panel + gap);
        const pad = area.w * 0.08;
        const labelSize = Math.round(Math.min(panel * 0.17, area.h * 0.09));
        if (series.length === 1) {
            write(
                ctx,
                s.name,
                area.x + pad,
                top + panel * 0.14,
                labelSize,
                fade(s.color, 0.6),
                700,
                "left",
            );
            const size = fitSize(
                ctx,
                `${value(s.values)}%`,
                Math.round(panel * 0.3),
                area.w - pad * 2,
            );
            write(
                ctx,
                `${value(s.values)}%`,
                area.x + pad,
                top + panel * 0.36,
                size,
                s.color,
                700,
                "left",
            );
            sparkline(
                ctx,
                [...s.values],
                { x: area.x, y: top + panel * 0.5, w: area.w, h: panel * 0.48 },
                s.color,
                100,
            );
        } else {
            write(
                ctx,
                s.name,
                area.x + pad,
                top + panel * 0.2,
                labelSize,
                fade(s.color, 0.62),
                700,
                "left",
            );
            write(
                ctx,
                `${value(s.values)}%`,
                area.x + area.w - pad,
                top + panel * 0.22,
                Math.round(panel * 0.27),
                s.color,
                700,
                "right",
            );
            sparkline(
                ctx,
                [...s.values],
                { x: area.x, y: top + panel * 0.42, w: area.w, h: panel * 0.54 },
                s.color,
                100,
            );
        }
    });
}
