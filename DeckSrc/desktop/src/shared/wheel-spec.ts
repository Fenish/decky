/*---------------------------------------------------------------
 * A deck-turned key's look: all the deck needs to draw a key and turn it
 * under the finger by itself (the WHEEL command). The deck keeps looks by
 * CRC, so a look holds nothing about what is showing - that travels in WHEEL
 * and WHEELAT - and arming the same one again costs one line.
 *
 * A drum (a picker wheel), little-endian:
 *   u8 1, u8 font sizes, u16 labels,
 *   u16 row, u16 center, u16 clip top, u16 clip bottom   (pixels in the key)
 *   u16 colour (RGB565), u16 angle (mrad a label), u8 fade (%), u8 rubber (%),
 *   u16 fling (ms), u16 snap (1/100 per s), u16 max speed (1/10 labels a s),
 *   u32 bytes + the backdrop: a LIVE patch of the whole key under the numbers;
 *   per font size: u8 height, u8 glyphs, glyphs x (u8 character, u8 width),
 *     then each glyph's coverage, width x height bytes, row by row;
 *   per label: u8 font size, u8 length, its characters.
 *
 * A dial (a volume arc or bar):
 *   u8 2, u16 min, u16 max, u16 finger pixels a step (x10), u16 number's
 *   middle (y), u16 number's colour (RGB565), u8 1 if it writes its number
 *   (else 0),
 *   u32 bytes + the key at its lowest (a LIVE patch of the whole key),
 *   u32 bytes + the key at its highest (a LIVE patch over the lowest),
 *   u32 bytes + the fill map as runs of (u8 count 1-255, u8 share): each
 *     pixel's share of the range (1-254) from which it shows the highest
 *     picture, 255 for never;
 *   if it writes its number, one font size as above, holding 0-9.
 *
 * firmware/src/wheel.cpp reads both; a drum is drawn with drumRow's sums.
 *--------------------------------------------------------------*/

import { decodeLivePatch } from "./live-patch";

export interface WheelGlyph {
    char: string;
    width: number;
    /** Coverage 0-255, width x the size's height, row by row. */
    alpha: Uint8Array;
}
export interface WheelSize {
    height: number;
    glyphs: WheelGlyph[];
}
export interface WheelFeel {
    /** Radians of the drum between two labels. */
    angle: number;
    /** How much a label one away from the band fades, 0-1. */
    fade: number;
    /** How far past its ends the wheel follows a finger, 0-1. */
    rubber: number;
    /** Seconds for a flick's speed to fall to 1/e. */
    fling: number;
    /** The spring onto a label, per second: higher settles faster. */
    snap: number;
    /** Labels a second, at most. */
    maxSpeed: number;
}
export interface DrumSpec {
    kind: "drum";
    row: number;
    center: number;
    clipTop: number;
    clipBottom: number;
    /** RGB565. */
    color: number;
    feel: WheelFeel;
    backdrop: Uint8Array;
    sizes: WheelSize[];
    labels: { size: number; text: string }[];
}
export interface DialSpec {
    kind: "dial";
    min: number;
    max: number;
    /** Finger pixels a step. */
    unitPx: number;
    /** Where the number's middle sits, and its colour (RGB565). */
    textY: number;
    color: number;
    /** The key at its lowest, as a LIVE patch of the whole key. */
    backdrop: Uint8Array;
    /** The key at its highest, as a LIVE patch over the lowest. */
    fill: Uint8Array;
    /** Per pixel, the share of the range (1-254) from which it fills; 255 never. */
    map: Uint8Array;
    /** Digits for its number, or null for a dial that writes none. */
    size: WheelSize | null;
}
/** How a die is thrown: px/s across and up, how soon it slows (1/s), what a wall gives back. */
export interface DieFeel {
    speed: number;
    hop: number;
    drag: number;
    bounce: number;
}
/** A die the deck draws in 3D and throws (src/shared/die.ts). */
export interface DieSpec {
    kind: "die";
    /** Its edge, in pixels. */
    size: number;
    /** Body and pips, RGB565. */
    color: number;
    pip: number;
    feel: DieFeel;
    /** The key under it, as a LIVE patch of the whole key. */
    backdrop: Uint8Array;
}
export type WheelSpec = DrumSpec | DialSpec | DieSpec;

/** A throw: about 1.2 s, off a wall or two, each face as likely. */
export const DIE_FEEL: DieFeel = { speed: 900, hop: 260, drag: 1.4, bounce: 0.62 };

/** How a wheel moves and fades. Tuning these needs no firmware. */
export const WHEEL_FEEL: WheelFeel = {
    angle: 0.42,
    fade: 0.6,
    rubber: 0.35,
    fling: 0.32,
    snap: 16,
    maxSpeed: 60,
};
/**
 * Dice: at rest only the face that came up shows - its neighbours fade out
 * whole - while a roll shows every face going by.
 */
