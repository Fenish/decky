import { Buffer } from "node:buffer";
/* global document, Image, console */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

// Icons built from the branding, each trimmed of its transparent margin so the
// mark fills the icon as other apps' do:
//   the app, taskbar, installer and tray icon, and
//   the one Windows puts on a .deckyprofile file.
const ICONS = [
    { source: "../../Branding/logo-app.png", png: "resources/icon.png", ico: "resources/icon.ico" },
    { source: "../../Branding/decky-profile.png", ico: "resources/profile.ico" },
];
const PAD = 0.008;
// Windows picks an entry per DPI: 16/20/24/32 for the tray, larger for the taskbar,
// Explorer and the installer. 256 is the size electron-builder requires.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** The sizes of one source, drawn in the page: base64 PNGs by size, and what was trimmed. */
async function drawIcon({ source, pad, sizes }) {
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
            if (pixels[(y * w + x) * 4 + 3] > 8) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
    if (right < 0) {
        left = top = 0;
        right = w - 1;
        bottom = h - 1;
    }
    const box = Math.max(right - left + 1, bottom - top + 1) * (1 + pad * 2);
    const current = document.createElement("canvas");
    current.width = current.height = Math.ceil(box);
    const middle = current.getContext("2d");
    middle.imageSmoothingQuality = "high";
    middle.drawImage(
        image,
        left - (box - (right - left + 1)) / 2,
        top - (box - (bottom - top + 1)) / 2,
        box,
        box,
        0,
        0,
        current.width,
        current.height,
    );
    const render = (size) => {
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
}

/** The sizes packed as an .ico. */
function packIco(images) {
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
    return Buffer.concat([header, ...pngs]);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    const page = await browser.newPage();
    for (const icon of ICONS) {
        const source = (await readFile(icon.source)).toString("base64");
        const { bounds, images } = await page.evaluate(drawIcon, {
            source,
            pad: PAD,
            sizes: ICO_SIZES,
        });
        if (icon.png) await writeFile(icon.png, Buffer.from(images[512], "base64"));
        await writeFile(icon.ico, packIco(images));
        console.error(`${icon.ico} ${JSON.stringify(bounds)}`);
    }
} finally {
    await browser.close();
}
