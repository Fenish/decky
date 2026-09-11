import type { DiscordNotificationsWidget } from "../../../../../../shared/widgets/discord";
import { kindOf } from "../../../../../../shared/widgets/registry";
import { fade, FONT } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";
import { iconSize, keyGlyph, unreachable } from "../../key-glyph";
import { avatar, caps, UNREAD } from "./discord-kit";

/**
 * The notifications key. With some come since the last tap, the last one's
 * sender - their avatar, their name - and Discord's red badge with how many.
 * With none, the key's own icon in its colour; with Discord out of reach, or
 * its permission lacking notifications, that icon greyed and struck through.
 */
export function drawInbox(
    ctx: CanvasRenderingContext2D,
    widget: DiscordNotificationsWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    ctx.save();
    const inbox = moment?.state?.inbox;
    const glyph = kindOf(widget).icon;
    const cx = area.x + area.w / 2;
    if (inbox && inbox.health !== "ready")
        unreachable(ctx, look, glyph, cx, area.y + area.h / 2, iconSize(look, area));
    else if (!inbox?.from || inbox.unread === 0)
        keyGlyph(ctx, look, glyph, cx, area.y + area.h / 2, iconSize(look, area));
    else {
        const size = Math.min(area.w, area.h);
        const d = size * 0.58;
        const cy = area.y + area.h * 0.42;
        avatar(ctx, inbox.from, cx, cy, d, look);
        caps(
            ctx,
            inbox.from.name,
            cx,
            area.y + area.h * 0.87,
            Math.round(area.h * 0.1),
            area.w * 0.9,
            fade(look.color, 0.6),
        );
        // The badge on the avatar's shoulder, as Discord puts it: a rim of the key's background round it.
        const count = inbox.unread > 99 ? "99+" : String(inbox.unread);
        const h = size * 0.26;
        ctx.font = `800 ${Math.round(h * 0.66)}px ${FONT}`;
        const w = Math.max(h, ctx.measureText(count).width + h * 0.55);
        const bx = Math.min(cx + d * 0.36 + w / 2 - h / 2, area.x + area.w - w / 2 - 3);
        const by = cy - d * 0.36;
        ctx.fillStyle = look.background;
        ctx.beginPath();
        ctx.roundRect(bx - w / 2 - 2.5, by - h / 2 - 2.5, w + 5, h + 5, (h + 5) / 2);
        ctx.fill();
        ctx.fillStyle = UNREAD;
        ctx.beginPath();
        ctx.roundRect(bx - w / 2, by - h / 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(count, bx, by + h * 0.04);
    }
    ctx.restore();
}
