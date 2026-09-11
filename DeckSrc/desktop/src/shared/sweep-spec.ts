/*---------------------------------------------------------------
 * A ring's arc that the deck moves by itself (the SWEEP command): OBS's
 * 5-second countdown, so far. The key's picture keeps the ring's track;
 * the arc goes to the deck once - where the ring is, its colour and glow, and
 * how its end moves with the clock - and the deck strokes it from the top,
 * clockwise, with round ends, at the panel's pace. The digits under it go on
 * arriving as LIVE patches, without it starting over.
 *
 * Its motion is in this PC's clock (ms since 1970). SWEEP's line ends with
 * the clock as it is sent, and the deck follows it from there, so the payload
 * stays the same for as long as the motion does and is sent only then.
 *
 * Little-endian, 32 bytes:
 *   u8 1, u8 motion (0 still, 1 once, 2 round),
 *   u16 x, y, radius, width (1/16 px: the ring's middle line and stroke),
 *   u16 colour (RGB565), u8 opacity, u8 glow (0-255, at the stroke's edge),
 *   u8 the glow's reach (px), u8 0,
 *   u16 the share held still (of 65535), u16 0,
 *   i64 when the share was none (ms), i32 ms a turn takes (below 0, it runs back).
 *
 * firmware/src/keys/sweep/sweep.cpp reads it; sweepShare is how it moves there.
 *--------------------------------------------------------------*/

/**
 * Where an arc's end is, as a share of a turn from the top: held still, or
 * moving with the clock - a share of `(now - zero) / turn`, which stops at
 * none and at a whole turn, or goes `round` and round.
 */
export type SweepMotion = { share: number } | { zero: number; turn: number; round: boolean };

export interface SweepArc {
    /** The ring's middle line and its stroke, in key pixels. */
    x: number;
    y: number;
    r: number;
    width: number;
    /** "#rrggbb", at `alpha` (0-1). */
    color: string;
    alpha: number;
    /** A glow round the stroke: its strength at the stroke's edge (0-1), and its reach in px. */
    glow: number;
    reach: number;
    motion: SweepMotion;
}

export const SWEEP_BYTES = 32;
/** Longer turns are a mistake: a day. */
const LONGEST_TURN_MS = 86_400_000;
const MOTIONS = ["still", "once", "round"] as const;

/** Where the end of an arc moving so is at `now`: 0 to 1. */
export function sweepShare(motion: SweepMotion, now: number): number {
    if ("share" in motion) return Math.min(1, Math.max(0, motion.share));
    const turns = (now - motion.zero) / motion.turn;
    return motion.round ? turns - Math.floor(turns) : Math.min(1, Math.max(0, turns));
}

/** Whether an arc moving so is still on its way at `now`: going round, or short of where it stops. */
export function sweepMoving(motion: SweepMotion, now: number): boolean {
    if ("share" in motion) return false;
    if (motion.round) return true;
    return motion.turn > 0 ? now < motion.zero + motion.turn : now < motion.zero;
}

function rgb565(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return ((((n >> 16) & 255) >> 3) << 11) | ((((n >> 8) & 255) >> 2) << 5) | ((n & 255) >> 3);
}

function hex565(color: number): string {
    const r = ((color >> 11) & 31) << 3;
    const g = ((color >> 5) & 63) << 2;
    const b = (color & 31) << 3;
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Its bounds as the deck reckons them, in 1/16 px: the stroke, its glow and a pixel more. */
function extent16(r16: number, w16: number, reach: number): number {
    return r16 + Math.floor(w16 / 2) + reach * 16 + 16;
}

/** Whether the deck takes this arc on a key this size: whole, inside it, 2 px clear of its edges. */
export function sweepFits(arc: SweepArc, keyWidth: number, keyHeight: number): boolean {
    const [x16, y16, r16, w16] = [arc.x, arc.y, arc.r, arc.width].map((v) => Math.round(v * 16));
    const reach = Math.round(arc.reach);
    const extent = extent16(r16!, w16!, reach);
    return (
        r16! >= 16 &&
        w16! >= 8 &&
        w16! <= r16! &&
        reach <= 32 &&
        x16! - extent >= 32 &&
        y16! - extent >= 32 &&
        x16! + extent <= (keyWidth - 2) * 16 &&
        y16! + extent <= (keyHeight - 2) * 16
    );
}

export function encodeSweep(arc: SweepArc): Uint8Array {
    const bytes = new Uint8Array(SWEEP_BYTES);
    const view = new DataView(bytes.buffer);
    const still = "share" in arc.motion;
    bytes[0] = 1;
    bytes[1] = still ? 0 : "round" in arc.motion && arc.motion.round ? 2 : 1;
    [arc.x, arc.y, arc.r, arc.width].forEach((v, i) =>
        view.setUint16(2 + i * 2, Math.round(v * 16), true),
    );
    view.setUint16(10, rgb565(arc.color), true);
    bytes[12] = Math.round(Math.min(1, Math.max(0, arc.alpha)) * 255);
    bytes[13] = Math.round(Math.min(1, Math.max(0, arc.glow)) * 255);
    bytes[14] = Math.round(arc.reach);
    if ("share" in arc.motion)
        view.setUint16(16, Math.round(sweepShare(arc.motion, 0) * 65535), true);
    else {
        view.setBigInt64(20, BigInt(Math.round(arc.motion.zero)), true);
        view.setInt32(28, Math.round(arc.motion.turn), true);
    }
    return bytes;
}

/** An arc as the deck would take it on a key this size, or null where the deck would refuse it. */
export function decodeSweep(
    bytes: Uint8Array,
    keyWidth: number,
    keyHeight: number,
): SweepArc | null {
    if (bytes.length !== SWEEP_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const motion = MOTIONS[bytes[1]!];
    if (bytes[0] !== 1 || !motion || bytes[15] !== 0 || view.getUint16(18, true) !== 0) return null;
    const turn = view.getInt32(28, true);
    if (motion !== "still" && (turn === 0 || Math.abs(turn) > LONGEST_TURN_MS)) return null;
    const [x, y, r, width] = [2, 4, 6, 8].map((at) => view.getUint16(at, true) / 16) as [
        number,
        number,
        number,
        number,
    ];
    const arc: SweepArc = {
        x,
        y,
        r,
        width,
        color: hex565(view.getUint16(10, true)),
        alpha: bytes[12]! / 255,
        glow: bytes[13]! / 255,
        reach: bytes[14]!,
        motion:
            motion === "still"
                ? { share: view.getUint16(16, true) / 65535 }
                : {
                      zero: Number(view.getBigInt64(20, true)),
                      turn,
                      round: motion === "round",
                  },
    };
    return sweepFits(arc, keyWidth, keyHeight) ? arc : null;
}
