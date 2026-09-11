import { displayedKey, ICON_SIZES, keyAddress } from "../../../../shared/config";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyIcon } from "../../components/key-icon";
import type {
    Action,
    Artwork,
    DeckPage,
    KeyAppearance,
    KeyConfig,
    KeyStates,
} from "../../../../shared/config";
import type { IntegrationId } from "../../../../shared/integrations/integration";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import type { KeyOverlays } from "../../../../shared/api";
import { encodeSlide, SLIDE_FEEL } from "../../../../shared/slide-spec";
import type { SlideLine } from "../../../../shared/slide-spec";
import { encodeSweep } from "../../../../shared/sweep-spec";
import type { SweepArc } from "../../../../shared/sweep-spec";
import { fade, GREY, strike } from "../widgets/canvas-kit";
import { drawWidget, widgetLook } from "../widgets/draw-widget";
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
/**
 * A key's picture. `disabled`, it is drawn as a widget out of reach is: its
 * icon grey and struck through, its label grey, an image greyed and darkened -
 * a key whose app Decky cannot reach.
 */
export async function renderKey(
    key: (KeyAppearance & { action?: Action }) | undefined,
    w: number,
    h: number,
    back = false,
    disabled = false,
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
    const ground = key?.background ?? "#000000";
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    if (!key && !back) return canvas;
    if (key?.artwork) {
        drawArtwork(ctx, await loadImage(key.artwork.source), key.artwork, w, h);
        if (disabled) {
            ctx.save();
            ctx.globalCompositeOperation = "saturation";
            ctx.fillStyle = GREY;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
            ctx.fillRect(0, 0, w, h);
        }
    }
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
    // A breath between the icon and the label under it.
    const gap = h / 15;
    // The label sits at the foot of the key, where it is with an image behind it.
    const labelY = h * 0.85;
    if (!key?.artwork) {
        // A third of the key, times the icon size set in Appearance. A label
        // does not move the icon off the middle: the icon gives way to it,
        // shrinking only as far as the label and the gap under it need.
        const asked = Math.round((w * 0.3 * (key?.iconSize ?? ICON_SIZES.usual)) / 100);
        const room = (labelY - metrics.actualBoundingBoxAscent - gap - h / 2) * 2;
        const size = Math.round(hasLabel ? Math.max(w * 0.12, Math.min(asked, room)) : asked);
        const svg = renderToStaticMarkup(
            createElement(KeyIcon, { name: back ? "back" : (key?.icon ?? "plus"), size }),
        ).replaceAll("currentColor", disabled ? GREY : (key?.color ?? "#eeeeee"));
        const icon = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        const iconY = (h - size) / 2;
        ctx.globalAlpha = disabled ? 0.45 : 1;
        ctx.drawImage(icon, (w - size) / 2, iconY, size, size);
        ctx.globalAlpha = 1;
        if (disabled)
            strike(ctx, w / 2, iconY + size / 2, size * 0.62, Math.max(1.5, size * 0.08), ground);
    } else if (disabled)
        strike(ctx, w / 2, h / 2, w * 0.2, Math.max(1.5, w * 0.03), "rgba(0, 0, 0, 0.6)");
    ctx.fillStyle = disabled ? fade(GREY, 0.5) : (key?.color ?? "#eeeeee");
    ctx.font = `600 ${Math.round(w * 0.12)}px Segoe UI`;
    if (hasLabel) ctx.fillText(back ? "Back" : (key?.label ?? ""), w / 2, labelY, w * 0.9);
    return canvas;
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

/**
 * A widget key as the deck gets it: its picture, and what the deck draws over
 * it by itself - where it slides text (`slides`, slide=1) the text too long for
 * the key, and where it moves rings' arcs (`sweeps`, sweep=1) the ring's arc.
 * Each is null where the key has none, and left out where the deck draws no
 * such thing: then it is in the picture.
 */
export function widgetParts(
    key: KeyAppearance,
    widget: Widget,
    state: WidgetState | undefined,
    now: number,
    width: number,
    height: number,
    deck: { slides: boolean; sweeps: boolean },
): { frame: Uint8Array; overlays: KeyOverlays } {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const lines: SlideLine[] | undefined = deck.slides ? [] : undefined;
    const arcs: SweepArc[] | undefined = deck.sweeps ? [] : undefined;
    const ctx = canvas.getContext("2d")!;
    drawWidget(ctx, widget, widgetLook(key), width, height, {
        state,
        now,
        slides: lines,
        sweeps: arcs,
    });
    const overlays: KeyOverlays = {};
    if (lines) overlays.slide = lines.length ? encodeSlide({ feel: SLIDE_FEEL, lines }) : null;
    if (arcs) overlays.sweep = arcs[0] ? encodeSweep(arcs[0]) : null;
    return { frame: toRgb565(canvas, width, height), overlays };
}

/** Whether a key controls an app out of reach (`down`): it is drawn disabled. */
export function keyDisabled(key: KeyConfig | undefined, down: readonly IntegrationId[]): boolean {
    return key?.action.kind === "app" && down.includes(key.action.app);
}

/** The apps out of reach that `page`'s keys control: what its pictures depend on besides it. */
export function downOn(page: DeckPage, down: readonly IntegrationId[]): IntegrationId[] {
    return down.filter((id) =>
        Object.values(page.keys).some((key) => key.action.kind === "app" && key.action.app === id),
    );
}

/**
 * A page's pictures, as `states` show its toggles. A key controlling an app
 * out of reach (`down`) is drawn disabled - only here: its app's toggles are
 * all OFF then, so its ON picture never shows, and stays as the deck holds it.
 * Switching look is a small patch to each such key, not every ON picture
 * again, which the deck takes whole (29 KB each).
 */
export async function pageFrames(
    page: DeckPage,
    width: number,
    height: number,
    states: KeyStates = {},
    down: readonly IntegrationId[] = [],
): Promise<Uint8Array[]> {
    return Promise.all(
        Array.from({ length: 15 }, async (_, cell) => {
            const back = cell === 10 && page.parentId !== null;
            const canvas = await renderKey(
                displayedKey(page.keys[cell], states[keyAddress(page.id, cell)] ?? false),
                width,
                height,
                back,
                !back && keyDisabled(page.keys[cell], down),
            );
            return toRgb565(canvas, width, height);
        }),
    );
}

/** Toggle keys' ON pictures (ALT): never disabled (pageFrames). */
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
