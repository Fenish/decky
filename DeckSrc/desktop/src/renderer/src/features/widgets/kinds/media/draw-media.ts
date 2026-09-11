import { trackPosition } from "../../../../../../shared/widgets/media";
import type { MediaWidget } from "../../../../../../shared/widgets/media";
import { clip, coverImage, fade, FONT, icon, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";
import { slideLine } from "../../slide";

/** A picture scaled to cover `box`, centred, cropping what spills over. */
function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, box: Area): void {
    const scale = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}

export function drawMedia(
    ctx: CanvasRenderingContext2D,
    widget: MediaWidget,
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
