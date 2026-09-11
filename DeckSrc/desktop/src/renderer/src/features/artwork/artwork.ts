import { displayedKey, keyAddress } from "../../../../shared/config";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyIcon } from "../../components/key-icon";
import type {
    Action,
    Artwork,
    DeckPage,
    KeyAppearance,
    KeyStates,
} from "../../../../shared/config";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { encodeSlide, SLIDE_FEEL } from "../../../../shared/slide-spec";
import type { SlideLine } from "../../../../shared/slide-spec";
import { drawWidget } from "../widgets/draw-widget";
export async function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("This image could not be decoded."));
        image.src = source;
    });
}
export async function importArtwork(file: File): Promise<Artwork> {
    if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 12 * 1024 * 1024
    )
        throw new Error("Choose a PNG, JPEG or WebP image smaller than 12 MB.");
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
            source: canvas.toDataURL("image/webp", 0.88),
            zoom: 1,
            x: 0,
            y: 0,
            rotation: 0,
            brightness: 1,
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}
export function drawArtwork(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    a: Artwork,
    w: number,
    h: number,
): void {
    const scale = Math.max(w / image.width, h / image.height) * a.zoom;
    ctx.save();
    ctx.translate(w / 2 + (a.x * w) / 100, h / 2 + (a.y * h) / 100);
    ctx.rotate((a.rotation * Math.PI) / 180);
    ctx.filter = `brightness(${a.brightness})`;
    ctx.drawImage(
        image,
        (-image.width * scale) / 2,
        (-image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
    );
    ctx.restore();
}
export async function renderKey(
    key: (KeyAppearance & { action?: Action }) | undefined,
    w: number,
    h: number,
    back = false,
): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // A widget's page picture is its base: settings only, never the time, so
    // the page's checksum holds from one launch to the next. The live parts
    // follow as LIVE patches.
    if (key?.action?.kind === "widget" && !back) {
        drawWidget(ctx, key.action.widget, widgetLook(key), w, h);
        return canvas;
    }
    ctx.fillStyle = key?.background ?? "#000000";
    ctx.fillRect(0, 0, w, h);
    if (!key && !back) return canvas;
    if (key?.artwork) drawArtwork(ctx, await loadImage(key.artwork.source), key.artwork, w, h);
    const hasLabel = back || Boolean(key?.label.trim());
    if (key?.artwork && hasLabel) {
        const shade = ctx.createLinearGradient(0, h * 0.45, 0, h);
        shade.addColorStop(0, "#00000000");
        shade.addColorStop(1, "#000000dd");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(w * 0.12)}px Segoe UI`;
    const text = back ? "Back" : (key?.label ?? "");
    const metrics = ctx.measureText(text);
    const gap = ((key?.labelGap ?? 8) * h) / 120;
    let labelY = h * 0.85;
    if (!key?.artwork) {
        const size = Math.round(w * 0.3);
        const svg = renderToStaticMarkup(
            createElement(KeyIcon, { name: back ? "back" : (key?.icon ?? "plus"), size }),
        ).replaceAll("currentColor", key?.color ?? "#eeeeee");
        const icon = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        const labelHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        const iconY = hasLabel ? (h - size - gap - labelHeight) / 2 : (h - size) / 2;
        labelY = iconY + size + gap + metrics.actualBoundingBoxAscent;
        ctx.drawImage(icon, (w - size) / 2, iconY, size, size);
    }
    ctx.fillStyle = key?.color ?? "#eeeeee";
    ctx.font = `600 ${Math.round(w * 0.12)}px Segoe UI`;
    if (hasLabel) ctx.fillText(back ? "Back" : (key?.label ?? ""), w / 2, labelY, w * 0.9);
    return canvas;
}
function widgetLook(key: KeyAppearance): { background: string; color: string; label: string } {
    return { background: key.background ?? "#000000", color: key.color, label: key.label };
}

/** A canvas as the deck's RGB565, little-endian. */
export function toRgb565(canvas: HTMLCanvasElement, width: number, height: number): Uint8Array {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const bytes = new Uint8Array(width * height * 2);
    for (let i = 0; i < width * height; i++) {
        const rgb =
            ((pixels[i * 4]! >> 3) << 11) |
            ((pixels[i * 4 + 1]! >> 2) << 5) |
            (pixels[i * 4 + 2]! >> 3);
        bytes[i * 2] = rgb & 255;
        bytes[i * 2 + 1] = rgb >> 8;
    }
    return bytes;
}

/** A widget key as it looks now, for a LIVE update. */
export function widgetFrame(
    key: KeyAppearance,
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
    width: number,
    height: number,
): Uint8Array {
    return widgetParts(key, widget, state, now, width, height, false).frame;
}

/**
 * A widget key as it looks now, and - where the deck slides text along
 * (`slides`) - its text too long for the key, which the picture leaves out:
 * the SLIDE payload, or null for none.
 */
export function widgetParts(
    key: KeyAppearance,
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
    width: number,
    height: number,
    slides: boolean,
): { frame: Uint8Array; slide: Uint8Array | null } {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const lines: SlideLine[] | undefined = slides ? [] : undefined;
    const ctx = canvas.getContext("2d")!;
    drawWidget(ctx, widget, widgetLook(key), width, height, { state, now, slides: lines });
    return {
        frame: toRgb565(canvas, width, height),
        slide: lines?.length ? encodeSlide({ feel: SLIDE_FEEL, lines }) : null,
    };
}

export async function pageFrames(
    page: DeckPage,
    width: number,
    height: number,
    states: KeyStates = {},
): Promise<Uint8Array[]> {
    return Promise.all(
        Array.from({ length: 15 }, async (_, cell) => {
            const canvas = await renderKey(
                displayedKey(page.keys[cell], states[keyAddress(page.id, cell)] ?? false),
                width,
                height,
                cell === 10 && page.parentId !== null,
            );
            return toRgb565(canvas, width, height);
        }),
    );
}

export async function pageToggleFrames(
    page: DeckPage,
    width: number,
    height: number,
): Promise<{ cell: number; frame: Uint8Array }[]> {
    const cells = Object.entries(page.keys)
        .filter(
            ([cell, key]) => key.behavior === "toggle" && !(page.parentId && Number(cell) === 10),
        )
        .map(([cell]) => Number(cell));
    if (!cells.length) return [];
    const onStates = Object.fromEntries(cells.map((cell) => [keyAddress(page.id, cell), true]));
    const frames = await pageFrames(
        { ...page, keys: Object.fromEntries(cells.map((cell) => [cell, page.keys[cell]!])) },
        width,
        height,
        onStates,
    );
    return cells.map((cell) => ({ cell, frame: frames[cell]! }));
}
