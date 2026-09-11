/*---------------------------------------------------------------
 * The face of a key that cycles through options (shared/widgets/choice.ts):
 * the key's own icon, the option chosen under it, and a dot for each option,
 * the chosen one lit. Any widget whose state is a choice draws it: Discord's
 * microphone and output switchers.
 *--------------------------------------------------------------*/

import type { Choice } from "../../../../shared/widgets/choice";
import { clip, fade, FONT, write } from "./canvas-kit";
import type { Area } from "./canvas-kit";
import type { WidgetLook, WidgetMoment } from "./draw-widget";
import { iconSize, keyGlyph, unreachable } from "./key-glyph";
import { slideLine } from "./slide";

/** Past this many options, no dots: too many to count at a glance. */
const DOTS_MAX = 8;

/**
 * An option's name as Windows gives a device's, "Microphone (HyperX Cloud II)":
 * what it is (Microphone), and which (HyperX Cloud II) - the part that tells
 * them apart, shown large. A name without brackets is all "which".
 */
function nameParts(name: string): { which: string; what: string } {
    const parts = /^(.*?)\s*\((.+)\)\s*$/.exec(name);
    return parts?.[1] && parts[2] ? { which: parts[2], what: parts[1] } : { which: name, what: "" };
}

/**
 * A choice key: `glyph` is its kind's icon, for a key with none of its own.
 * Out of reach, the icon greyed and struck through; with nothing chosen yet -
 * or without a moment, as its base picture - the icon alone.
 */
export function drawChoice(
    ctx: CanvasRenderingContext2D,
    look: WidgetLook,
    area: Area,
    glyph: string,
    moment?: WidgetMoment,
): void {
    ctx.save();
    const choice: Choice | undefined = moment?.state?.choice;
    const cx = area.x + area.w / 2;
    if (choice && !choice.reachable)
        unreachable(ctx, look, glyph, cx, area.y + area.h / 2, iconSize(look, area));
    else if (!choice?.name)
        keyGlyph(ctx, look, glyph, cx, area.y + area.h / 2, iconSize(look, area));
    else {
        const { which, what } = nameParts(choice.name);
        const dots = choice.count > 1 && choice.count <= DOTS_MAX;
        keyGlyph(ctx, look, glyph, cx, area.y + area.h * 0.28, iconSize(look, area, 0.3));
        // The name that tells it apart: drawn if it fits, else slid along on the deck.
        const size = Math.round(area.h * 0.125);
        const middle = area.y + area.h * (what ? 0.6 : 0.64);
        const room: Area = { x: area.x + area.w * 0.06, y: area.y, w: area.w * 0.88, h: area.h };
        ctx.font = `650 ${size}px ${FONT}`;
        ctx.textBaseline = "middle";
        if (moment?.slides && ctx.measureText(which).width > room.w)
            moment.slides.push(slideLine(ctx, which, size, 650, room, middle, look.color));
        else write(ctx, clip(ctx, which, room.w), cx, middle, size, look.color, 650);
        if (what) {
            const small = Math.round(area.h * 0.09);
            ctx.font = `600 ${small}px ${FONT}`;
            write(
                ctx,
                clip(ctx, what, room.w),
                cx,
                area.y + area.h * 0.76,
                small,
                fade(look.color, 0.55),
                600,
            );
        }
        if (dots) {
            const r = Math.max(1.5, area.h * 0.02);
            const gap = r * 3.2;
            const left = cx - (gap * (choice.count - 1)) / 2;
            for (let i = 0; i < choice.count; i++) {
                ctx.fillStyle = i === choice.index ? look.color : fade(look.color, 0.25);
                ctx.beginPath();
                ctx.arc(left + i * gap, area.y + area.h * 0.9, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.restore();
}
