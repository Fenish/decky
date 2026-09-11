import type { WidgetState } from "../../../../../../shared/widgets";
import { armedSeconds, OBS_ARM_S, obsRunTime } from "../../../../../../shared/widgets/obs";
import type { ObsState } from "../../../../../../shared/widgets/obs";
import { bigText, fade, FONT, GREY, ring, SLOW, strike } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";

/** A studio's on-air red, and the amber of an output held (paused, reconnecting). */
const ON_AIR = "#ff453a";
const HELD = SLOW;

/** How an output's key shows it: its glyph, and its tag on the badge (REC, LIVE). */
export interface ObsFace {
    glyph: "record" | "broadcast";
    tag: string;
}

/** m:ss, or h:mm:ss from an hour on. */
function clock(ms: number): string {
    const total = Math.floor(ms / 1000);
    const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    const two = (n: number): string => String(n).padStart(2, "0");
    return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Small letter-spaced capitals, centred on `x`. */
function caps(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
): void {
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.letterSpacing = `${(size * 0.14).toFixed(1)}px`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.letterSpacing = "0px";
}

/** The output's glyph at (x, y), `r` across its half: a record button, or a broadcast mast. */
const GLYPHS: Record<
    ObsFace["glyph"],
    (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        r: number,
        color: string,
        dot: string,
    ) => void
> = {
    record: (ctx, x, y, r, color, dot) => {
        ctx.lineWidth = Math.max(1.5, r * 0.14);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.52, 0, Math.PI * 2);
        ctx.fill();
    },
    broadcast: (ctx, x, y, r, color, dot) => {
        ctx.lineWidth = Math.max(1.5, r * 0.14);
        ctx.lineCap = "round";
        ctx.strokeStyle = color;
        for (const reach of [0.58, 1]) {
            for (const side of [0, Math.PI]) {
                ctx.beginPath();
                ctx.arc(x, y, r * reach, side - 0.75, side + 0.75);
                ctx.stroke();
            }
        }
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
    },
};

/** The badge at the top of a running key: a pill in `color`, its tag in white. */
function badge(
    ctx: CanvasRenderingContext2D,
    face: ObsFace,
    area: Area,
    color: string,
    lit: boolean,
): void {
    const size = Math.round(area.h * 0.12);
    const y = area.y + area.h * 0.2;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.letterSpacing = `${(size * 0.12).toFixed(1)}px`;
    const text = face.tag;
    const dot = face.glyph === "record" ? size * 0.3 : 0;
    const w = ctx.measureText(text).width + size * 1.1 + (dot ? dot * 2 + size * 0.35 : 0);
    const h = size * 1.7;
    const x = area.x + (area.w - w) / 2;
    ctx.globalAlpha = lit ? 1 : 0.72;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    let left = x + size * 0.55;
    if (dot) {
        ctx.beginPath();
        ctx.arc(left + dot, y, dot, 0, Math.PI * 2);
        ctx.fill();
        left += dot * 2 + size * 0.35;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, left, y + size * 0.04);
    ctx.textAlign = "center";
    ctx.letterSpacing = "0px";
}

/** A running key's glow: the whole area washed in `color`, brightest in the middle, framed. */
function tally(ctx: CanvasRenderingContext2D, area: Area, color: string): void {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(area.w, area.h) * 0.72);
    glow.addColorStop(0, fade(color, 0.3));
    glow.addColorStop(1, fade(color, 0.08));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.roundRect(area.x + 2, area.y + 2, area.w - 4, area.h - 4, 10);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = fade(color, 0.75);
    ctx.stroke();
}

type Phase = "idle" | "unreachable" | "arming" | "running";

function phaseOf(state: WidgetState | undefined, now: number): Phase {
    const obs = state?.obs;
    if (!obs) return "idle";
    if (obs.health !== "ready") return "unreachable";
    if (armedSeconds(state, now) !== null) return "arming";
    return obs.active ? "running" : "idle";
}

/** Each phase drawn: the key's picture for it, below its caption. */
const PHASES: Record<
    Phase,
    (
        ctx: CanvasRenderingContext2D,
        face: ObsFace,
        look: WidgetLook,
        area: Area,
        moment: WidgetMoment,
    ) => void
