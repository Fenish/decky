/*---------------------------------------------------------------
 * A profile as one file: `<name>.deckyprofile`, which carries everything a
 * setup needs - its pages and keys, what the apps it talks to are set to, and
 * the scripts its keys run - so it opens on a PC that has never seen any of
 * it.
 *
 * The file is a header, then the setup gzipped and encrypted with a key
 * Decky carries (AES-256-GCM). That stops it being read or edited in a text
 * editor and makes it plainly Decky's; it is not secrecy, since every Decky
 * has the same key. Nothing secret goes in: an app's password or token stays
 * on the PC it was typed on (settings-store.ts keeps those for Windows to
 * encrypt), and an imported profile asks for them again.
 *
 * What is carried and what is only remembered is not decided here: each kind
 * of action says so itself (ACTION_FILES in shared/config.ts), so a new kind
 * is carried the day it exists.
 *--------------------------------------------------------------*/

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { basename, extname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { actionFiles, movedAction, retireWidgets, validateConfig } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import { WIDGET_KINDS } from "../../shared/widgets/registry";

/** What every .deckyprofile starts with, and the shape of the rest. */
const MAGIC = Buffer.from("DECKYPRF");
const FORMAT = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/**
 * The key every Decky opens these with. It is in the app, so it keeps the
 * file out of a text editor rather than out of anyone's hands - see the
 * comment at the top before treating it as a secret.
 */
const APP_SECRET = "Decky profile, 2026. Not a secret: every Decky has this.";

/** One file a profile carries, as it was on the PC it came from. */
export interface BundleFile {
    /** Where it lived there, so keys pointing at it can be found. */
    path: string;
    /** Its bytes, base64. */
    body: string;
}

/** What a .deckyprofile holds. */
export interface ProfileBundle {
    meta: {
        name: string;
        /** When it was exported (epoch ms), and by which Decky. */
        madeAt: number;
        app: string;
    };
    profile: DeckConfig;
    /** Each app's settings, secrets left out; by integration id. */
    integrations: Record<string, Record<string, string>>;
    files: BundleFile[];
    /**
     * Widgets this Decky no longer has, counted as the file was read - their
     * keys are dropped, and the inspector says so before anything is imported.
     * Worked out on the way in; never written.
     */
    retired?: { type: string; count: number }[];
}

/** No single file larger than this travels, and no bundle larger than that. */
export const FILE_MAX = 4 * 1024 * 1024;
export const BUNDLE_MAX = 64 * 1024 * 1024;

export const PROFILE_EXTENSION = ".deckyprofile";

/** The key for a file, from its salt. */
function keyFor(salt: Buffer): Buffer {
    return scryptSync(APP_SECRET, salt, 32);
}

/** A bundle as the bytes of a .deckyprofile. */
export function packBundle(bundle: ProfileBundle): Buffer {
    const { retired: _retired, ...written } = bundle;
    const body = gzipSync(Buffer.from(JSON.stringify(written), "utf8"), { level: 9 });
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", keyFor(salt), iv);
    const sealed = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([MAGIC, Buffer.from([FORMAT]), salt, iv, cipher.getAuthTag(), sealed]);
}

/**
 * What a .deckyprofile holds, or an error saying why it cannot be read: not
 * one, made by a newer Decky, or damaged.
 */
export function unpackBundle(bytes: Buffer): ProfileBundle {
    const head = MAGIC.length + 1;
    if (
        bytes.length < head + SALT_BYTES + IV_BYTES + TAG_BYTES ||
        !bytes.subarray(0, MAGIC.length).equals(MAGIC)
    )
        throw new Error("That is not a Decky profile.");
    const format = bytes[MAGIC.length]!;
    if (format > FORMAT) throw new Error("This profile was made by a newer Decky.");
    let at = head;
    const salt = bytes.subarray(at, (at += SALT_BYTES));
    const iv = bytes.subarray(at, (at += IV_BYTES));
    const tag = bytes.subarray(at, (at += TAG_BYTES));
    const decipher = createDecipheriv("aes-256-gcm", keyFor(salt), iv);
    decipher.setAuthTag(tag);
    let plain: Buffer;
    try {
        plain = Buffer.concat([decipher.update(bytes.subarray(at)), decipher.final()]);
    } catch {
        throw new Error("This profile is damaged.");
    }
    const bundle: unknown = JSON.parse(gunzipSync(plain).toString("utf8"));
    return readBundle(bundle);
}

/** A bundle read from outside, checked field by field. */
function readBundle(value: unknown): ProfileBundle {
    if (typeof value !== "object" || value === null) throw new Error("This profile is damaged.");
    const { meta, profile, integrations, files } = value as Record<string, unknown>;
    // A profile may name a widget this Decky has retired: its keys go, and
    // what went is counted for the inspector rather than refusing the file.
    const retired = retiredWidgets(profile);
    retireWidgets(profile);
    try {
        validateConfig(profile);
    } catch (error) {
        throw new Error(
            `This profile has something this Decky does not know: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const read = (v: unknown): Record<string, string> =>
        typeof v === "object" && v !== null
            ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>)
                      .filter(([, item]) => typeof item === "string")
                      .map(([key, item]) => [key, String(item)]),
              )
            : {};
    const meta_ = (meta ?? {}) as Record<string, unknown>;
    return {
        meta: {
            name: typeof meta_.name === "string" ? meta_.name : "Profile",
            madeAt: typeof meta_.madeAt === "number" ? meta_.madeAt : 0,
            app: typeof meta_.app === "string" ? meta_.app : "",
        },
        profile,
        integrations: Object.fromEntries(
            Object.entries(
                typeof integrations === "object" && integrations !== null
                    ? (integrations as Record<string, unknown>)
                    : {},
            ).map(([app, values]) => [app, read(values)]),
        ),
        files: (Array.isArray(files) ? files : [])
            .filter(
                (file): file is BundleFile =>
                    typeof file === "object" &&
                    file !== null &&
                    typeof (file as BundleFile).path === "string" &&
                    typeof (file as BundleFile).body === "string",
            )
            .map((file) => ({ path: file.path, body: file.body })),
        retired,
    };
}

/** Widget types in a saved profile that this Decky no longer has, counted. */
export function retiredWidgets(profile: unknown): { type: string; count: number }[] {
    const counts = new Map<string, number>();
    const pages = (profile as { pages?: unknown })?.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
        const keys = (page as { keys?: unknown })?.keys;
        if (typeof keys !== "object" || keys === null) continue;
        for (const key of Object.values(keys as Record<string, unknown>)) {
            const action = (key as { action?: { kind?: unknown; widget?: { type?: unknown } } })
                ?.action;
            if (action?.kind !== "widget") continue;
            const type = action.widget?.type;
            if (typeof type !== "string" || Object.hasOwn(WIDGET_KINDS, type)) continue;
            counts.set(type, (counts.get(type) ?? 0) + 1);
        }
    }
    return [...counts].map(([type, count]) => ({ type, count }));
}

/** Every file the profile's keys use, by what each kind of action says it keeps. */
export function profileFiles(config: DeckConfig): { path: string; carried: boolean }[] {
    const found = new Map<string, boolean>();
    for (const page of config.pages)
        for (const key of Object.values(page.keys))
            for (const file of actionFiles(key.action))
                found.set(file.path, (found.get(file.path) ?? false) || file.carried);
    return [...found].map(([path, carried]) => ({ path, carried }));
}

/**
 * The carried files, read from disk. One too large, or gone, is left out and
 * named: the profile still travels, and the inspector says what is missing.
 */
export async function readProfileFiles(
    config: DeckConfig,
): Promise<{ files: BundleFile[]; missing: string[] }> {
    const files: BundleFile[] = [];
    const missing: string[] = [];
    let total = 0;
    for (const { path, carried } of profileFiles(config)) {
        if (!carried) continue;
        try {
            const body = await readFile(path);
            if (body.length > FILE_MAX || total + body.length > BUNDLE_MAX) {
                missing.push(path);
                continue;
            }
            total += body.length;
            files.push({ path, body: body.toString("base64") });
        } catch {
            missing.push(path);
        }
    }
    return { files, missing };
}

/**
 * Write a bundle's files into a profile's own folder and point its keys at
 * them there, so the setup works on this PC and goes when the profile does.
 * A name already taken gets a number, and nothing is written outside `folder`.
 */
export async function placeFiles(
    bundle: ProfileBundle,
    folder: string,
): Promise<{ config: DeckConfig; placed: Map<string, string> }> {
    const placed = new Map<string, string>();
    if (bundle.files.length) await mkdir(folder, { recursive: true });
    const taken = new Set<string>();
    for (const file of bundle.files) {
        const stem = basename(file.path.replace(/\\/g, "/")) || "script";
        const extension = extname(stem);
        const bare = extension ? stem.slice(0, -extension.length) : stem;
        let name = safeName(stem);
        for (let n = 2; taken.has(name.toLowerCase()); n++)
            name = safeName(`${bare} ${n}${extension}`);
        taken.add(name.toLowerCase());
        const target = join(folder, name);
        await writeFile(target, Buffer.from(file.body, "base64"));
        placed.set(file.path, target);
    }
    const config: DeckConfig = {
        ...bundle.profile,
        pages: bundle.profile.pages.map((page) => ({
            ...page,
            keys: Object.fromEntries(
                Object.entries(page.keys).map(([cell, key]) => [
                    cell,
                    { ...key, action: movedAction(key.action, (path) => placed.get(path) ?? path) },
                ]),
            ),
        })),
    };
    return { config, placed };
}

/** A file name Windows takes, from whatever the bundle called it. */
function safeName(name: string): string {
    // What Windows refuses in a name, and what it refuses to see: both go.
    const refused = '<>:"/\\|?*';
    const clean = [...name]
        .map((c) => (c.charCodeAt(0) < 32 || refused.includes(c) ? "-" : c))
        .join("")
        .replace(/^\.+/, "")
        .trim();
    return (clean || "script").slice(0, 120);
}
