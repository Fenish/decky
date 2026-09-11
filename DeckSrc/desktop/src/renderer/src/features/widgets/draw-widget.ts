import {
    clockParts,
    daysUntil,
    formatDuration,
    hasWheel,
    pomodoroView,
    runTime,
    timerSeconds,
    timerView,
    wheelValues,
} from "../../../../shared/widgets";
import { drumRow, WHEEL_FEEL } from "../../../../shared/wheel-spec";
import type { SlideLine } from "../../../../shared/slide-spec";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { drawMedia, drawMic, drawVolume } from "./draw-sound";
import { drawCrypto, drawSystem } from "./draw-meters";
import { drawDice } from "./draw-dice";

/** The key's own colours and caption, which every widget style follows. */
export interface WidgetLook {
    background: string;
    color: string;
    label: string;
}

/** What only a running widget knows. Absent, the widget draws its base picture. */
export interface WidgetMoment {
    state: WidgetState | undefined;
    now: number;
    /**
     * Where the deck slides text too long for its key along (slide=1): such
     * lines go here instead of onto the picture. Without it they are cut
     * short with an ellipsis.
     */
    slides?: SlideLine[];
}

const FONT = '"Segoe UI Variable Display", "Segoe UI", sans-serif';
export const WIDGET_FONT = FONT;
const UP = "#7fd49a";
const DOWN = "#ff7a6e";
const REST = "#9fd7b8";

/**
 * Draw a widget key.
 *
 * Without `moment` it draws only what its settings decide - the face of an
 * analog clock, a note - and nothing that depends on the time or on state.
 * Page uploads use that base picture, so the page's checksum stays the same
 * from one launch to the next and the deck's cache keeps matching; the live
 * parts arrive as patches once the page is on screen.
 */
export function drawWidget(
    ctx: CanvasRenderingContext2D,
    widget: Widget,
    look: WidgetLook,
    w: number,
    h: number,
    moment?: WidgetMoment,
): void {
    ctx.save();
    paintKey(ctx, look, w, h);
    const area = widgetArea(look, w, h);
    switch (widget.type) {
        case "clock":
            drawClock(ctx, widget, look, area, moment);
            break;
        case "timer":
            drawTimer(ctx, widget, look, area, moment);
            break;
        case "pomodoro":
            drawPomodoro(ctx, widget, look, area, moment);
            break;
        case "countdown":
            drawCountdown(ctx, widget, look, area, moment);
            break;
        case "counter":
            if (moment) {
                const value = moment.state?.value ?? widget.start;
                bigText(ctx, String(value), look.color, area, 0.42, 700);
            }
            break;
        case "ping":
            drawPing(ctx, widget, look, area, moment);
            break;
        case "note":
            drawNote(ctx, widget, look, area);
            break;
        case "volume":
            drawVolume(ctx, widget, look, area, moment);
            break;
        case "mic":
            drawMic(ctx, look, area, moment);
            break;
        case "media":
            drawMedia(ctx, widget, look, area, moment);
            break;
        case "system":
            drawSystem(ctx, widget, look, area, moment);
            break;
        case "crypto":
            drawCrypto(ctx, widget, look, area, moment);
            break;
        case "dice":
            drawDice(ctx, widget, look, area, moment);
            break;
    }
    ctx.restore();
}

