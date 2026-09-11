/*---------------------------------------------------------------
 * What every widget drawing shares: the face, the colours, text that fits,
 * and a few Lucide icons (ISC licence) drawn as their own paths.
 *--------------------------------------------------------------*/

import { sweepFits, sweepShare } from "../../../../shared/sweep-spec";
import type { SweepArc, SweepMotion } from "../../../../shared/sweep-spec";

export const FONT = '"Segoe UI Variable Display", "Segoe UI", sans-serif';
/** Good, warning and bad; a second hue beside the key's accent. */
export const UP = "#7fd49a";
export const SLOW = "#f2c46d";
export const DOWN = "#ff7a6e";
export const TEAL = "#7cc9d6";
export const GREY = "#8b8a86";

export interface Area {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A colour at some opacity, from "#rrggbb". */
export function fade(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The font size, at most `size`, at which `text` fits `width`. */
export function fitSize(
    ctx: CanvasRenderingContext2D,
    text: string,
    size: number,
    width: number,
    weight = 700,
): number {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const measured = ctx.measureText(text).width;
    return measured > width ? Math.floor((size * width) / measured) : size;
}

/** `text`, cut short with an ellipsis where it would pass `width`. */
export function clip(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
}

/** Set the font and colour, and draw. */
export function write(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    weight = 600,
    align: CanvasTextAlign = "center",
): void {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.textAlign = "center";
}

/** Text as large as fits: `share` of the area's height, shrunk to its width. */
export function bigText(
    ctx: CanvasRenderingContext2D,
    text: string,
    color: string,
    area: Area,
    share: number,
    weight: number,
    y = area.y + area.h / 2,
): number {
    let size = Math.round(area.h * share);
    ctx.font = `${weight} ${size}px ${FONT}`;
    const room = area.w * 0.88;
    const width = ctx.measureText(text).width;
    if (width > room) {
        size = Math.floor((size * room) / width);
        ctx.font = `${weight} ${size}px ${FONT}`;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, area.x + area.w / 2, y);
    return size;
}

// Lucide's 24-unit icons; rects and circles written as paths.
const ICONS: Record<string, string[]> = {
    volume: [
        "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
        "M16 9a5 5 0 0 1 0 6",
        "M19.364 18.364a9 9 0 0 0 0-12.728",
    ],
    volumeOff: [
        "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
        "m16.5 14.5 5-5",
        "m16.5 9.5 5 5",
    ],
    mic: [
        "M12 19v3",
        "M19 10v2a7 7 0 0 1-14 0v-2",
        "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z",
    ],
    micOff: [
        "M12 19v3",
        "M15 9.34V5a3 3 0 0 0-5.68-1.33",
        "M16.95 16.95A7 7 0 0 1 5 12v-2",
        "M18.89 13.23A7 7 0 0 0 19 12v-2",
        "m2 2 20 20",
        "M9 9v3a3 3 0 0 0 5.12 2.12",
    ],
    music: [
        "M9 18V5l12-2v13",
        "M9 18a3 3 0 1 1-6 0 3 3 0 1 1 6 0z",
        "M21 16a3 3 0 1 1-6 0 3 3 0 1 1 6 0z",
    ],
    pause: [
        "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
        "M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    ],
    play: ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"],
    users: [
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
        "M13 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0z",
        "M22 21v-2a4 4 0 0 0-3-3.87",
        "M16 3.13a4 4 0 0 1 0 7.75",
    ],
};
export type IconName = keyof typeof ICONS;

/**
 * The mark of a key whose app is out of reach: a grey slash from top left to
 * bottom right through (x, y), `reach` out each way, cut from what is under it
 * by a gap `gap` times its width in `ground` - as a muted icon's is.
 */
export function strike(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    reach: number,
    stroke: number,
    ground: string,
    gap = 2.8,
): void {
    ctx.save();
    ctx.lineCap = "round";
    for (const [color, width] of [
        [ground, stroke * gap],
        [fade(GREY, 0.75), stroke],
    ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x - reach, y - reach);
        ctx.lineTo(x + reach, y + reach);
        ctx.stroke();
    }
    ctx.restore();
}

/** A Lucide icon, `size` pixels square, centred on (x, y): stroked, or filled. */
export function icon(
    ctx: CanvasRenderingContext2D,
    name: IconName,
    x: number,
    y: number,
    size: number,
    color: string,
    filled = false,
): void {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of ICONS[name]!) {
        if (filled) ctx.fill(new Path2D(d));
        else ctx.stroke(new Path2D(d));
    }
    ctx.restore();
}

/**
 * A small graph of `values` in `box`: a soft area under a line, and a dot on
 * the newest. `top` is the value at the top edge.
 */
export function sparkline(
    ctx: CanvasRenderingContext2D,
    values: number[],
    box: Area,
    color: string,
    top: number,
    area = true,
): void {
    if (values.length < 2) return;
    const x = (i: number): number => box.x + (i / (values.length - 1)) * box.w;
    const y = (v: number): number => box.y + box.h - (Math.min(v, top) / (top || 1)) * box.h;
    ctx.save();
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    if (area) {
        const shade = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
        shade.addColorStop(0, fade(color, 0.32));
        shade.addColorStop(1, fade(color, 0));
        ctx.lineTo(box.x + box.w, box.y + box.h);
        ctx.lineTo(box.x, box.y + box.h);
        ctx.closePath();
        ctx.fillStyle = shade;
        ctx.fill();
        ctx.beginPath();
        values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();
    const last = values[values.length - 1]!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(values.length - 1), y(last), 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * Where a drawing's rings' arcs go: `sweeps` where the deck moves them itself
 * (sweep=1), else onto the picture as they are at `now`.
 */
export interface ArcSink {
    now: number;
    sweeps?: SweepArc[];
}

/**
 * A ring's arc from the top, clockwise, to where its motion has its end. Where
 * the deck moves arcs itself and takes this one, it goes to the deck (one a
 * key) and the picture keeps only the track: the deck moves it smoothly while
 * the digits under it change once a second. Else it is painted as it is now.
 */
export function sweepArc(ctx: CanvasRenderingContext2D, arc: SweepArc, sink?: ArcSink): void {
    if (sink?.sweeps?.length === 0 && sweepFits(arc, ctx.canvas.width, ctx.canvas.height))
        sink.sweeps.push(arc);
    else paintArc(ctx, arc, sink?.now ?? 0);
}

/** An arc painted as the deck strokes it, at `now`: round ends, its glow a shadow. */
export function paintArc(ctx: CanvasRenderingContext2D, arc: SweepArc, now: number): void {
    const share = sweepShare(arc.motion, now);
    if (share <= 0) return;
    ctx.save();
    ctx.lineWidth = arc.width;
    ctx.lineCap = "round";
    ctx.strokeStyle = fade(arc.color, arc.alpha);
    if (arc.glow > 0) {
        // A shadow is about half its colour at the stroke's edge.
        ctx.shadowColor = fade(arc.color, Math.min(1, arc.glow * 2) * arc.alpha);
        ctx.shadowBlur = Math.max(0, arc.reach - 1);
    }
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, arc.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
    ctx.stroke();
    ctx.restore();
}

/** A ring's track, and its glowing arc from the top, clockwise, to where `motion` has it (sweepArc). */
export function ring(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    width: number,
    motion: SweepMotion,
    color: string,
    sink?: ArcSink,
): void {
    ctx.save();
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.strokeStyle = fade(color, 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    sweepArc(ctx, { x, y, r, width, color, alpha: 1, glow: 0.22, reach: 7, motion }, sink);
}

/**
 * A timer's or a pomodoro's ring, as large as `area` allows: its track, and
 * its arc from the top, clockwise, to `progress` (0-1), at `alpha`. Drawn into
 * the picture: it steps with the digits, once a second. Without a progress,
 * the track alone.
 */
export function timeRing(
    ctx: CanvasRenderingContext2D,
    area: Area,
    color: string,
    progress: number | null,
    alpha = 1,
): { cx: number; cy: number; r: number } {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.4;
    const width = Math.max(2, r * 0.12);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.strokeStyle = fade(color, 0.18);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (progress !== null) {
        const motion = { share: progress };
        paintArc(ctx, { x: cx, y: cy, r, width, color, alpha, glow: 0, reach: 0, motion }, 0);
    }
    return { cx, cy, r };
}

export function pauseMark(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
): void {
    ctx.fillStyle = color;
    ctx.fillRect(x - size * 0.55, y - size / 2, size * 0.35, size);
    ctx.fillRect(x + size * 0.2, y - size / 2, size * 0.35, size);
}

const covers = new Map<string, HTMLImageElement>();
/** Pictures kept loaded: a few covers, and a page of voice channels' avatars. */
const COVERS_KEPT = 48;
/**
 * A cover picture or an avatar, once it has loaded; null until then. When one
 * loads, the window hears "decky-art" and draws again.
 */
export function coverImage(url: string): HTMLImageElement | null {
    let image = covers.get(url);
    if (!image) {
        image = new Image();
        image.onload = () => window.dispatchEvent(new Event("decky-art"));
        image.src = url;
        covers.set(url, image);
        if (covers.size > COVERS_KEPT) covers.delete(covers.keys().next().value!);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
}
