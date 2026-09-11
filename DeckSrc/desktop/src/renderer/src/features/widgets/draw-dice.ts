import { diceFaces, diceLabels } from "../../../../shared/widgets";
import type { Widget } from "../../../../shared/widgets";
import { DICE_FEEL, drumRow } from "../../../../shared/wheel-spec";
import {
    CORNER,
    DIE_PIPS,
    DIE_SHARE,
    dieSeen,
    GLOSS,
    PIP_AT,
    PIP_R,
    restingPose,
    unpackPose,
    VIEW_TILT,
} from "../../../../shared/die";
import type { DiePose } from "../../../../shared/die";
import { fitSize, FONT } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import type { WidgetLook, WidgetMoment } from "./draw-widget";

type Dice = Extract<Widget, { type: "dice" }>;

/** A colour (#rrggbb) lit by `light`: 1 as it is, each channel held in range. */
function lit(hex: string, light: number): string {
    const n = parseInt(hex.slice(1, 7), 16);
    const channel = (shift: number): number =>
        Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * light)));
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Pips that show on the die's body: dark on a light one, light on a dark one. */
export function pipColor(body: string): string {
    const n = parseInt(body.slice(1, 7), 16);
    const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return luma > 110 ? "#17150f" : "#f1ede4";
}

/**
 * A die lying still in `pose` on the key `area`: its soft shadow, then each
 * face the eye sees - lit by how it faces the light, a touch darker at its
 * rounded edges - with its pips. The deck draws it the same way (wheel.cpp).
 */
export function drawDie(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    area: Area,
    pose: DiePose,
): void {
    const size = Math.round(DIE_SHARE * Math.min(area.w, area.h));
    const { faces, shadow } = dieSeen(pose, area.w, area.h, size);
    const pip = pipColor(look.color);
    ctx.save();
    ctx.translate(area.x, area.y);
    ctx.save();
    ctx.translate(shadow.x, shadow.y);
    ctx.scale(1, Math.cos(VIEW_TILT));
    ctx.rotate((-pose.yaw * Math.PI) / 180);
    ctx.filter = "blur(1.5px)";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.roundRect(-shadow.half, -shadow.half, shadow.half * 2, shadow.half * 2, shadow.half * 0.35);
    ctx.fill();
    ctx.restore();
    for (const face of faces) {
        ctx.save();
        ctx.transform(face.u[0], face.u[1], face.v[0], face.v[1], face.c[0], face.c[1]);
        ctx.beginPath();
        ctx.roundRect(-1, -1, 2, 2, CORNER);
        // Lighter toward the upper left of the key, as the deck lights it.
        const toward = [face.u[0] + face.u[1], face.v[0] + face.v[1]] as const;
        const length = Math.hypot(toward[0], toward[1]) || 1;
        const reach = (GLOSS * length * 1.5) / (size / 2);
        const gloss = ctx.createLinearGradient(
            (-toward[0] / length) * 1.5,
            (-toward[1] / length) * 1.5,
            (toward[0] / length) * 1.5,
            (toward[1] / length) * 1.5,
        );
        gloss.addColorStop(0, lit(look.color, face.light * (1 + reach)));
        gloss.addColorStop(1, lit(look.color, face.light * (1 - reach)));
        ctx.fillStyle = gloss;
        ctx.fill();
        // The rounded edge turns from the light: a darker rim inside it.
        ctx.clip();
        ctx.lineWidth = 5 / (size / 2);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
        ctx.stroke();
        ctx.fillStyle = lit(pip, 0.55 + 0.45 * face.light);
        for (const [u, v] of DIE_PIPS[face.face]!) {
            ctx.beginPath();
            ctx.arc(u * PIP_AT, v * PIP_AT, PIP_R, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    ctx.restore();
}

/** Where a die lies: as the deck left it, else still in the middle on its face. */
export function diePose(value: number | undefined, rest: number | undefined): DiePose {
    const lying = rest === undefined ? null : unpackPose(rest);
    return lying && lying.face === (value ?? 0) ? lying : unpackPose(restingPose(value ?? 0))!;
}

/** Where a dice drum's words sit: a coin, yes or no, or a list. */
export function diceGeometry(ctx: CanvasRenderingContext2D, widget: Dice, area: Area) {
    const center = Math.round(area.y + area.h / 2);
    const longest = diceFaces(widget).reduce((a, b) => (b.length > a.length ? b : a), "");
    const font = Math.min(
        Math.round(area.h * 0.26),
        fitSize(ctx, longest, Math.round(area.h * 0.26), area.w * 0.86),
    );
    return { row: Math.round(Math.max(font * 1.5, area.h * 0.34)), center, font };
}

/**
 * Dice at rest: a die lying where it stopped, or the side a coin, yes or no,
 * or a list landed on, on the drum the deck spins, its neighbours turned away.
 * The deck draws both the same way.
 */
export function drawDice(
    ctx: CanvasRenderingContext2D,
    widget: Dice,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    if (!moment) return;
    if (widget.mode === "die") {
        drawDie(ctx, look, area, diePose(moment.state?.value, moment.state?.rest));
        return;
    }
    const faces = diceFaces(widget);
    const labels = diceLabels(widget);
    const { row, center, font } = diceGeometry(ctx, widget, area);
    const index = (moment.state?.value ?? 0) + faces.length;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    for (let i = index - 2; i <= index + 2; i++) {
        const value = labels[i];
        const place = drumRow(i - index, row, DICE_FEEL);
        if (value === undefined || !place || place.alpha <= 0) continue;
        ctx.save();
        ctx.translate(area.x + area.w / 2, center + place.offset);
        ctx.scale(1, place.squash);
        ctx.globalAlpha = place.alpha;
        ctx.font = `700 ${font}px ${FONT}`;
        ctx.fillStyle = look.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(faces[value]!, 0, 0);
        ctx.restore();
    }
    ctx.restore();
}