export interface Area {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The key under any widget: its background, and its caption at the top. */
export function paintKey(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    w: number,
    h: number,
): void {
    ctx.fillStyle = look.background;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const caption = look.label.trim();
    if (caption) {
        ctx.fillStyle = fade(look.color, 0.7);
        ctx.font = `600 ${Math.round(h * 0.1)}px ${FONT}`;
        ctx.fillText(caption, w / 2, h * 0.12, w * 0.9);
    }
}

/** Where a widget draws: all of the key, or below its caption. */
export function widgetArea(look: WidgetLook, w: number, h: number): Area {
    const top = look.label.trim() ? h * 0.2 : 0;
    return { x: 0, y: top, w, h: h - top };
}

/** A wheel's rows in its area: the label spacing at the band, and the band's middle. */
export function wheelGeometry(area: Area): { row: number; center: number } {
    return { row: Math.round(area.h * 0.3), center: Math.round(area.y + area.h / 2) };
}

/**
 * The wheel's two font sizes: minutes and seconds large, hours (six
 * characters and up) as large as the longest still fits.
 */
export function wheelFonts(
    ctx: CanvasRenderingContext2D,
    area: Area,
    row: number,
): [number, number] {
    const room = area.w * 0.88;
    const fit = (size: number, text: string): number => {
        ctx.font = `650 ${size}px ${FONT}`;
        const width = ctx.measureText(text).width;
        return width > room ? Math.floor((size * room) / width) : size;
    };
    const large = fit(Math.round(row * 0.8), "59:59");
    return [large, fit(large, "3:00:00")];
}

/** A colour at some opacity, from "#rrggbb". */
function fade(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Text as large as fits: `share` of the area's height, shrunk to its width. */
function bigText(
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

function drawClock(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "clock" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (widget.style === "analog") {
        drawAnalog(ctx, widget, look, area, moment);
        return;
    }
    if (!moment) return;
    const parts = clockParts(widget, moment.now);
    if (widget.style === "minimal") {
        // Hours over minutes, large, the minutes a shade quieter.
        const minutes = String(parts.minutes).padStart(2, "0");
        const half = { ...area, h: area.h / 2 };
        bigText(ctx, parts.hour, look.color, half, 0.9, 700, area.y + area.h * 0.3);
        bigText(ctx, minutes, fade(look.color, 0.55), half, 0.9, 700, area.y + area.h * 0.72);
        if (widget.hour12) {
            ctx.font = `600 ${Math.round(area.h * 0.1)}px ${FONT}`;
            ctx.fillStyle = fade(look.color, 0.55);
            ctx.textAlign = "right";
            ctx.fillText(parts.period, area.x + area.w * 0.95, area.y + area.h * 0.9);
            ctx.textAlign = "center";
        }
        return;
    }
    // Digital: the time, the period under it for 12-hour, the date below.
    const withDate = widget.date;
    const timeY = area.y + area.h * (withDate ? 0.42 : 0.5);
    bigText(ctx, parts.time, look.color, area, widget.seconds ? 0.24 : 0.32, 650, timeY);
    const small = Math.round(area.h * 0.11);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    const below = [widget.hour12 ? parts.period : "", withDate ? parts.date : ""]
        .filter(Boolean)
        .join("  ·  ");
    if (below) ctx.fillText(below, area.x + area.w / 2, area.y + area.h * 0.72, area.w * 0.92);
}

function drawAnalog(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "clock" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.42;
    // The face: twelve marks, the quarters longer.
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const quarter = i % 3 === 0;
        const inner = r * (quarter ? 0.78 : 0.86);
        ctx.strokeStyle = fade(look.color, quarter ? 0.9 : 0.45);
        ctx.lineWidth = Math.max(1, r * (quarter ? 0.07 : 0.04));
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(angle) * inner, cy - Math.cos(angle) * inner);
        ctx.lineTo(cx + Math.sin(angle) * r, cy - Math.cos(angle) * r);
        ctx.stroke();
    }
    if (moment) {
        const { hours, minutes, seconds } = clockParts(widget, moment.now);
        const hand = (turn: number, length: number, width: number, color: string): void => {
            const angle = turn * Math.PI * 2;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(cx - Math.sin(angle) * r * 0.12, cy + Math.cos(angle) * r * 0.12);
            ctx.lineTo(cx + Math.sin(angle) * r * length, cy - Math.cos(angle) * r * length);
            ctx.stroke();
        };
        const secondTurn = widget.seconds ? seconds / 60 : 0;
        hand(((hours % 12) + minutes / 60) / 12, 0.5, r * 0.11, look.color);
        hand((minutes + secondTurn) / 60, 0.74, r * 0.07, look.color);
        if (widget.seconds) hand(seconds / 60, 0.82, Math.max(1, r * 0.03), DOWN);
    }
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
}

/** A ring's track, and its arc from the top clockwise to `progress`. */
function ring(
    ctx: CanvasRenderingContext2D,
    area: Area,
    color: string,
    progress: number | null,
): { cx: number; cy: number; r: number } {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const r = Math.min(area.w, area.h) * 0.4;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.lineCap = "round";
    ctx.strokeStyle = fade(color, 0.18);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (progress !== null && progress > 0) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
        ctx.stroke();
    }
    return { cx, cy, r };
}