> = {
    // Its glyph and its name: a button waiting to be pressed.
    idle: (ctx, face, look, area) => {
        const cx = area.x + area.w / 2;
        const r = Math.min(area.w, area.h) * 0.2;
        GLYPHS[face.glyph](
            ctx,
            cx,
            area.y + area.h * 0.42,
            r,
            fade(look.color, 0.45),
            fade(ON_AIR, 0.55),
        );
        caps(
            ctx,
            face.tag,
            cx,
            area.y + area.h * 0.8,
            Math.round(area.h * 0.11),
            fade(look.color, 0.6),
        );
    },
    // Out of reach, whatever the reason (OBS's card in the app says which): the
    // idle key greyed, a slash through its glyph - cut from it by a gap in the
    // key's background, as a muted icon's is.
    unreachable: (ctx, face, look, area) => {
        const cx = area.x + area.w / 2;
        const cy = area.y + area.h * 0.42;
        const r = Math.min(area.w, area.h) * 0.2;
        GLYPHS[face.glyph](ctx, cx, cy, r, fade(GREY, 0.4), fade(GREY, 0.32));
        caps(ctx, face.tag, cx, area.y + area.h * 0.8, Math.round(area.h * 0.11), fade(GREY, 0.5));
        strike(ctx, cx, cy, r * 0.864, Math.max(1.5, r * 0.14), look.background, 3);
    },
    // What happens when it runs out, the seconds left in a ring that drains
    // with the clock (on the deck, smoothly), and how to call it off.
    arming: (ctx, face, look, area, moment) => {
        const { state, now } = moment;
        const { until, start } = state!.arming!;
        const color = start ? ON_AIR : HELD;
        const cx = area.x + area.w / 2;
        const cy = area.y + area.h * 0.5;
        const r = Math.min(area.w, area.h) * 0.25;
        const size = Math.round(area.h * 0.095);
        caps(
            ctx,
            `${start ? "start" : "stop"} ${face.tag}`,
            cx,
            area.y + area.h * 0.12,
            size,
            color,
        );
        const drain = { zero: until, turn: -OBS_ARM_S * 1000, round: false };
        ring(ctx, cx, cy, r, Math.max(3, r * 0.16), drain, color, moment);
        ctx.font = `700 ${Math.round(r * 1.15)}px ${FONT}`;
        ctx.fillStyle = look.color;
        ctx.textBaseline = "middle";
        ctx.fillText(String(armedSeconds(state, now)), cx, cy + r * 0.05);
        ctx.font = `600 ${size}px ${FONT}`;
        ctx.fillStyle = fade(look.color, 0.5);
        ctx.fillText("tap to cancel", cx, area.y + area.h * 0.9);
    },
    // On air: the key glows, its badge on top, the time it has run large; amber while held.
    running: (ctx, face, look, area, { state, now }) => {
        const obs: ObsState = state!.obs!;
        const held = obs.paused || obs.reconnecting;
        const color = held ? HELD : ON_AIR;
        tally(ctx, area, color);
        // The badge breathes with each second, as a camera's tally light.
        const lit = held || Math.floor(obsRunTime(obs, now) / 1000) % 2 === 0;
        badge(
            ctx,
            obs.paused ? { ...face, tag: "PAUSED", glyph: "broadcast" } : face,
            area,
            color,
            lit,
        );
        const time = clock(obsRunTime(obs, now));
        bigText(
            ctx,
            time,
            held ? fade(look.color, 0.7) : look.color,
            area,
            0.27,
            700,
            area.y + area.h * 0.58,
        );
        if (obs.reconnecting)
            caps(
                ctx,
                "reconnecting",
                area.x + area.w / 2,
                area.y + area.h * 0.86,
                Math.round(area.h * 0.085),
                HELD,
            );
    },
};

/**
 * An OBS output's key. Without a moment it is its base picture, time-free as
 * base pictures are: the output waiting to be started.
 */
export function drawObs(
    ctx: CanvasRenderingContext2D,
    face: ObsFace,
    look: WidgetLook,
    area: Area,
    moment: WidgetMoment = { state: undefined, now: 0 },
): void {
    ctx.save();
    PHASES[phaseOf(moment.state, moment.now)](ctx, face, look, area, moment);
    ctx.restore();
}
