import { encodeLivePatch } from "../../../../shared/live-patch";
import { DICE_FEEL, DIE_FEEL, encodeWheelSpec, WHEEL_FEEL } from "../../../../shared/wheel-spec";
import { DIE_SHARE, packPose } from "../../../../shared/die";
import type { WheelSize } from "../../../../shared/wheel-spec";
import {
    diceFaces,
    diceLabels,
    formatDuration,
    timerSeconds,
    wheelValues,
} from "../../../../shared/widgets";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { toRgb565 } from "../artwork/artwork";
import { GREY } from "./canvas-kit";
import { diceGeometry, diePose, pipColor } from "./draw-dice";
import { paintVolume, volumeFillMap, volumeGeometry } from "./draw-sound";
import {
    drawWidget,
    paintKey,
    wheelFonts,
    wheelGeometry,
    WIDGET_FONT,
    widgetArea,
} from "./draw-widget";
import type { WidgetLook } from "./draw-widget";

type Timer = Extract<Widget, { type: "timer" }>;
type Dice = Extract<Widget, { type: "dice" }>;
type Volume = Extract<Widget, { type: "volume" }>;

function rgb565(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return ((((n >> 16) & 255) >> 3) << 11) | ((((n >> 8) & 255) >> 2) << 5) | ((n & 255) >> 3);
}

