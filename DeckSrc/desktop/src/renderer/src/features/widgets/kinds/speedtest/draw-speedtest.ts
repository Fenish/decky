/*---------------------------------------------------------------
 * A speed test on its key: at rest the last result, and while it runs an arc
 * the deck sweeps itself - round and round while it looks for a server, then
 * once through the download and once through the upload - with the speed so
 * far in the middle.
 *--------------------------------------------------------------*/

import type { WidgetState } from "../../../../../../shared/widgets";
import { SPEED_MS, speedFigure, speedShare } from "../../../../../../shared/widgets/speedtest";
import type { SpeedRun } from "../../../../../../shared/widgets/speedtest";
import type { SweepMotion } from "../../../../../../shared/sweep-spec";
import { bigText, clip, fade, FONT, GREY, ring, SLOW, TEAL, write } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/** Down and up have a colour each, on the arc and against the figures. */
const DOWN_COLOR = TEAL;
const UP_COLOR = SLOW;

/** A run's colour: whichever way it is going now, or the accent at rest. */
function phaseColor(run: SpeedRun | undefined, look: WidgetLook): string {
    if (run?.phase === "down") return DOWN_COLOR;
    if (run?.phase === "up") return UP_COLOR;
    return look.color;
}

/** The ring goes round while a server is looked for: the deck turns it itself. */
function spin(run: SpeedRun): SweepMotion {
    return { zero: run.since, turn: 1400, round: true };
}

/** Where the dial sits, and how large. */
function dial(area: Area): { cx: number; cy: number; r: number } {
    return {
        cx: area.x + area.w / 2,
        cy: area.y + area.h * 0.5,
        r: Math.min(area.w, area.h) * 0.38,
    };
}

/**
 * The dial: an arc open at the bottom, as the volume's is, filled to `share`
 * of its 270°. It follows the speed, not the clock, so the key moves the way
 * a speed test's needle does.
 */
function needle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    share: number,
    color: string,
    ground: string,
): void {
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const width = Math.max(2.5, r * 0.185);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    ctx.strokeStyle = fade(ground, 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + sweep);
    ctx.stroke();
    if (share > 0) {
        ctx.strokeStyle = color;
        ctx.shadowColor = fade(color, 0.55);
        ctx.shadowBlur = width;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + sweep * Math.min(1, share));
        ctx.stroke();
    }
    ctx.restore();
}

/** A triangle: down for what arrives, up for what leaves. */
function arrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    down: boolean,
    color: string,
): void {
    const half = size / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - half, y + (down ? -half : half));
    ctx.lineTo(x + half, y + (down ? -half : half));
    ctx.lineTo(x, y + (down ? half : -half));
    ctx.closePath();
    ctx.fill();
}

/** One figure with its arrow: "▼ 94.3". */
function reading(
    ctx: CanvasRenderingContext2D,
    area: Area,
    y: number,
    mbps: number | undefined,
    down: boolean,
    color: string,
    size: number,
): void {
    const text = mbps === undefined ? "—" : speedFigure(mbps);
    ctx.font = `700 ${size}px ${FONT}`;
    const width = ctx.measureText(text).width;
    const mark = size * 0.5;
    const left = area.x + area.w / 2 - (width + mark * 1.6) / 2;
    arrow(ctx, left + mark / 2, y, mark, down, color);
    write(ctx, text, left + mark * 1.6 + width / 2, y, size, color, 700);
}

export function drawSpeedtest(
    ctx: CanvasRenderingContext2D,
    _widget: unknown,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const state: WidgetState | undefined = moment?.state;
    const run = state?.speed;
    const middle = area.y + area.h / 2;
    // Its base picture, and a key that has never been run: the gauge alone.
    if (!run) {
        gauge(ctx, area.x + area.w / 2, middle, Math.min(area.w, area.h) * 0.3, look.color);
        write(
            ctx,
            "Speed test",
            area.x + area.w / 2,
            area.y + area.h * 0.86,
            Math.round(area.h * 0.13),
            fade(look.color, 0.6),
            600,
        );
        return;
    }
    // Looking for a server: a ring the deck turns by itself, since there is
    // nothing to measure yet.
    if (run.phase === "ping") {
        const { cx, cy, r } = dial(area);
        ring(ctx, cx, cy, r, Math.max(2, r * 0.13), spin(run), look.color, moment);
        write(ctx, "Finding", cx, cy - r * 0.22, Math.round(area.h * 0.13), look.color, 650);
        write(
            ctx,
            "a server",
            cx,
            cy + r * 0.28,
            Math.round(area.h * 0.115),
            fade(look.color, 0.5),
            600,
        );
        return;
    }
    if (run.phase === "down" || run.phase === "up") {
        const color = phaseColor(run, look);
        const { cx, cy, r } = dial(area);
        const mbps = run.now ?? 0;
        needle(ctx, cx, cy, r, speedShare(mbps), color, look.color);
        // Which way, then the speed itself, as large as the dial allows.
        write(
            ctx,
            run.phase === "down" ? "DOWN" : "UP",
            cx,
            cy - r * 0.55,
            Math.round(area.h * 0.1),
            fade(look.color, 0.6),
            700,
        );
        bigText(
            ctx,
            speedFigure(mbps),
            color,
            { x: area.x, y: cy - r * 0.42, w: area.w, h: r * 0.84 },
            0.72,
            700,
        );
        write(ctx, "Mbps", cx, cy + r * 0.62, Math.round(area.h * 0.1), fade(look.color, 0.5), 600);
        return;
    }
    if (run.phase === "failed") {
        const size = Math.round(area.h * 0.15);
        ctx.font = `700 ${size}px ${FONT}`;
        write(
            ctx,
            clip(ctx, run.message ?? "Failed", area.w * 0.9),
            area.x + area.w / 2,
            middle - area.h * 0.06,
            size,
            fade(GREY, 0.9),
            700,
        );
        write(
            ctx,
            "Tap to try again",
            area.x + area.w / 2,
            middle + area.h * 0.16,
            Math.round(area.h * 0.11),
            fade(look.color, 0.5),
            600,
        );
        return;
    }
    // Done: what the line does, each way, with the ping under it.
    const size = Math.round(area.h * 0.23);
    reading(ctx, area, middle - area.h * 0.17, run.down, true, DOWN_COLOR, size);
    reading(ctx, area, middle + area.h * 0.09, run.up, false, UP_COLOR, size);
    write(
        ctx,
        `${run.ping === undefined ? "—" : Math.round(run.ping)} ms`,
        area.x + area.w / 2,
        area.y + area.h * 0.88,
        Math.round(area.h * 0.115),
        fade(look.color, 0.55),
        600,
    );
}

/** A speedometer: a dial with a needle. */
function gauge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.strokeStyle = fade(color, 0.35);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.85, Math.PI * 2.15);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.85, Math.PI * 1.35);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.72 * Math.cos(Math.PI * 1.72), y + r * 0.72 * Math.sin(Math.PI * 1.72));
    ctx.stroke();
    ctx.restore();
}

/** Made-up readings for the style tiles in the editor. */
export function speedSample(now: number): WidgetState {
    return {
        speed: { phase: "done", since: now - SPEED_MS, down: 94.3, up: 41.2, ping: 8, at: now },
    };
}
