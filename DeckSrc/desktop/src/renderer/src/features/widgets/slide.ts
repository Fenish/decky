import { SLIDE_MAX_WIDTH } from "../../../../shared/slide-spec";
import type { SlideLine } from "../../../../shared/slide-spec";
import { clip, FONT } from "./canvas-kit";
import type { Area } from "./canvas-kit";

function rgb565(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return ((((n >> 16) & 255) >> 3) << 11) | ((((n >> 8) & 255) >> 2) << 5) | ((n & 255) >> 3);
}

/**
 * A line of text too long for its place, for the deck to slide along: drawn
 * as the key would draw it - `size` px at `weight`, its middle at `middle` -
 * from the left of `room`, and read back as coverage. `color` is a "#rrggbb"
 * and `alpha` the text's opacity over the key.
 */
export function slideLine(
    ctx: CanvasRenderingContext2D,
    text: string,
    size: number,
    weight: number,
    room: Area,
    middle: number,
    color: string,
    alpha = 1,
): SlideLine {
    const font = `${weight} ${size}px ${FONT}`;
    ctx.font = font;
    const shown = clip(ctx, text, SLIDE_MAX_WIDTH - 2);
    const width = Math.max(
        Math.floor(room.w) + 1,
        Math.min(SLIDE_MAX_WIDTH, Math.ceil(ctx.measureText(shown).width) + 1),
    );
    // Room for accents above and tails below, inside the key.
    const top = Math.max(0, Math.round(middle - size * 0.8));
    const h = Math.min(48, Math.ceil(size * 1.6), ctx.canvas.height - top);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = h;
    const strip = canvas.getContext("2d", { willReadFrequently: true })!;
    strip.font = font;
    strip.textBaseline = "middle";
    strip.textAlign = "left";
    strip.fillStyle = "#ffffff";
    strip.fillText(shown, 0, middle - top);
    const pixels = strip.getImageData(0, 0, width, h).data;
    const coverage = new Uint8Array(width * h);
    for (let i = 0; i < coverage.length; i++) coverage[i] = Math.round(pixels[i * 4 + 3]! * alpha);
    const x = Math.max(2, Math.round(room.x));
    return {
        x,
        y: top,
        w: Math.min(Math.floor(room.w), ctx.canvas.width - 2 - x),
        h,
        width,
        color: rgb565(color),
        alpha: coverage,
    };
}
