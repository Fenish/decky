import { COINS, formatPrice } from "../../../../shared/widgets";
import type { Widget } from "../../../../shared/widgets";
import { DOWN, fade, fitSize, FONT, ring, sparkline, TEAL, UP, write } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import type { WidgetLook, WidgetMoment } from "./draw-widget";

const last = (values: number[] | undefined): number | undefined => values?.[values.length - 1];

export function drawSystem(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "system" }>,
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
            ring(ctx, cx, cy, r, outer * 0.16, (last([...s.values]) ?? 0) / 100, s.color);
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

export function drawCrypto(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "crypto" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const coin = COINS.find((item) => item.id === widget.coin) ?? COINS[0]!;
    const state = moment?.state;
    const price = state?.price;
    const change = state?.change ?? 0;
    const previous = state?.previous ?? price;
    // Up or down since the check before; unchanged, over the day.
    const rising =
        price === undefined || previous === undefined
            ? change >= 0
            : price > previous
              ? true
              : price < previous
                ? false
                : change >= 0;
    const trend = rising ? UP : DOWN;
    const cx = area.x + area.w / 2;
    const pad = area.w * 0.08;
    const text = price === undefined ? "–" : formatPrice(price);
    const percent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    if (widget.style === "ticker") {
        write(
            ctx,
            coin.symbol,
            cx,
            area.y + area.h * 0.17,
            Math.round(area.h * 0.11),
            coin.color,
            700,
        );
        const size = fitSize(ctx, text, Math.round(area.h * 0.22), area.w - pad * 2);
        write(ctx, text, cx, area.y + area.h * 0.47, size, look.color, 700);
        if (price !== undefined) {
            // The arrow is the move since the last check, the figure the day's:
            // each in the colour of its own direction.
            const small = Math.round(area.h * 0.1);
            ctx.font = `700 ${small}px ${FONT}`;
            const arrow = `${rising ? "▲" : "▼"} `;
            const left = cx - ctx.measureText(arrow + percent).width / 2;
            const y = area.y + area.h * 0.75;
            write(ctx, arrow, left, y, small, trend, 700, "left");
            const after = left + ctx.measureText(arrow).width;
            write(ctx, percent, after, y, small, change >= 0 ? UP : DOWN, 700, "left");
        }
        return;
    }
    // Chart: the coin, the day's change, the price, and the day drawn.
    const badge = area.h * 0.06;
    const headY = area.y + area.h * 0.14;
    ctx.fillStyle = coin.color;
    ctx.beginPath();
    ctx.arc(area.x + pad + badge, headY, badge, 0, Math.PI * 2);
    ctx.fill();
    write(
        ctx,
        coin.symbol,
        area.x + pad + badge * 2 + 5,
        headY + 1,
        Math.round(area.h * 0.1),
        fade(look.color, 0.85),
        700,
        "left",
    );
    if (price !== undefined) {
        const pill = Math.round(area.h * 0.085);
        ctx.font = `700 ${pill}px ${FONT}`;
        const w = ctx.measureText(percent).width + pill;
        ctx.fillStyle = fade(change >= 0 ? UP : DOWN, 0.16);
        ctx.beginPath();
        ctx.roundRect(area.x + area.w - pad - w, headY - pill * 0.85, w, pill * 1.7, pill * 0.85);
        ctx.fill();
        write(
            ctx,
            percent,
            area.x + area.w - pad - w / 2,
            headY + 1,
            pill,
            change >= 0 ? UP : DOWN,
            700,
        );
    }
    const size = fitSize(ctx, text, Math.round(area.h * 0.19), area.w - pad * 2);
    write(ctx, text, area.x + pad, area.y + area.h * 0.4, size, look.color, 700, "left");
    const history = state?.history ?? [];
    if (history.length > 1) {
        const low = Math.min(...history);
        const high = Math.max(...history);
        const span = high - low || 1;
        sparkline(
            ctx,
            history.map((p) => p - low + span * 0.08),
            { x: area.x, y: area.y + area.h * 0.56, w: area.w, h: area.h * 0.42 },
            change >= 0 ? UP : DOWN,
            span * 1.16,
        );
    }
}