function pauseMark(
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

/**
 * An adjustable countdown at rest: its times on a drum, the one it will run
 * in the band - shorter above, longer below, so a swipe up rolls more time
 * in. The deck draws and turns the same drum by itself, with drumRow's sums
 * (firmware/src/wheel.cpp); this is its picture at rest. The band is in the
 * base picture too; the times are not.
 */
function drawWheel(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "timer" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const { row, center } = wheelGeometry(area);
    ctx.fillStyle = fade(look.color, 0.1);
    ctx.beginPath();
    ctx.roundRect(area.x + area.w * 0.08, center - row / 2, area.w * 0.84, row, row * 0.25);
    ctx.fill();
    if (!moment) return;
    const values = wheelValues(widget);
    const index = values.indexOf(timerSeconds(widget, moment.state));
    const [large, small] = wheelFonts(ctx, area, row);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.fillStyle = look.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = Math.max(0, index - 3); i <= Math.min(values.length - 1, index + 3); i++) {
        const place = drumRow(i - index, row, WHEEL_FEEL);
        if (!place || place.alpha <= 0) continue;
        const text = formatDuration(values[i]! * 1000);
        ctx.save();
        ctx.translate(area.x + area.w / 2, center + place.offset);
        ctx.scale(1, place.squash);
        ctx.globalAlpha = place.alpha;
        ctx.font = `650 ${text.length > 5 ? small : large}px ${FONT}`;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

function drawTimer(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "timer" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    // An adjustable countdown shows its wheel until it has run at all.
    if (hasWheel(widget) && (!moment || runTime(moment.state, moment.now) === 0)) {
        drawWheel(ctx, widget, look, area, moment);
        return;
    }
    if (!moment) {
        ring(ctx, area, look.color, null);
        return;
    }
    const view = timerView(widget, moment.state, moment.now);
    const running = Boolean(moment.state?.running);
    // A stopwatch sweeps once a minute; a countdown shows how much has gone.
    const progress =
        widget.mode === "stopwatch"
            ? (runTime(moment.state, moment.now) % 60_000) / 60_000
            : view.progress;
    const color = view.done ? DOWN : look.color;
    const { cy, r } = ring(ctx, area, running || view.done ? color : fade(color, 0.5), progress);
    const inner = { x: area.x + area.w * 0.2, y: cy - r * 0.5, w: area.w * 0.6, h: r };
    bigText(ctx, view.text, color, inner, 0.62, 650, cy);
    if (!running && !view.done && runTime(moment.state, moment.now) > 0)
        pauseMark(ctx, area.x + area.w / 2, cy + r * 0.55, r * 0.22, fade(look.color, 0.7));
}

function drawPomodoro(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "pomodoro" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (!moment) {
        ring(ctx, area, look.color, null);
        return;
    }
    const view = pomodoroView(widget, moment.state, moment.now);
    const running = Boolean(moment.state?.running);
    const color = view.phase === "focus" ? look.color : REST;
    const { cx, cy, r } = ring(ctx, area, running ? color : fade(color, 0.5), view.progress);
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

function drawCountdown(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "countdown" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const title = widget.title.trim();
    const small = Math.round(area.h * 0.12);
    if (title) {
        ctx.fillStyle = fade(look.color, 0.7);
        ctx.font = `600 ${small}px ${FONT}`;
        ctx.fillText(title, area.x + area.w / 2, area.y + area.h * 0.18, area.w * 0.9);
    }
    if (!moment) return;
    const days = daysUntil(widget.date, moment.now);
    const middle = area.y + area.h * (title ? 0.52 : 0.44);
    if (days === 0) {
        bigText(ctx, "Today", look.color, area, 0.3, 700, middle);
        return;
    }
    bigText(ctx, String(Math.abs(days)), look.color, area, 0.42, 700, middle);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    const unit = Math.abs(days) === 1 ? "day" : "days";
    ctx.fillText(days > 0 ? unit : `${unit} ago`, area.x + area.w / 2, area.y + area.h * 0.84);
}

/** Round trips this fast are green, then amber; slower ones and none are red. */
const QUICK_MS = 100;
const SLOW_MS = 250;
const SLOW = "#f2c46d";

function drawPing(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "ping" }>,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    const cx = area.x + area.w / 2;
    const small = Math.round(area.h * 0.11);
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.font = `600 ${small}px ${FONT}`;
    ctx.fillText(widget.host, cx, area.y + area.h * 0.86, area.w * 0.9);
    if (!moment) return;
    const middle = area.y + area.h * 0.4;
    const state = moment.state;
    if (state?.up === undefined) {
        bigText(ctx, "…", fade(look.color, 0.4), area, 0.4, 700, middle);
        return;
    }
    const ms = state.up ? (state.ms ?? 0) : null;
    const colour = ms === null || ms >= SLOW_MS ? DOWN : ms >= QUICK_MS ? SLOW : UP;
    const value = ms === null ? "—" : ms < 1 ? "<1" : String(ms);
    bigText(ctx, value, ms === null ? DOWN : look.color, area, 0.4, 700, middle);
    // Under it, a dot in the answer's colour and the unit.
    const unit = ms === null ? "no reply" : "ms";
    ctx.font = `600 ${small}px ${FONT}`;
    const r = small * 0.32;
    const left = cx - (ctx.measureText(unit).width + r * 3.6) / 2;
    const y = area.y + area.h * 0.66;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(left + r, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fade(look.color, 0.6);
    ctx.textAlign = "left";
    ctx.fillText(unit, left + r * 3.6, y);
    ctx.textAlign = "center";
}

function drawNote(
    ctx: CanvasRenderingContext2D,
    widget: Extract<Widget, { type: "note" }>,
    look: WidgetLook,
    area: Area,
): void {
    const share = { small: 0.13, medium: 0.17, large: 0.24 }[widget.size];
    const size = Math.round(Math.min(area.w, area.h) * share);
    ctx.fillStyle = look.color;
    ctx.font = `600 ${size}px ${FONT}`;
    const width = area.w * 0.86;
    const lines: string[] = [];
    for (const paragraph of widget.text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > width && line) {
                lines.push(line);
                line = word;
            } else line = next;
        }
        lines.push(line);
    }
    const height = size * 1.2;
    const fits = Math.max(1, Math.floor((area.h * 0.9) / height));
    const shown = lines.slice(0, fits);
    const start = area.y + area.h / 2 - ((shown.length - 1) * height) / 2;
    shown.forEach((line, index) =>
        ctx.fillText(line, area.x + area.w / 2, start + index * height, width),
    );
}
