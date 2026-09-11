import type { WheelSize } from "../../../../shared/wheel-spec";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { toRgb565 } from "../artwork/artwork";
import { FONT } from "./canvas-kit";
import type { WidgetLook } from "./draw-widget";
import { viewOf } from "./kinds/registry";

export function rgb565(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return ((((n >> 16) & 255) >> 3) << 11) | ((((n >> 8) & 255) >> 2) << 5) | ((n & 255) >> 3);
}

/** A key-sized canvas, drawn by `paint`, as RGB565. */
export function picture(
    width: number,
    height: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
): Uint8Array {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext("2d", { willReadFrequently: true })!);
    return toRgb565(canvas, width, height);
}

/** Coverage read back from a canvas drawn in white. */
function coverage(canvas: HTMLCanvasElement): Uint8Array {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!;
    return alpha;
}

/**
 * Characters at one font size, each drawn as the app draws text and read
 * back as coverage: the deck puts the numbers together from these, so they
 * look as they do in the app. Each is sent under its own one-byte id.
 */
export function glyphs(
    chars: { id: string; char: string }[],
    size: number,
    weight = 650,
): WheelSize {
    const height = Math.min(64, Math.ceil(size * 1.3));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    return {
        height,
        glyphs: chars.map(({ id, char }) => {
            ctx.font = `${weight} ${size}px ${FONT}`;
            const width = Math.min(64, Math.max(1, Math.round(ctx.measureText(char).width)));
            canvas.width = width;
            canvas.height = height;
            ctx.font = `${weight} ${size}px ${FONT}`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(char, 0, height / 2);
            return { char: id, width, alpha: coverage(canvas) };
        }),
    };
}
export const plain = (chars: string[]): { id: string; char: string }[] =>
    chars.map((char) => ({ id: char, char }));

const built = new Map<string, Uint8Array>();

/**
 * For a key the deck turns by itself - an adjustable countdown at rest,
 * dice or a die, the volume - its look (WHEEL), what each label stands for, and where
 * it rests now. The same key gives the same look, which the deck keeps by
 * CRC, so each look travels once. Null for any other key. Each type's look
 * is its view's (kinds/).
 */
export function deckLook(
    look: WidgetLook,
    widget: Widget,
    state: WidgetState | undefined,
    width: number,
    height: number,
): { spec: Uint8Array; values: number[]; index: number } | null {
    const deck = viewOf(widget).deckLook;
    if (!deck) return null;
    const muted = deck.muted?.(state) ?? false;
    const id = JSON.stringify([look, widget, muted, width, height]);
    let spec = built.get(id);
    if (!spec) {
        spec = deck.build({ look, widget, muted, width, height });
        built.set(id, spec);
        if (built.size > 24) built.delete(built.keys().next().value!);
    }
    return { spec, ...deck.place(widget, state) };
}