export const DICE_FEEL: WheelFeel = { ...WHEEL_FEEL, fade: 1 };

const LIMITS = { sizes: 2, labels: 200, glyphs: 64, glyph: 64, text: 16 };

/**
 * Where a label `d` labels from the band sits on the drum: its middle's
 * offset from the band's, its height's squash, and its opacity. Null once it
 * has turned out of sight.
 */
export function drumRow(
    d: number,
    row: number,
    feel: Pick<WheelFeel, "angle" | "fade">,
): { offset: number; squash: number; alpha: number } | null {
    const theta = d * feel.angle;
    if (Math.abs(theta) >= 1.45) return null;
    const squash = Math.cos(theta);
    return {
        offset: (row / feel.angle) * Math.sin(theta),
        squash,
        // Fainter as the drum turns away, so its far rows are barely there.
        alpha: squash * squash * (1 - feel.fade * Math.min(1, Math.abs(d))),
    };
}

class Writer {
    readonly out: number[] = [];
    u8(v: number): void {
        this.out.push(v & 255);
    }
    u16(v: number): void {
        this.out.push(v & 255, (v >> 8) & 255);
    }
    block(bytes: Uint8Array): void {
        this.u16(bytes.length & 0xffff);
        this.u16(bytes.length >>> 16);
        for (const b of bytes) this.out.push(b);
    }
    size(size: WheelSize): void {
        this.u8(size.height);
        this.u8(size.glyphs.length);
        for (const glyph of size.glyphs) {
            this.u8(glyph.char.charCodeAt(0));
            this.u8(glyph.width);
        }
        for (const glyph of size.glyphs) for (const a of glyph.alpha) this.out.push(a);
    }
}

/** A fill map as the deck takes it: runs of (count, share). */
export function mapRuns(map: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < map.length;) {
        let count = 1;
        while (count < 255 && i + count < map.length && map[i + count] === map[i]) count++;
        out.push(count, map[i]!);
        i += count;
    }
    return Uint8Array.from(out);
}

export function encodeWheelSpec(spec: WheelSpec): Uint8Array {
    const w = new Writer();
    if (spec.kind === "die") {
        w.u8(3);
        w.u8(spec.size);
        w.u16(spec.color);
        w.u16(spec.pip);
        w.u16(Math.round(spec.feel.speed));
        w.u16(Math.round(spec.feel.hop));
        w.u16(Math.round(spec.feel.drag * 100));
        w.u8(Math.round(spec.feel.bounce * 100));
        w.block(spec.backdrop);
        return Uint8Array.from(w.out);
    }
    if (spec.kind === "dial") {
        w.u8(2);
        [spec.min, spec.max, Math.round(spec.unitPx * 10), spec.textY, spec.color].forEach((v) =>
            w.u16(v),
        );
        w.u8(spec.size ? 1 : 0);
        w.block(spec.backdrop);
        w.block(spec.fill);
        w.block(mapRuns(spec.map));
        if (spec.size) w.size(spec.size);
        return Uint8Array.from(w.out);
    }
    w.u8(1);
    w.u8(spec.sizes.length);
    w.u16(spec.labels.length);
    [spec.row, spec.center, spec.clipTop, spec.clipBottom, spec.color].forEach((v) => w.u16(v));
    w.u16(Math.round(spec.feel.angle * 1000));
    w.u8(Math.round(spec.feel.fade * 100));
    w.u8(Math.round(spec.feel.rubber * 100));
    w.u16(Math.round(spec.feel.fling * 1000));
    w.u16(Math.round(spec.feel.snap * 100));
    w.u16(Math.round(spec.feel.maxSpeed * 10));
    w.block(spec.backdrop);
    spec.sizes.forEach((size) => w.size(size));
    for (const label of spec.labels) {
        w.u8(label.size);
        w.u8(label.text.length);
        for (const char of label.text) w.u8(char.charCodeAt(0));
    }
    return Uint8Array.from(w.out);
}

/**
 * A look read back and checked as the deck checks it, for a key of width x
 * height; null if the deck would refuse it.
 */
