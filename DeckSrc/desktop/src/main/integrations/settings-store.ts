/*---------------------------------------------------------------
 * An integration's settings on this PC, kept by the fields it declares
 * (shared/integrations): not in the profile, so an exported profile never
 * carries a password. Secret fields are kept encrypted by Windows
 * (safeStorage), as the deck's Wi-Fi pairing is, and never go back to the
 * window - it only hears whether one is saved.
 *--------------------------------------------------------------*/

import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Integration, IntegrationStatus } from "../../shared/integrations/integration";

/** Each field's value, by key; empty for none. */
export type IntegrationValues = Record<string, string>;

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
    return Object.fromEntries(
        app.fields.map((field) => {
            const value = saved[field.key];
            if (typeof value !== "string" || !value) return [field.key, ""];
            try {
                const plain = field.secret
                    ? safeStorage.decryptString(Buffer.from(value, "base64"))
                    : value;
                return [field.key, plain];
            } catch {
                return [field.key, ""];
            }
        }),
    );
}

export async function saveIntegrationValues(
    path: string,
    app: Integration,
    values: IntegrationValues,
): Promise<void> {
    const secrets = app.fields.filter((field) => field.secret && values[field.key]);
    if (secrets.length && !safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential protection is unavailable.");
    const stored = Object.fromEntries(
        app.fields.map(({ key, secret: hidden }) => {
            const value = values[key] ?? "";
            return [
                key,
                hidden && value ? safeStorage.encryptString(value).toString("base64") : value,
            ];
        }),
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
