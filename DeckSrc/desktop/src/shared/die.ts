/*---------------------------------------------------------------
 * A die the deck rolls: a cube seen leaning a little from straight down,
 * lit from the upper left. The deck draws and throws it (firmware
 * src/wheel.cpp, with the same sums); the app draws it lying still.
 *
 * Where and how it lies is its pose: the face up, where on the key (in
 * 128ths across and down) and how far it is turned (degrees), packed into
 * one number as face + 8 (x + 128 (y + 128 yaw)).
 *--------------------------------------------------------------*/

type Vec = readonly [number, number, number];

/** The faces 1-6 in order: outward normal, and the axes their pips lie on. */
export const DIE_FACES: readonly { n: Vec; u: Vec; v: Vec }[] = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { n: [0, -1, 0], u: [0, 0, 1], v: [-1, 0, 0] },
    { n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
    { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
];
/** Pips per face on a 3 x 3 grid: (u, v) each -1, 0 or 1 times PIP_AT. */
export const DIE_PIPS: readonly (readonly [number, number])[][] = [
    [[0, 0]],
    [
        [-1, -1],
        [1, 1],
    ],
    [
        [-1, -1],
        [0, 0],
        [1, 1],
    ],
    [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
    ],
    [
        [-1, -1],
        [1, -1],
        [0, 0],
        [-1, 1],
        [1, 1],
    ],
    [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [1, -1],
        [1, 0],
        [1, 1],
    ],
];
export const VIEW_TILT = 0.3;
export const LIGHT: Vec = [-0.4, 0.5, 0.77];
export const AMBIENT = 0.36;
export const DIFFUSE = 0.7;
export const GLOSS = 0.08;
/** A face's corner radius, where its pips sit and how big, in half-edges. */
export const CORNER = 0.24;
export const PIP_AT = 0.52;
export const PIP_R = 0.18;
/** A die's edge, as a share of the key's shorter side. */
export const DIE_SHARE = 0.36;

export interface DiePose {
    /** 0-5, for 1-6 up. */
    face: number;
    /** 0-127 across and down the key. */
    x: number;
    y: number;
    /** 0-359 degrees, counterclockwise. */
    yaw: number;
}

export function packPose({ face, x, y, yaw }: DiePose): number {
    return face + 8 * (x + 128 * (y + 128 * yaw));
}
/** A packed pose read back; null if it is not one. */
export function unpackPose(pose: number): DiePose | null {
    if (!Number.isInteger(pose) || pose < 0) return null;
    const face = pose % 8;
    const x = Math.floor(pose / 8) % 128;
    const y = Math.floor(pose / 1024) % 128;
    const yaw = Math.floor(pose / 131_072);
    return face <= 5 && yaw <= 359 ? { face, x, y, yaw } : null;
}
/** Lying in the middle of the key, straight, with `face` up. */
export const restingPose = (face: number): number => packPose({ face, x: 64, y: 64, yaw: 0 });

type Matrix = number[];
const multiply = (a: Matrix, b: Matrix): Matrix =>
    Array.from({ length: 9 }, (_, k) => {
        const i = Math.floor(k / 3);
        const j = k % 3;
        return a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    });
const apply = (m: Matrix, v: Vec): [number, number, number] => [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];

/** How a die lying in `pose` is turned: world x right, y up, z toward the eye. */
export function poseRotation(pose: DiePose): Matrix {
    const t = (pose.yaw * Math.PI) / 180;
    const spin = [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
    const { n, u, v } = DIE_FACES[pose.face]!;
    return multiply(spin, [...u, ...v, ...n]);
}

export interface SeenFace {
    face: number;
    /**
     * The face as a map of the square from -1 to 1 onto the key (y down): a
     * point (a, b) lands at c + a * u + b * v, as canvas transform(u.x, u.y,
     * v.x, v.y, c.x, c.y) draws it.
     */
    u: [number, number];
    v: [number, number];
    c: [number, number];
    /** 1 as it is; less as it turns from the light. */
    light: number;
}

/**
 * The faces of a die lying in `pose` that the eye sees, on a key `width` x
 * `height`, with its edge `size` pixels long; and where its shadow falls.
 */
export function dieSeen(
    pose: DiePose,
    width: number,
    height: number,
    size: number,
): { faces: SeenFace[]; shadow: { x: number; y: number; half: number } } {
    const rot = poseRotation(pose);
    const c = Math.cos(VIEW_TILT);
    const s = Math.sin(VIEW_TILT);
    const view = multiply([1, 0, 0, 0, c, s, 0, -s, c], rot);
    const half = size / 2;
    const x = (pose.x * (width - 1)) / 127;
    const y = (pose.y * (height - 1)) / 127;
    const faces: SeenFace[] = [];
    DIE_FACES.forEach(({ n, u, v }, face) => {
        const seen = apply(view, n);
        if (seen[2] <= 0.02) return;
        const world = apply(rot, n);
        const a = apply(view, u);
        const b = apply(view, v);
        const lit = world[0] * LIGHT[0] + world[1] * LIGHT[1] + world[2] * LIGHT[2];
        faces.push({
            face,
            u: [a[0] * half, -a[1] * half],
            v: [b[0] * half, -b[1] * half],
            c: [x + seen[0] * half, y - seen[1] * half],
            light: AMBIENT + DIFFUSE * Math.max(0, lit),
        });
    });
    return { faces, shadow: { x: x + 1.5, y: y + s * half + 1.5, half } };
}
