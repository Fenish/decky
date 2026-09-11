import { trackPosition } from "../../../../shared/widgets";
import type { Widget } from "../../../../shared/widgets";
import { clip, coverImage, DOWN, fade, FONT, GREY, icon, write } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import type { WidgetLook, WidgetMoment } from "./draw-widget";
import { slideLine } from "./slide";

type Volume = Extract<Widget, { type: "volume" }>;

/**
 * Where a volume key's shape sits: a 270° arc open at the bottom with its
 * number inside, or an upright bar with none - its fill says it. The deck's
 * dial fills the same shape (volumeFillMap).
 */
export function volumeGeometry(widget: Volume, area: Area) {
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
    widget: Volume,
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
    widget: Volume,
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
    widget: Volume,
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

/**
 * The microphone: a lit disc and the mic, red and struck through while
 * Windows has it muted - the colour says so, no words needed. Grey with "No
 * mic" when there is none.
 */
export function drawMic(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const state = moment?.state;
    const missing = state?.missing === true;
    const muted = !missing && state?.muted === true;
    const tint = missing ? GREY : muted ? DOWN : look.color;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.3;
    const y = missing ? cy - area.h * 0.06 : cy;
    const disc = ctx.createRadialGradient(cx, y - r * 0.3, r * 0.2, cx, y, r);
    disc.addColorStop(0, fade(tint, 0.24));
    disc.addColorStop(1, fade(tint, 0.07));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fade(tint, 0.38);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    icon(ctx, muted || missing ? "micOff" : "mic", cx, y, r * 1.02, tint);
    if (missing)
        write(ctx, "No mic", cx, y + r + area.h * 0.12, Math.round(area.h * 0.1), tint, 700);
}

/** A picture scaled to cover `box`, centred, cropping what spills over. */
function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, box: Area): void {
    const scale = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}

export function drawMedia(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "media" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const track = moment?.state?.track;
    const cx = area.x + area.w / 2;
    if (!track) {
        icon(ctx, "music", cx, area.y + area.h * 0.42, area.h * 0.3, fade(look.color, 0.5));
        write(
            ctx,
            "Nothing playing",
            cx,
            area.y + area.h * 0.76,
            Math.round(area.h * 0.095),
            fade(look.color, 0.45),
        );
        return;
    }
    const art = track.art ? coverImage(track.art) : null;
    const progress = track.duration > 0 ? trackPosition(track, moment!.now) / track.duration : null;
    const artless = (box: Area): void => {
        const wash = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
        wash.addColorStop(0, fade(look.color, 0.22));
        wash.addColorStop(1, fade(look.color, 0.05));
        ctx.fillStyle = wash;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        icon(
            ctx,
            "music",
            box.x + box.w / 2,
            box.y + box.h * 0.42,
            Math.min(box.w, box.h) * 0.34,
            fade(look.color, 0.55),
        );
    };
    // A line that fits is drawn; one that does not slides on the deck, which
    // takes it from `slides`, or is cut short where nothing slides it.
    const line = (
        text: string,
        room: Area,
        middle: number,
        size: number,
        weight: number,
        alpha: number,
        align: "left" | "center",
    ): void => {
        ctx.font = `${weight} ${size}px ${FONT}`;
        if (moment?.slides && ctx.measureText(text).width > room.w) {
            moment.slides.push(slideLine(ctx, text, size, weight, room, middle, look.color, alpha));
            return;
        }
        const x = align === "left" ? room.x : room.x + room.w / 2;
        const color = alpha < 1 ? fade(look.color, alpha) : look.color;
        write(ctx, clip(ctx, text, room.w), x, middle, size, color, weight, align);
    };
    const paused = (x: number, y: number, r: number): void => {
        if (track.playing) return;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        icon(ctx, "pause", x, y, r * 1.05, "#ffffff", true);
    };
    if (widget.style === "cover") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.x, area.y, area.w, area.h);
        ctx.clip();
        if (art) cover(ctx, art, area);
        else artless(area);
        const scrim = ctx.createLinearGradient(0, area.y + area.h * 0.35, 0, area.y + area.h);
        scrim.addColorStop(0, "rgba(0, 0, 0, 0)");
        scrim.addColorStop(1, "rgba(0, 0, 0, 0.88)");
        ctx.fillStyle = scrim;
        ctx.fillRect(area.x, area.y, area.w, area.h);
        ctx.restore();
        const room = { x: area.x + 8, y: area.y, w: area.w - 16, h: area.h };
        const bottom = area.y + area.h;
        line(track.title, room, bottom - area.h * 0.2, Math.round(area.h * 0.105), 700, 1, "left");
        line(
            track.artist,
            room,
            bottom - area.h * 0.09,
            Math.round(area.h * 0.085),
            500,
            0.72,
            "left",
        );
        if (progress !== null) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
            ctx.fillRect(area.x, bottom - 3, area.w, 3);
            ctx.fillStyle = look.color;
            ctx.fillRect(area.x, bottom - 3, area.w * Math.min(1, progress), 3);
        }
        paused(area.x + area.w - 15, area.y + 15, 10);
        return;
    }
    // Card: the cover small and rounded, title and artist beneath, a progress bar.
    const size = Math.min(area.w * 0.5, area.h * 0.46);
    const box = { x: cx - size / 2, y: area.y + area.h * 0.07, w: size, h: size };
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, size * 0.14);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, size * 0.14);
    ctx.clip();
    if (art) cover(ctx, art, box);
    else artless(box);
    ctx.restore();
    paused(box.x + box.w - 9, box.y + 9, 8);
    const room = { x: area.x + 7, y: area.y, w: area.w - 14, h: area.h };
    line(
        track.title,
        room,
        box.y + size + area.h * 0.12,
        Math.round(area.h * 0.1),
        700,
        1,
        "center",
    );
    line(
        track.artist,
        room,
        box.y + size + area.h * 0.22,
        Math.round(area.h * 0.08),
        500,
        0.65,
        "center",
    );
    if (progress !== null) {
        const barW = area.w * 0.74;
        const barY = area.y + area.h - area.h * 0.09;
        ctx.fillStyle = fade(look.color, 0.16);
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, barW, 3.5, 2);
        ctx.fill();
        ctx.fillStyle = look.color;
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, Math.max(3.5, barW * Math.min(1, progress)), 3.5, 2);
        ctx.fill();
    }
}
