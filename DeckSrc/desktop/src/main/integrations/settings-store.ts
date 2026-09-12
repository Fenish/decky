/*---------------------------------------------------------------
 * An integration's settings, kept by the fields it declares
 * (shared/integrations).
 *
 * What an app is set to belongs to the profile - which OBS to talk to, what
 * to count - and lives in its folder. What proves who you are does not: a
 * password or a token was typed on this PC and is the PC's, so it is kept
 * once, beside profiles.json, and every profile uses it. Switching profiles
 * therefore never signs you out of Discord or asks for OBS's password again.
 *
 * Secrets are encrypted by Windows (safeStorage), as the deck's Wi-Fi pairing
 * is, and never go back to the window - it only hears whether one is saved.
 * They are never written into an exported profile (travellingValues).
 *--------------------------------------------------------------*/

import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Integration, IntegrationStatus } from "../../shared/integrations/integration";

/** Each field's value, by key; empty for none. */
export type IntegrationValues = Record<string, string>;

/** Where this PC's secrets live: set once at startup, shared by every profile. */
let secretsFolder = "";
export function useSecretsFolder(folder: string): void {
    secretsFolder = join(folder, "secrets");
}
const secretsPath = (app: string): string => join(secretsFolder, `${app}.json`);

/** What is kept for an app on this PC: its secrets, encrypted, by field. */
async function readSecrets(app: string): Promise<Record<string, string>> {
    if (!secretsFolder) return {};
    try {
        const saved: unknown = JSON.parse(await readFile(secretsPath(app), "utf8"));
        return typeof saved === "object" && saved !== null ? (saved as Record<string, string>) : {};
    } catch {
        return {};
    }
}

async function writeSecrets(app: string, sealed: Record<string, string>): Promise<void> {
    if (!secretsFolder) return;
    await mkdir(secretsFolder, { recursive: true });
    const path = secretsPath(app);
    await writeFile(`${path}.tmp`, JSON.stringify(sealed), "utf8");
    await rename(`${path}.tmp`, path);
}

/** One secret of an app's, as it stands on this PC; empty for none. */
export async function loadSecret(app: string, key: string): Promise<string> {
    const sealed = (await readSecrets(app))[key];
    if (!sealed) return "";
    try {
        return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
        return "";
    }
}

/** Keep one secret of an app's for this PC, or take it away with "". */
export async function saveSecret(app: string, key: string, value: string): Promise<void> {
    const sealed = await readSecrets(app);
    if (value && safeStorage.isEncryptionAvailable())
        sealed[key] = safeStorage.encryptString(value).toString("base64");
    else delete sealed[key];
    await writeSecrets(app, sealed);
}

export async function loadIntegrationValues(
    path: string,
    app: Integration,
): Promise<IntegrationValues> {
    let saved: Record<string, unknown> = {};
    try {
        saved = JSON.parse(await readFile(path, "utf8"));
    } catch {
        // None saved yet.
    }
    const values: IntegrationValues = {};
    for (const field of app.fields) {
        if (!field.secret) {
            const value = saved[field.key];
            values[field.key] = typeof value === "string" ? value : "";
            continue;
        }
        // The PC's, wherever it was typed. One left in a profile's own file by
        // a Decky before secrets moved is taken up, so nobody signs in twice.
        let secret = await loadSecret(app.id, field.key);
        const older = saved[field.key];
        if (!secret && typeof older === "string" && older) {
            try {
                secret = safeStorage.decryptString(Buffer.from(older, "base64"));
                await saveSecret(app.id, field.key, secret);
            } catch {
                secret = "";
            }
        }
        values[field.key] = secret;
    }
    return values;
}

export async function saveIntegrationValues(
    path: string,
    app: Integration,
    values: IntegrationValues,
): Promise<void> {
    const secrets = app.fields.filter((field) => field.secret && values[field.key]);
    if (secrets.length && !safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential protection is unavailable.");
    // What the app is set to goes with the profile; what proves who you are
    // goes to the PC, for every profile to use.
    for (const field of app.fields.filter((item) => item.secret))
        await saveSecret(app.id, field.key, values[field.key] ?? "");
    const stored = Object.fromEntries(
        app.fields.filter((field) => !field.secret).map(({ key }) => [key, values[key] ?? ""]),
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(stored), "utf8");
    await rename(`${path}.tmp`, path);
}

/**
 * The settings of an app that may travel in an exported profile: what it is
 * set to, but never a password or a token - those were typed on this PC and
 * are kept for Windows to encrypt (this file's header). An imported profile
 * asks for them again.
 */
export async function travellingValues(path: string, app: Integration): Promise<IntegrationValues> {
    const values = await loadIntegrationValues(path, app);
    return Object.fromEntries(
        app.fields
            .filter((field) => !field.secret)
            .map((field) => [field.key, values[field.key] ?? ""]),
    );
}

/**
 * The values a save asks for over the saved ones: each field a string within
 * its length, text trimmed; a secret left null keeps the one saved. Null when
 * the request is not one.
 */
export function askedValues(
    app: Integration,
    saved: IntegrationValues,
    asked: unknown,
): IntegrationValues | null {
    if (typeof asked !== "object" || asked === null) return null;
    const next: IntegrationValues = {};
    for (const field of app.fields) {
        const value = (asked as Record<string, unknown>)[field.key];
        if (value === null && field.secret) next[field.key] = saved[field.key] ?? "";
        else if (typeof value === "string" && value.length <= field.maxLength)
            next[field.key] = field.secret ? value : value.trim();
        else return null;
    }
    return next;
}

/** The settings as the window may see them: text fields' values, and whether each secret is saved. */
export function shownValues(
    app: Integration,
    values: IntegrationValues,
): Pick<IntegrationStatus, "values" | "saved"> {
    const shown: IntegrationStatus["values"] = {};
    const saved: IntegrationStatus["saved"] = {};
    for (const { key, secret } of app.fields) {
        if (secret) saved[key] = (values[key] ?? "") !== "";
        else shown[key] = values[key] ?? "";
    }
    return { values: shown, saved };
}
