import type {
    VoiceLayout,
    VoiceMember,
    VoiceWidget,
} from "../../../../../../shared/widgets/discord";
import { kindOf } from "../../../../../../shared/widgets/registry";
import { fade, FONT, GREY } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook, WidgetMoment } from "../../draw-widget";
import { iconSize, keyGlyph, unreachable } from "../../key-glyph";
import { avatar, caps, IN_CALL } from "./discord-kit";

/** Avatars a key shows; past this many, the last place says how many more. */
const PLACES = 4;
/** The band the channel's name takes at the bottom, of the key's area. */
const NAME_BAND = 0.24;

type Spot = { x: number; y: number; d: number };

/** Where `count` avatars (up to PLACES) sit in `area`, for each layout. */
const LAYOUTS: Record<VoiceLayout, (area: Area, count: number) => Spot[]> = {
    // One large, two side by side, three as two over one, four in a square.
    grid: (area, count) => {
        const cx = area.x + area.w / 2;
        const cy = area.y + area.h / 2;
        const size = Math.min(area.w, area.h);
        if (count === 1) return [{ x: cx, y: cy, d: size * 0.68 }];
        const d = size * 0.42;
        const step = (d + size * 0.06) / 2;
        if (count === 2)
            return [
                { x: cx - step, y: cy, d },
                { x: cx + step, y: cy, d },
            ];
        const [top, bottom] = [cy - step, cy + step];
        const square = [
            { x: cx - step, y: top, d },
            { x: cx + step, y: top, d },
            { x: cx - step, y: bottom, d },
            { x: cx + step, y: bottom, d },
        ];
        return count === 3 ? [square[0]!, square[1]!, { x: cx, y: bottom, d }] : square;
    },
    // Side by side, as large as the row lets them.
    row: (area, count) => {
        const gap = area.w * 0.04;
        const d = Math.min(area.h * 0.7, (area.w * 0.9 - gap * (count - 1)) / count);
        const left = area.x + (area.w - (d * count + gap * (count - 1))) / 2 + d / 2;
        return Array.from({ length: count }, (_, i) => ({
            x: left + i * (d + gap),
            y: area.y + area.h / 2,
            d,
        }));
    },
    // Overlapping, as Discord shows a call.
    stack: (area, count) => {
        const step = 0.64;
        const d = Math.min(area.h * 0.7, (area.w * 0.88) / (1 + step * (count - 1)));
        const left = area.x + (area.w - (d + d * step * (count - 1))) / 2 + d / 2;
        return Array.from({ length: count }, (_, i) => ({
            x: left + i * d * step,
            y: area.y + area.h / 2,
            d,
        }));
    },
};

/** One person in their spot: in a stack, a rim of the key's background parts them from the one under. */
function person(
    ctx: CanvasRenderingContext2D,
    member: VoiceMember,
    { x, y, d }: Spot,
    look: WidgetLook,
    rimmed: boolean,
): void {
    if (rimmed) {
        ctx.fillStyle = look.background;
        ctx.beginPath();
        ctx.arc(x, y, d / 2 + Math.max(1.5, d * 0.06), 0, Math.PI * 2);
        ctx.fill();
    }
    avatar(ctx, member, x, y, d, look);
}

/** Someone speaking: a green ring round them, as Discord shows it. */
function speaking(ctx: CanvasRenderingContext2D, { x, y, d }: Spot, look: WidgetLook): void {
    const ring = Math.max(2, d * 0.075);
    ctx.lineWidth = ring;
    ctx.strokeStyle = IN_CALL;
    ctx.beginPath();
    ctx.arc(x, y, d / 2 - ring / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, ring * 0.55);
    ctx.strokeStyle = look.background;
    ctx.beginPath();
    ctx.arc(x, y, d / 2 - ring - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
}

/** How many more are in it than the key has room for, in the last spot. */
function more(
    ctx: CanvasRenderingContext2D,
    count: number,
    { x, y, d }: Spot,
    look: WidgetLook,
    rimmed: boolean,
): void {
    if (rimmed) {
        ctx.fillStyle = look.background;
        ctx.beginPath();
        ctx.arc(x, y, d / 2 + Math.max(1.5, d * 0.06), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = fade(look.color, 0.16);
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.color;
    ctx.font = `700 ${Math.round(d * 0.38)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${count}`, x, y + d * 0.02, d * 0.9);
}

/**
 * A voice key: a channel's, or the call's. Who is in it as avatars only,
 * placed as its layout says - past four, three and "+n" - with a green ring
 * on whoever speaks. While you are in it, framed in Discord's green. With no
 * one there, the key's own icon in its colour; with Discord out of reach,
 * that icon greyed and struck through. The channel's name under it all,
 * unless the key hides it. Without a moment, its base picture: the icon and
 * the name it was picked with.
 */
export function drawVoice(
    ctx: CanvasRenderingContext2D,
    widget: VoiceWidget,
    look: WidgetLook,
    area: Area,
    moment?: WidgetMoment,
): void {
    ctx.save();
    const voice = moment?.state?.voice;
    const reached = !voice || voice.health === "ready";
    const glyph = kindOf(widget).icon;
    const picked = widget.type === "discord-channel" ? widget.channel !== "" : true;
    const name =
        widget.showName === false
            ? ""
            : voice?.name || (widget.type === "discord-channel" ? (widget.name ?? "") : "");
    const room: Area = name ? { ...area, h: area.h * (1 - NAME_BAND) } : area;
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    // In it: a green wash under everything, and a frame over it.
    const frame = (): void => {
        ctx.beginPath();
        ctx.roundRect(area.x + 2, area.y + 2, area.w - 4, area.h - 4, 10);
    };
    if (voice?.joined) {
        ctx.fillStyle = fade(IN_CALL, 0.1);
        frame();
        ctx.fill();
    }
    const members = reached ? (voice?.members ?? []) : [];
    if (!reached) unreachable(ctx, look, glyph, cx, cy, iconSize(look, room));
    else if (members.length === 0)
        keyGlyph(
            ctx,
            look,
            glyph,
            cx,
            cy,
            iconSize(look, room),
            picked ? look.color : fade(look.color, 0.35),
        );
    else {
        const rimmed = (widget.layout ?? "grid") === "stack";
        const shown = members.length > PLACES ? PLACES - 1 : members.length;
        const spots = LAYOUTS[widget.layout ?? "grid"](
            { ...room, y: room.y + room.h * 0.02, h: room.h * 0.96 },
            Math.min(members.length, PLACES),
        );
        const placed = members.slice(0, shown);
        placed.forEach((member, i) => person(ctx, member, spots[i]!, look, rimmed));
        if (members.length > PLACES)
            more(ctx, members.length - shown, spots[PLACES - 1]!, look, rimmed);
        // Whoever speaks comes to the front of a stack, ringed.
        placed.forEach((member, i) => {
            if (!member.speaking) return;
            if (rimmed) person(ctx, member, spots[i]!, look, rimmed);
            speaking(ctx, spots[i]!, look);
        });
    }
    if (name)
        caps(
            ctx,
            name,
            area.x + area.w / 2,
            area.y + area.h * (1 - NAME_BAND / 2),
            Math.round(area.h * 0.1),
            area.w * 0.9,
            reached ? fade(look.color, 0.6) : fade(GREY, 0.5),
        );
    if (voice?.joined) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = fade(IN_CALL, 0.9);
        frame();
        ctx.stroke();
    }
    ctx.restore();
}
