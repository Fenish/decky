import type { VolumeWidget } from "../../../../../../shared/widgets/volume";
import { DOWN, fade, GREY, icon, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/**
 * Where a volume key's shape sits: a 270° arc open at the bottom with its
 * number inside, or an upright bar with none - its fill says it. The deck's
 * dial fills the same shape (volumeFillMap).
 */
export function volumeGeometry(widget: VolumeWidget, area: Area) {
    const cx = area.x + area.w / 2;
    if (widget.style === "bar") {
        const w = Math.round(area.w * 0.42);
        const h = Math.round(area.h * 0.84);
        const y = Math.round(area.y + area.h * 0.08);
        return {
            kind: "bar" as const,
            x: Math.round(cx - w / 2),
            y,
            w,
            h,
            radius: Math.round(w * 0.3),
        };
    }
    const r = Math.min(area.w, area.h) * 0.37;
    const cy = area.y + area.h * 0.53;
    return {
        kind: "arc" as const,
        cx,
        cy,
        r,
        stroke: r * 0.2,
        start: Math.PI * 0.75,
        sweep: Math.PI * 1.5,
        textY: Math.round(cy - r * 0.1),
        textSize: Math.round(r * 0.62),
    };
}

/**
 * The volume at `level` (0-100). The deck draws the arc's number itself, so
 * the pictures it is sent leave it out (`number` false); the bar has none.
 */
export function paintVolume(
    ctx: CanvasRenderingContext2D,
    widget: VolumeWidget,
    look: WidgetLook,
    area: Area,
    level: number,
    muted: boolean,
    number: boolean,
): void {
    const shape = volumeGeometry(widget, area);
    const tint = muted ? GREY : look.color;
    const share = Math.max(0, Math.min(1, level / 100));
    if (shape.kind === "arc") {
        const { cx, cy, r, stroke, start, sweep } = shape;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = stroke;
        ctx.strokeStyle = fade(tint, 0.14);
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + sweep);
        ctx.stroke();
        if (share > 0) {
            // Brighter as it climbs, with a soft glow.
            const glow = ctx.createConicGradient(start, cx, cy);
            glow.addColorStop(0, fade(tint, 0.5));
            glow.addColorStop(sweep / (Math.PI * 2), tint);
            ctx.strokeStyle = glow;
            ctx.shadowColor = fade(tint, 0.5);
            ctx.shadowBlur = 9;
            ctx.beginPath();
            ctx.arc(cx, cy, r, start, start + sweep * share);
            ctx.stroke();
        }
        ctx.restore();
        icon(
            ctx,
            muted ? "volumeOff" : "volume",
            cx,
            cy + r * 0.52,
            r * 0.36,
            muted ? DOWN : fade(tint, 0.65),
        );
        if (number)
            write(ctx, String(Math.round(level)), cx, shape.textY, shape.textSize, tint, 700);
        return;
    }
    const { x, y, w, h, radius } = shape;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = fade(tint, 0.14);
    ctx.fillRect(x, y, w, h);
    const fill = Math.round(h * share);
    if (fill > 0) {
        const shade = ctx.createLinearGradient(0, y + h - fill, 0, y + h);
        shade.addColorStop(0, tint);
        shade.addColorStop(1, fade(tint, 0.78));
        ctx.fillStyle = shade;
        ctx.fillRect(x, y + h - fill, w, fill);
    }
    ctx.restore();
    // The speaker sits at the bar's foot: dark on the fill, pale on the track.
    const iconY = y + h - w * 0.42;
    const covered = fill > h - (iconY - y) + w * 0.18;
    icon(
        ctx,
        muted ? "volumeOff" : "volume",
        x + w / 2,
        iconY,
        w * 0.44,
        covered ? look.background : muted ? DOWN : fade(tint, 0.7),
    );
}

/**
 * For the deck's dial: at what share of the range (1-254) each pixel of the
 * key shows the full picture instead of the empty one; 255 for never. The
 * arc fills by its angle, the bar from the bottom; the round ends and the
 * glow go with the part of the shape beside them.
 */
export function volumeFillMap(
    widget: VolumeWidget,
    area: Area,
    width: number,
    height: number,
): Uint8Array {
    const shape = volumeGeometry(widget, area);
    const map = new Uint8Array(width * height).fill(255);
    const share = (t: number): number => 1 + Math.round(Math.max(0, Math.min(1, t)) * 253);
    for (let py = 0; py < height; py++)
        for (let px = 0; px < width; px++) {
            const i = py * width + px;
            if (shape.kind === "arc") {
                const dx = px + 0.5 - shape.cx;
                const dy = py + 0.5 - shape.cy;
                const reach = shape.stroke / 2 + 10;
                if (Math.abs(Math.hypot(dx, dy) - shape.r) > reach) continue;
                // How far round from the start, in [-gap/2, 2 pi - gap/2): each
                // half of the opening belongs to its nearer end. (Wrapping into
                // [-pi, ...) instead put the last third of the arc before the
                // start - lit at every level.)
                const gap = Math.PI * 2 - shape.sweep;
                let angle = Math.atan2(dy, dx) - shape.start;
                while (angle < -gap / 2) angle += Math.PI * 2;
                while (angle >= Math.PI * 2 - gap / 2) angle -= Math.PI * 2;
                map[i] = share(angle / shape.sweep);
            } else if (
                px >= shape.x - 2 &&
                px < shape.x + shape.w + 2 &&
                py >= shape.y - 2 &&
                py < shape.y + shape.h + 2
            ) {
                map[i] = share((shape.y + shape.h - (py + 0.5)) / shape.h);
            }
        }
    return map;
}

export function drawVolume(
    ctx: CanvasRenderingContext2D,
    widget: VolumeWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const state = moment?.state;
    paintVolume(
        ctx,
        widget,
        look,
        area,
        moment ? (state?.level ?? 0) : 0,
        state?.muted === true,
        moment !== undefined,
    );
}