export function decodeWheelSpec(
    bytes: Uint8Array,
    width: number,
    height: number,
): WheelSpec | null {
    let at = 0;
    let ok = true;
    const take = (n: number): Uint8Array => {
        if (at + n > bytes.length) {
            ok = false;
            return new Uint8Array(0);
        }
        at += n;
        return bytes.subarray(at - n, at);
    };
    const u8 = (): number => take(1)[0] ?? 0;
    const u16 = (): number => {
        const b = take(2);
        return (b[0] ?? 0) | ((b[1] ?? 0) << 8);
    };
    const block = (): Uint8Array => take(u16() + u16() * 65536).slice();
    const picture = (patch: Uint8Array, under?: Uint8Array): boolean =>
        decodeLivePatch(
            under ? under.slice() : new Uint8Array(width * height * 2),
            patch,
            width,
            height,
        );
    const size = (): WheelSize | null => {
        const glyphHeight = u8();
        const count = u8();
        if (
            !ok ||
            glyphHeight < 1 ||
            glyphHeight > LIMITS.glyph ||
            count < 1 ||
            count > LIMITS.glyphs
        )
            return null;
        const heads = Array.from({ length: count }, () => ({
            char: String.fromCharCode(u8()),
            width: u8(),
        }));
        if (heads.some((head) => head.width < 1 || head.width > LIMITS.glyph)) return null;
        return {
            height: glyphHeight,
            glyphs: heads.map((head) => ({
                ...head,
                alpha: take(head.width * glyphHeight).slice(),
            })),
        };
    };
    const version = u8();
    if (version === 3) {
        const size = u8();
        const [color, pip, speed, hop, drag] = [u16(), u16(), u16(), u16(), u16()];
        const bounce = u8();
        const backdrop = block();
        if (
            !ok ||
            size < 12 ||
            size > Math.floor(Math.min(width, height) / 2) ||
            !speed ||
            speed > 3000 ||
            hop < 20 ||
            hop > 800 ||
            !drag ||
            drag > 2000 ||
            bounce > 100 ||
            at !== bytes.length ||
            !picture(backdrop)
        )
            return null;
        return {
            kind: "die",
            size,
            color,
            pip,
            feel: { speed, hop, drag: drag / 100, bounce: bounce / 100 },
            backdrop,
        };
    }
    if (version === 2) {
        const [min, max, unit, textY, color] = [u16(), u16(), u16(), u16(), u16()];
        const number = u8();
        const backdrop = block();
        const fill = block();
        const runs = block();
        if (
            !ok ||
            max <= min ||
            max > 1000 ||
            !unit ||
            textY >= height ||
            number > 1 ||
            runs.length % 2
        )
            return null;
        if (!picture(backdrop) || !picture(fill)) return null;
        const map = new Uint8Array(width * height);
        let filled = 0;
        for (let i = 0; i < runs.length; i += 2) {
            const count = runs[i]!;
            if (!count || filled + count > map.length) return null;
            map.fill(runs[i + 1]!, filled, filled + count);
            filled += count;
        }
        if (filled !== map.length) return null;
        const digits = number ? size() : null;
        const known = digits?.glyphs.map((glyph) => glyph.char) ?? [];
        if (number && (!digits || ![..."0123456789"].every((c) => known.includes(c)))) return null;
        return ok && at === bytes.length
            ? {
                  kind: "dial",
                  min,
                  max,
                  unitPx: unit / 10,
                  textY,
                  color,
                  backdrop,
                  fill,
                  map,
                  size: digits,
              }
            : null;
    }
    if (version !== 1) return null;
    const sizeCount = u8();
    const labelCount = u16();
    const [row, center, clipTop, clipBottom, color] = [u16(), u16(), u16(), u16(), u16()];
    const feel: WheelFeel = {
        angle: u16() / 1000,
        fade: u8() / 100,
        rubber: u8() / 100,
        fling: u16() / 1000,
        snap: u16() / 100,
        maxSpeed: u16() / 10,
    };
    const backdrop = block();
    if (
        !ok ||
        sizeCount < 1 ||
        sizeCount > LIMITS.sizes ||
        labelCount < 1 ||
        labelCount > LIMITS.labels ||
        row < 4 ||
        row > height ||
        center >= height ||
        clipTop >= clipBottom ||
        clipBottom > height ||
        feel.angle < 0.05 ||
        feel.angle > 1.2 ||
        feel.fade > 1 ||
        feel.rubber > 1 ||
        feel.fling <= 0 ||
        feel.snap <= 0 ||
        feel.maxSpeed <= 0 ||
        !picture(backdrop)
    )
        return null;
    const sizes: WheelSize[] = [];
    for (let s = 0; s < sizeCount; s++) {
        const next = size();
        if (!next) return null;
        sizes.push(next);
    }
    const labels: DrumSpec["labels"] = [];
    for (let i = 0; i < labelCount; i++) {
        const fontSize = u8();
        const length = u8();
        const text = String.fromCharCode(...take(length));
        const known = sizes[fontSize]?.glyphs.map((glyph) => glyph.char) ?? [];
        if (!ok || !length || length > LIMITS.text || ![...text].every((c) => known.includes(c)))
            return null;
        labels.push({ size: fontSize, text });
    }
    return ok && at === bytes.length
        ? { kind: "drum", row, center, clipTop, clipBottom, color, feel, backdrop, sizes, labels }
        : null;
}
