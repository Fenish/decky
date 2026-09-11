/*---------------------------------------------------------------
 * What the deck's lines say: who it is, and what it reports without being
 * asked. Plain parsing with no timing rules; those stay with the link, in
 * serial.ts.
 *--------------------------------------------------------------*/

import type { DeckEvent, DeckIdentity } from "../../shared/api";

/**
 * Read the deck's identity line.
 *
 * Shape: `OK id streamdeck 1 <mac> cells=15 cols=5 rows=3 w=118 h=123`.
 * Anything that does not start that way is some other device answering, and is
 * rejected rather than guessed at.
 */
export function parseIdentity(line: string, path: string): DeckIdentity | null {
    const parts = line.trim().split(/\s+/);
    if (
        parts[0] !== "OK" ||
        parts[1] !== "id" ||
        !["streamdeck", "decky"].includes(parts[2] ?? "")
    ) {
        return null;
    }

    const fields = new Map<string, number>();
    for (const part of parts.slice(5)) {
        const [key, value] = part.split("=");
        if (key !== undefined && value !== undefined && /^\d+$/.test(value)) {
            fields.set(key, Number(value));
        }
    }

    const cells = fields.get("cells");
    const columns = fields.get("cols");
    const rows = fields.get("rows");
    const keyWidth = fields.get("w");
    const keyHeight = fields.get("h");
    // Added after the first firmware; a board without it has exactly one page.
    const pages = fields.get("pages") ?? 1;

    if (
        cells === undefined ||
        columns === undefined ||
        rows === undefined ||
        keyWidth === undefined ||
        keyHeight === undefined
    ) {
        return null;
    }

    if (
        cells !== 15 ||
        columns !== 5 ||
        rows !== 3 ||
        keyWidth < 1 ||
        keyWidth > 256 ||
        keyHeight < 1 ||
        keyHeight > 256 ||
        ![1, 2, 3, 4, 5, 6, 7].includes(Number(parts[3])) ||
        !/^[a-f0-9]{12}$/i.test(parts[4] ?? "")
    )
        return null;

    return {
        portPath: path,
        protocol: Number(parts[3] ?? 0),
        serial: parts[4] ?? "",
        cells,
        columns,
        rows,
        keyWidth,
        keyHeight,
        pages,
        cacheSlots: fields.get("cache") ?? 8,
        persistentCache: fields.get("storage") === 1,
        live: fields.get("live") === 1,
        drag: fields.get("drag") === 1,
        wheel: fields.get("wheel") === 1,
        dial: fields.get("dial") === 1,
        warm: fields.get("warm") === 1,
        block: fields.get("block"),
        slide: fields.get("slide") === 1,
        sweep: fields.get("sweep") === 1,
        // Reported from protocol 7 on; older firmware has no version to show.
        firmwareVersion: parts
            .slice(5)
            .find((part) => /^fw=[\w.+-]{1,48}$/.test(part))
            ?.slice(3),
        resetReason: parts
            .slice(5)
            .find((part) => /^reset=[a-z]{1,16}$/.test(part))
            ?.slice(6),
    };
}

/**
 * Read an unsolicited line from the deck.
 *
 * `EV <page> <cell> DOWN|UP` for a press, `EV <page> <cell> MOVE <y>` for a
 * finger moving on a key the deck was asked about with `DRAG`,
 * `EV <page> <cell> WHEEL <index>` for a wheel it came to rest, `PAGE <n>` when
 * the deck navigates. Returns null for anything else, which is most lines -
 * the deck also prints human-readable diagnostics that are none of this app's
 * business.
 */
export function parseEvent(line: string): DeckEvent | null {
    const parts = line.split(/\s+/);
    return EVENT_LINES.get(parts[0]!)?.(parts, line) ?? null;
}

/** The lines the deck sends unprompted, by their first word. */
const EVENT_LINES = new Map<string, (parts: string[], line: string) => DeckEvent | null>([
    [
        "BOOT",
        (_parts, line) =>
            /^BOOT decky [3-7]$/.test(line) ? { kind: "reset", at: Date.now() } : null,
    ],
    [
        "EV",
        (parts) => {
            if (parts.length < 4) return null;
            const page = Number(parts[1]);
            const cell = Number(parts[2]);
            const key =
                Number.isInteger(page) &&
                Number.isInteger(cell) &&
                page >= 0 &&
                cell >= 0 &&
                cell < 15 &&
                page < 64;
            const read = key ? KEY_EDGES.get(parts[3]!) : undefined;
            return read ? read(page, cell, Number(parts[4])) : null;
        },
    ],
    [
        "PAGE",
        (parts) => {
            const page = Number(parts[1]);
            return parts.length >= 2 && Number.isInteger(page) && page >= 0
                ? { kind: "page", page, at: Date.now() }
                : null;
        },
    ],
]);

/**
 * What `EV <page> <cell> <edge> [value]` says about a key, by its edge; null
 * for a value out of range.
 */
const KEY_EDGES = new Map<string, (page: number, cell: number, value: number) => DeckEvent | null>([
    ["DOWN", (page, cell) => ({ kind: "key", page, cell, down: true, at: Date.now() })],
    ["UP", (page, cell) => ({ kind: "key", page, cell, down: false, at: Date.now() })],
    [
        "MOVE",
        (page, cell, value) =>
            Number.isInteger(value) && Math.abs(value) < 10_000
                ? { kind: "move", page, cell, y: value, at: Date.now() }
                : null,
    ],
    [
        "WHEEL",
        (page, cell, value) =>
            Number.isInteger(value) && value >= 0 && value < 1000
                ? { kind: "wheel", page, cell, index: value, at: Date.now() }
                : null,
    ],
    [
        "VALUE",
        (page, cell, value) =>
            Number.isInteger(value) && value >= 0 && value <= 1000
                ? { kind: "value", page, cell, value, at: Date.now() }
                : null,
    ],
]);
