/*---------------------------------------------------------------
 * What Discord's keys draw alike besides the key's own icon (key-glyph.ts):
 * people's avatars, small capitals, and Discord's colours.
 *--------------------------------------------------------------*/

import type { VoiceMember } from "../../../../../../shared/widgets/discord";
import { clip, coverImage, fade, FONT } from "../../canvas-kit";
import type { WidgetLook } from "../../draw-widget";

/** Discord's own green: you are in the call; someone speaks. */
export const IN_CALL = "#23a55a";
/** Discord's red, for what came in unread. */
export const UNREAD = "#f23f43";

/** Small letter-spaced capitals, centred on `x`, cut short where they would pass `width`. */
export function caps(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    width: number,
    color: string,
): void {
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.letterSpacing = `${(size * 0.12).toFixed(1)}px`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(clip(ctx, text.toUpperCase(), width), x, y);
    ctx.letterSpacing = "0px";
}

/** One person, round, `d` across: their avatar, or their initial until it has come. */
export function avatar(
    ctx: CanvasRenderingContext2D,
    person: Pick<VoiceMember, "name" | "avatar">,
    x: number,
    y: number,
    d: number,
    look: WidgetLook,
): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    ctx.clip();
    const image = person.avatar ? coverImage(person.avatar) : null;
    if (image) ctx.drawImage(image, x - d / 2, y - d / 2, d, d);
    else {
        ctx.fillStyle = fade(look.color, 0.16);
        ctx.fillRect(x - d / 2, y - d / 2, d, d);
        ctx.fillStyle = fade(look.color, 0.8);
        ctx.font = `600 ${Math.round(d * 0.46)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(Array.from(person.name.trim())[0]?.toUpperCase() ?? "?", x, y + d * 0.03);
    }
    ctx.restore();
}
