import { describe, expect, it } from "vitest";
import {
    volumeFillMap,
    volumeGeometry,
} from "../src/renderer/src/features/widgets/kinds/volume/draw-volume";

const W = 118;
const H = 123;
const area = { x: 0, y: 0, w: W, h: H };

describe("the volume arc's fill map", () => {
    it("fills each pixel of the arc at the share of the way round it sits", () => {
        const widget = { type: "volume", style: "arc" } as const;
        const shape = volumeGeometry(widget, area);
        if (shape.kind !== "arc") throw new Error("an arc");
        const map = volumeFillMap(widget, area, W, H);
        const at = (share: number): number => {
            const angle = shape.start + share * shape.sweep;
            const x = Math.floor(shape.cx + shape.r * Math.cos(angle));
            const y = Math.floor(shape.cy + shape.r * Math.sin(angle));
            return map[y * W + x]!;
        };
        // Every tenth of the way round, from the start to the end: in order,
        // and near the share itself (1-254).
        const shares = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
        const values = shares.map(at);
        for (const [i, share] of shares.entries())
            expect(Math.abs(values[i]! - (1 + share * 253))).toBeLessThan(8);
        expect([...values].sort((a, b) => a - b)).toEqual(values);
        // At 56%, what fills is the arc up to 56% - nothing past it.
        const level = Math.round(0.56 * 254);
        expect(at(0.5) <= level).toBe(true);
        expect(at(0.8) <= level).toBe(false);
        expect(at(0.95) <= level).toBe(false);
    });
});
