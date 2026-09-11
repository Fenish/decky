/*---------------------------------------------------------------
 * A key's icon - any in the library: Lucide's, a brand's - drawn on a
 * widget's canvas at once, as KeyIcon renders it. Its SVG is read into shapes
 * once per icon, then stroked or filled each time: no image to wait for, so a
 * widget's first picture has it too.
 *--------------------------------------------------------------*/

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyIcon } from "../../components/key-icon";

interface Icon {
    /** Its viewBox: x, y and width. */
    x: number;
    y: number;
    width: number;
    stroke: number;
    shapes: { path: Path2D; filled: boolean }[];
}

const icons = new Map<string, Icon>();

const numbers = (element: Element, ...names: string[]): number[] =>
    names.map((name) => Number(element.getAttribute(name) ?? 0));

/** Each SVG element an icon is made of, as a canvas path. */
const SHAPES: Record<string, (element: Element, path: Path2D) => void> = {
    path: (element, path) => path.addPath(new Path2D(element.getAttribute("d") ?? "")),
    circle: (element, path) => {
        const [cx, cy, r] = numbers(element, "cx", "cy", "r") as [number, number, number];
        path.moveTo(cx + r, cy);
        path.arc(cx, cy, r, 0, Math.PI * 2);
    },
    ellipse: (element, path) => {
        const [cx, cy, rx, ry] = numbers(element, "cx", "cy", "rx", "ry") as [
            number,
            number,
            number,
            number,
        ];
        path.moveTo(cx + rx, cy);
        path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    },
    rect: (element, path) => {
        const [x, y, w, h, rx] = numbers(element, "x", "y", "width", "height", "rx") as [
            number,
            number,
            number,
            number,
            number,
        ];
        path.roundRect(x, y, w, h, rx);
    },
    line: (element, path) => {
        const [x1, y1, x2, y2] = numbers(element, "x1", "y1", "x2", "y2") as [
            number,
            number,
            number,
            number,
        ];
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
    },
    polyline: (element, path) => points(element, path, false),
    polygon: (element, path) => points(element, path, true),
};

function points(element: Element, path: Path2D, close: boolean): void {
    const values = (element.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    for (let i = 0; i + 1 < values.length; i += 2)
        if (i === 0) path.moveTo(values[i]!, values[i + 1]!);
        else path.lineTo(values[i]!, values[i + 1]!);
    if (close) path.closePath();
}

function iconNamed(name: string): Icon {
    const known = icons.get(name);
    if (known) return known;
    const markup = renderToStaticMarkup(createElement(KeyIcon, { name, size: 24 }));
    const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    const [x = 0, y = 0, width = 24] = (svg.getAttribute("viewBox") ?? "0 0 24 24")
        .split(/\s+/)
        .map(Number);
    const solid = svg.getAttribute("fill") === "currentColor";
    const icon: Icon = {
        x,
        y,
        width,
        stroke: Number(svg.getAttribute("stroke-width") ?? 2),
        shapes: [],
    };
    for (const element of Array.from(svg.querySelectorAll(Object.keys(SHAPES).join(",")))) {
        const path = new Path2D();
        SHAPES[element.tagName]!(element, path);
        icon.shapes.push({
            path,
            filled: solid || element.getAttribute("fill") === "currentColor",
        });
    }
    icons.set(name, icon);
    return icon;
}

/** A key's icon, `size` pixels across, centred on (x, y), in `color`. */
export function drawKeyIcon(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    size: number,
    color: string,
): void {
    const icon = iconNamed(name);
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / icon.width, size / icon.width);
    ctx.translate(-icon.x, -icon.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = icon.stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const shape of icon.shapes) {
        if (shape.filled) ctx.fill(shape.path);
        else ctx.stroke(shape.path);
    }
    ctx.restore();
}
