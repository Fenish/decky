import { Buffer } from "node:buffer";
/* global document, Image, console */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

// The app, taskbar, installer and tray icon, from the branding's app logo.
// Transparent margins are trimmed so the mark fills the icon like other apps' icons.
const SOURCE = "../../Branding/png/logo-app.png";
const PAD = 0.008;
// Windows picks an entry per DPI: 16/20/24/32 for the tray, larger for the taskbar,
// Explorer and the installer. 256 is the size electron-builder requires.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    const page = await browser.newPage();
    const source = (await readFile(SOURCE)).toString("base64");
    const { bounds, images } = await page.evaluate(
        async ({ source, pad, sizes }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${source}`;
            await image.decode();
            const { naturalWidth: w, naturalHeight: h } = image;
            const probe = document.createElement("canvas");
            probe.width = w;
            probe.height = h;
            const context = probe.getContext("2d");
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, w, h).data;
            let left = w,
                top = h,
                right = -1,
                bottom = -1;
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++)
                    if (pixels[(y * w + x) * 4 + 3]) {
                        left = Math.min(left, x);
                        right = Math.max(right, x);
                        top = Math.min(top, y);
                        bottom = Math.max(bottom, y);
                    }
            if (right < 0) throw new Error("The logo is fully transparent.");
            const side = Math.max(right - left + 1, bottom - top + 1);
            const box = Math.ceil(side * (1 + pad * 2));
            // The trimmed mark, centred on a transparent square.
            const square = document.createElement("canvas");
            square.width = square.height = box;
            square
                .getContext("2d")
                .drawImage(
                    image,
                    left,
                    top,
                    right - left + 1,
                    bottom - top + 1,
                    Math.round((box - (right - left + 1)) / 2),
                    Math.round((box - (bottom - top + 1)) / 2),
                    right - left + 1,
                    bottom - top + 1,
                );
            // Halve step by step, then scale once: a single large reduction skips pixels
            // and breaks thin strokes.
            const render = (size) => {
                let current = square;
                while (current.width / 2 >= size) {
                    const half = document.createElement("canvas");
                    half.width = half.height = Math.floor(current.width / 2);
                    const next = half.getContext("2d");
                    next.imageSmoothingQuality = "high";
                    next.drawImage(current, 0, 0, half.width, half.height);
                    current = half;
                }
                const out = document.createElement("canvas");
                out.width = out.height = size;
                const final = out.getContext("2d");
                final.imageSmoothingQuality = "high";
                final.drawImage(current, 0, 0, size, size);
                return out.toDataURL("image/png").slice("data:image/png;base64,".length);
            };
            return {
                bounds: { left, top, right, bottom, box },
                images: Object.fromEntries([512, ...sizes].map((size) => [size, render(size)])),
            };
        },
        { source, pad: PAD, sizes: ICO_SIZES },
    );
    await writeFile("resources/icon.png", Buffer.from(images[512], "base64"));
    const pngs = ICO_SIZES.map((size) => Buffer.from(images[size], "base64"));
    const header = Buffer.alloc(6 + 16 * ICO_SIZES.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(ICO_SIZES.length, 4);
    let offset = header.length;
    for (let i = 0; i < ICO_SIZES.length; i++) {
        const at = 6 + i * 16;
        header[at] = header[at + 1] = ICO_SIZES[i] === 256 ? 0 : ICO_SIZES[i];
        header.writeUInt16LE(1, at + 4);
        header.writeUInt16LE(32, at + 6);
        header.writeUInt32LE(pngs[i].length, at + 8);
        header.writeUInt32LE(offset, at + 12);
        offset += pngs[i].length;
    }
    await writeFile("resources/icon.ico", Buffer.concat([header, ...pngs]));
    console.error(JSON.stringify(bounds));
} finally {
    await browser.close();
}
