import { Buffer } from "node:buffer";
/* global console, process */
import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Everything the build produced has to reach the installed app. electron-builder
// silently drops files by extension - *.obj was one, and the installed app lost
// its 3D model - so this compares out/ and resources/ with the packed app.asar.
// Run after electron-builder: node scripts/package-check.mjs
const ASAR = "dist/win-unpacked/resources/app.asar";
// Left out on purpose by build.files in package.json.
const LEFT_OUT = /\.map$/;
const REQUIRED = [
    "out/renderer/models/decky.glb",
    "resources/firmware/manifest.json",
    // The only serial binding kept; the others are left out by build.files.
    "node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/node.napi.node",
];

/** Every file path inside an asar archive, from its JSON header. */
function packed(path) {
    const file = openSync(path, "r");
    try {
        // A pickled header: [4][header size][payload size][JSON length], then the JSON.
        const prefix = Buffer.alloc(16);
        readSync(file, prefix, 0, 16, 0);
        const json = Buffer.alloc(prefix.readUInt32LE(12));
        readSync(file, json, 0, json.length, 16);
        const names = new Set();
        const walk = (node, prefix) => {
            for (const [name, entry] of Object.entries(node.files)) {
                const full = prefix ? `${prefix}/${name}` : name;
                if (entry.files) walk(entry, full);
                else names.add(full);
            }
        };
        walk(JSON.parse(json.toString("utf8")), "");
        return names;
    } finally {
        closeSync(file);
    }
}

function built(folder) {
    return readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(".", join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

if (!existsSync(ASAR)) {
    console.error(`${ASAR} is missing: run electron-builder first.`);
    process.exit(1);
}
const inside = packed(ASAR);
const missing = [
    ...[...built("out"), ...built("resources")].filter((file) => !LEFT_OUT.test(file)),
    ...REQUIRED,
].filter((file, index, all) => all.indexOf(file) === index && !inside.has(file));
if (missing.length) {
    console.error(`Missing from ${ASAR}:\n  ${missing.join("\n  ")}`);
    process.exit(1);
}
console.error(
    `Package check passed: ${inside.size} files, the 3D model, firmware and serial binding.`,
);
