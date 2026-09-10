import { Buffer } from "node:buffer";
/* global console */
import { readFile, writeFile } from "node:fs/promises";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

// The disconnected screen's deck, from the CAD export, as a binary glTF.
//
// The app cannot ship the OBJ itself: electron-builder leaves every *.obj out of
// the package (its default ignore list treats them as compiler output), so the
// installed app had no model. A GLB also parses without reading 6 MB of text.
//
// Nothing is lost: positions and normals stay float32, exactly as three.js reads
// them from the OBJ; identical vertices are merged into indexed triangles, and
// the texture coordinates are dropped (the app draws no textures). Each CAD body
// stays a named node - the app finds the glass and the top cover by name.
//
// Run after re-exporting the CAD model: node scripts/convert-model.mjs
const SOURCE = "../../3D Models/StreamDeck_CAD.obj";
const TARGET = "src/renderer/public/models/decky.glb";

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const TRIANGLES = 4;

const group = new OBJLoader().parse(await readFile(SOURCE, "utf8"));
const json = {
    asset: { version: "2.0", generator: "Decky scripts/convert-model.mjs" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
};
const chunks = [];
let offset = 0;

/** Append `data` to the binary chunk as its own buffer view; returns the view's index. */
function view(data, target) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const padding = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, Buffer.alloc(padding));
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + padding;
    return json.bufferViews.length - 1;
}

function accessor(data, componentType, type, target, bounds) {
    const components = { SCALAR: 1, VEC3: 3 }[type];
    json.accessors.push({
        bufferView: view(data, target),
        componentType,
        count: data.length / components,
        type,
        ...bounds,
    });
    return json.accessors.length - 1;
}

let before = 0;
let after = 0;
for (const mesh of group.children) {
    const position = mesh.geometry.getAttribute("position").array;
    const normal = mesh.geometry.getAttribute("normal").array;
    const count = position.length / 3;
    // Merge vertices whose position and normal match bit for bit.
    const bits = new Uint32Array(position.buffer, position.byteOffset, position.length);
    const normalBits = new Uint32Array(normal.buffer, normal.byteOffset, normal.length);
    const seen = new Map();
    const positions = [];
    const normals = [];
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        const key = `${bits[i * 3]},${bits[i * 3 + 1]},${bits[i * 3 + 2]},${normalBits[i * 3]},${normalBits[i * 3 + 1]},${normalBits[i * 3 + 2]}`;
        let index = seen.get(key);
        if (index === undefined) {
            index = positions.length / 3;
            seen.set(key, index);
            positions.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
            normals.push(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
        }
        indices[i] = index;
    }
    before += count;
    after += positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const packed = new Float32Array(positions);
    for (let i = 0; i < packed.length; i++) {
        min[i % 3] = Math.min(min[i % 3], packed[i]);
        max[i % 3] = Math.max(max[i % 3], packed[i]);
    }
    const small = positions.length / 3 <= 65535;
    const primitive = {
        attributes: {
            POSITION: accessor(packed, FLOAT, "VEC3", ARRAY_BUFFER, { min, max }),
            NORMAL: accessor(new Float32Array(normals), FLOAT, "VEC3", ARRAY_BUFFER),
        },
        indices: accessor(
            small ? new Uint16Array(indices) : indices,
            small ? UNSIGNED_SHORT : UNSIGNED_INT,
            "SCALAR",
            ELEMENT_ARRAY_BUFFER,
        ),
        mode: TRIANGLES,
    };
    json.meshes.push({ name: mesh.name, primitives: [primitive] });
    json.nodes.push({ name: mesh.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
}
json.buffers[0].byteLength = offset;

// GLB: a 12-byte header, then the JSON and binary chunks, each padded to 4 bytes.
const text = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHeader = (length, type) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(length, 0);
    bytes.writeUInt32LE(type, 4);
    return bytes;
};
const glb = Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a), // "JSON"
    jsonChunk,
    chunkHeader(binChunk.length, 0x004e4942), // "BIN\0"
    binChunk,
]);
await writeFile(TARGET, glb);
console.error(
    `${TARGET}: ${group.children.length} bodies, ${before} vertices merged to ${after}, ` +
        `${(glb.length / 1048576).toFixed(2)} MB`,
);
