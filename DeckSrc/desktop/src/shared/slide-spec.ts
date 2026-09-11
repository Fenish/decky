/*---------------------------------------------------------------
 * Text too long for its key, which the deck slides along by itself (the
 * SLIDE command): each line drawn once in the app's font, as coverage, with
 * its window on the key and its colour. The deck lays it over the key's own
 * picture, which LIVE patches go on changing underneath.
 *
 * Little-endian:
 *   u8 1, u8 lines (1-2), u16 rest (ms), u16 speed (px/s), u16 gap (px),
 *   u8 fade (px), u8 0;
 *   per line: u16 x, u16 y, u16 w, u16 h (its window, in key pixels),
 *     u16 the text's width, u16 colour (RGB565),
 *     then its coverage, the text's width x h bytes, row by row.
 *
 * firmware/src/keys/text/sliding_text.cpp reads it; slideOffset is how it
 * moves there.
 *--------------------------------------------------------------*/

export interface SlideFeel {
    /** How long a line rests at its start, in ms. */
    rest: number;
    /** Pixels a second. */
    speed: number;
    /** Pixels between its end and its start coming round again. */
    gap: number;
    /** Pixels over which it fades at its window's edges. */
    fade: number;
}
export interface SlideLine {
    /** Its window, in key pixels. */
    x: number;
    y: number;
    w: number;
    h: number;
    /** The text's width: more than the window's. */
    width: number;
    /** RGB565. */
    color: number;
    /** Coverage 0-255, width x h, row by row. */
    alpha: Uint8Array;
}
export interface SlideSpec {
    feel: SlideFeel;
    lines: SlideLine[];
}

/** A second and a half to read its start, then about four letters a second. Tuning needs no firmware. */
export const SLIDE_FEEL: SlideFeel = { rest: 1500, speed: 30, gap: 32, fade: 8 };
/** What the deck takes. */
export const SLIDE_MAX_BYTES = 48 * 1024;
/** Longer text is cut short: two lines this long still fit SLIDE_MAX_BYTES. */
export const SLIDE_MAX_WIDTH = 1400;

export function encodeSlide(spec: SlideSpec): Uint8Array {
    const out: number[] = [];
    const u16 = (v: number): void => {
        out.push(v & 255, (v >> 8) & 255);
    };
    out.push(1, spec.lines.length);
    u16(Math.round(spec.feel.rest));
    u16(Math.round(spec.feel.speed));
    u16(Math.round(spec.feel.gap));
    out.push(Math.round(spec.feel.fade), 0);
    for (const line of spec.lines) {
        [line.x, line.y, line.w, line.h, line.width, line.color].forEach(u16);
        for (const a of line.alpha) out.push(a);
    }
    return Uint8Array.from(out);
}

/** A text as the deck would take it on a key this size, or null where the deck would refuse it. */
export function decodeSlide(
    bytes: Uint8Array,
    keyWidth: number,
    keyHeight: number,
): SlideSpec | null {
    if (bytes.length < 10 || bytes.length > SLIDE_MAX_BYTES) return null;
    const u16 = (at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
    const count = bytes[1]!;
    if (bytes[0] !== 1 || count < 1 || count > 2 || bytes[9] !== 0) return null;
    const feel = { rest: u16(2), speed: u16(4), gap: u16(6), fade: bytes[8]! };
    if (feel.speed < 1 || feel.speed > 1000 || feel.gap > 1000 || feel.fade > 32) return null;
    const lines: SlideLine[] = [];
    let at = 10;
    for (let i = 0; i < count; i++) {
        if (bytes.length - at < 12) return null;
        const [x, y, w, h, width, color] = [0, 2, 4, 6, 8, 10].map((o) => u16(at + o)) as [
            number,
            number,
            number,
            number,
            number,
            number,
        ];
        at += 12;
        // Clear of the key's edges, where a pressed key's outline runs.
        if (
            w < 8 ||
            h < 1 ||
            h > 48 ||
            x < 2 ||
            x + w > keyWidth - 2 ||
            y + h > keyHeight ||
            width <= w ||
            width > 4096 ||
            feel.fade * 2 >= w ||
            bytes.length - at < width * h
        )
            return null;
        lines.push({ x, y, w, h, width, color, alpha: bytes.slice(at, at + width * h) });
        at += width * h;
    }
    return at === bytes.length ? { feel, lines } : null;
}

/** How far a line `width` wide has slid after `elapsed` ms: as the deck moves it. */
export function slideOffset(feel: SlideFeel, width: number, elapsed: number): number {
    const lap = width + feel.gap;
    const sliding = Math.floor((lap * 1000) / feel.speed);
    const t = elapsed % (feel.rest + sliding);
    if (t < feel.rest) return 0;
    return Math.min(lap - 1, Math.floor(((t - feel.rest) * feel.speed) / 1000));
}