/** A key-sized canvas, drawn by `paint`, as RGB565. */
function picture(
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
function glyphs(chars: { id: string; char: string }[], size: number, weight = 650): WheelSize {
    const height = Math.min(64, Math.ceil(size * 1.3));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    return {
        height,
        glyphs: chars.map(({ id, char }) => {
            ctx.font = `${weight} ${size}px ${WIDGET_FONT}`;
            const width = Math.min(64, Math.max(1, Math.round(ctx.measureText(char).width)));
            canvas.width = width;
            canvas.height = height;
            ctx.font = `${weight} ${size}px ${WIDGET_FONT}`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(char, 0, height / 2);
            return { char: id, width, alpha: coverage(canvas) };
        }),
    };
}
const plain = (chars: string[]): { id: string; char: string }[] =>
    chars.map((char) => ({ id: char, char }));

function countdown(look: WidgetLook, widget: Timer, width: number, height: number): Uint8Array {
    const values = wheelValues(widget);
    const area = widgetArea(look, width, height);
    const { row, center } = wheelGeometry(area);
    let fonts: [number, number] = [0, 0];
    const backdrop = picture(width, height, (ctx) => {
        // The base picture: background, caption and band, without the times.
        drawWidget(ctx, widget, look, width, height);
        fonts = wheelFonts(ctx, area, row);
    });
    const texts = values.map((seconds) => formatDuration(seconds * 1000));
    const chars = plain([...new Set(texts.join(""))].sort());
    return encodeWheelSpec({
        kind: "drum",
        row,
        center,
        clipTop: Math.round(area.y),
        clipBottom: Math.round(area.y + area.h),
        color: rgb565(look.color),
        feel: WHEEL_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
        sizes: [glyphs(chars, fonts[0]), glyphs(chars, fonts[1])],
        labels: texts.map((text) => ({ size: text.length > 5 ? 1 : 0, text })),
    });
}

/** A coin, yes or no, or a list: a drum of words the deck spins to a side. */
function dice(look: WidgetLook, widget: Dice, width: number, height: number): Uint8Array {
    const area = widgetArea(look, width, height);
    const faces = diceFaces(widget);
    let geometry = { row: 0, center: 0, font: 0 };
    const backdrop = picture(width, height, (ctx) => {
        paintKey(ctx, look, width, height);
        geometry = diceGeometry(ctx, widget, area);
    });
    // Every character the words use, under ids from 33 on.
    const chars = [...new Set(faces.join(""))];
    const id = (char: string): string => String.fromCharCode(33 + chars.indexOf(char));
    const size = glyphs(
        chars.map((char) => ({ id: id(char), char })),
        geometry.font,
        700,
    );
    const texts = faces.map((face) => [...face].map(id).join(""));
    return encodeWheelSpec({
        kind: "drum",
        row: geometry.row,
        center: geometry.center,
        clipTop: Math.round(area.y),
        clipBottom: Math.round(area.y + area.h),
        color: rgb565(look.color),
        feel: DICE_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
        sizes: [size],
        labels: diceLabels(widget).map((face) => ({ size: 0, text: texts[face]! })),
    });
}

/** A die: the deck draws it in 3D and throws it; it needs only the key under it. */
function die(look: WidgetLook, width: number, height: number): Uint8Array {
    const backdrop = picture(width, height, (ctx) => paintKey(ctx, look, width, height));
    return encodeWheelSpec({
        kind: "die",
        size: Math.round(DIE_SHARE * Math.min(width, height)),
        color: rgb565(look.color),
        pip: rgb565(pipColor(look.color)),
        feel: DIE_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
    });
}

function volume(
    look: WidgetLook,
    widget: Volume,
    muted: boolean,
    width: number,
    height: number,
): Uint8Array {
    const area = widgetArea(look, width, height);
    const at = (level: number) =>
        picture(width, height, (ctx) => {
            paintKey(ctx, look, width, height);
            paintVolume(ctx, widget, look, area, level, muted, false);
        });
    const empty = at(0);
    const shape = volumeGeometry(widget, area);
    // The arc writes its value; the bar shows none.
    const number = shape.kind === "arc";
    return encodeWheelSpec({
        kind: "dial",
        min: 0,
        max: 100,
        // A key's height of swipe runs the whole range.
        unitPx: 1.2,
        textY: number ? shape.textY : 0,
        color: rgb565(muted ? GREY : look.color),
        backdrop: encodeLivePatch(null, empty, width, height),
        fill: encodeLivePatch(empty, at(100), width, height),
        map: volumeFillMap(widget, area, width, height),
        size: number ? glyphs(plain([..."0123456789"]), shape.textSize, 700) : null,
    });
}

const built = new Map<string, Uint8Array>();

/**
 * For a key the deck turns by itself - an adjustable countdown at rest,
 * dice or a die, the volume - its look (WHEEL), what each label stands for, and where
 * it rests now. The same key gives the same look, which the deck keeps by
 * CRC, so each look travels once. Null for any other key.
 */
export function deckLook(
    look: WidgetLook,
    widget: Widget,
    state: WidgetState | undefined,
    width: number,
    height: number,
): { spec: Uint8Array; values: number[]; index: number } | null {
    const muted = widget.type === "volume" && state?.muted === true;
    const id = JSON.stringify([look, widget, muted, width, height]);
    const make = (): Uint8Array | null =>
        widget.type === "timer"
            ? countdown(look, widget, width, height)
            : widget.type === "dice"
              ? widget.mode === "die"
                  ? die(look, width, height)
                  : dice(look, widget, width, height)
              : widget.type === "volume"
                ? volume(look, widget, muted, width, height)
                : null;
    let spec = built.get(id);
    if (!spec) {
        const made = make();
        if (!made) return null;
        spec = made;
        built.set(id, spec);
        if (built.size > 24) built.delete(built.keys().next().value!);
    }
    if (widget.type === "timer") {
        const values = wheelValues(widget);
        return { spec, values, index: values.indexOf(timerSeconds(widget, state)) };
    }
    if (widget.type === "dice" && widget.mode === "die")
        return { spec, values: [], index: packPose(diePose(state?.value, state?.rest)) };
    if (widget.type === "dice")
        return {
            spec,
            values: diceLabels(widget),
            index: (state?.value ?? 0) + diceFaces(widget).length,
        };
    return { spec, values: [], index: Math.round(state?.level ?? 0) };
}
