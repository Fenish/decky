import { COINS, formatPrice } from "../../../../../../shared/widgets/crypto";
import type { CryptoWidget } from "../../../../../../shared/widgets/crypto";
import { DOWN, fade, fitSize, FONT, sparkline, UP, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

export function drawCrypto(
    ctx: CanvasRenderingContext2D,
    widget: CryptoWidget,
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
