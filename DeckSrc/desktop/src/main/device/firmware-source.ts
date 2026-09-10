/*---------------------------------------------------------------
 * Where firmware to install comes from: the copy bundled with this app, or the
 * newest release on GitHub. Each release carries the installer and the firmware
 * files together; the firmware keeps its own version, stated in manifest.json.
 *
 * Either way it arrives as a manifest plus images, and nothing is handed to the
 * flasher until every image matches the manifest's SHA-256 and the manifest
 * itself has passed validateManifest - which is what refuses a package that
 * would overwrite the Wi-Fi settings or the flash data partition.
 *--------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest, type FirmwareManifest } from "../../shared/firmware";

export interface FirmwarePackage {
    manifest: FirmwareManifest;
    images: Map<string, Uint8Array>;
}

export interface FirmwareRelease {
    /** The firmware's version, from the release's manifest - not the release tag. */
    version: string;
    protocol: number;
    tag: string;
    /** Download URL of each release asset, by file name. */
    assets: Map<string, string>;
}

const MAX_ASSET_BYTES = 4 * 1024 * 1024;

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

function checked(manifest: FirmwareManifest, images: Map<string, Uint8Array>): FirmwarePackage {
    for (const part of manifest.parts) {
        const data = images.get(part.file);
        if (!data || data.length !== part.size || sha256(data) !== part.sha256)
            throw new Error(`${part.file} does not match the firmware manifest.`);
    }
    return { manifest, images };
}

/** Read a package from a folder holding manifest.json and its images. */
export async function loadPackage(folder: string): Promise<FirmwarePackage> {
    const manifest = validateManifest(
        JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")),
    );
    const images = new Map<string, Uint8Array>();
    for (const part of manifest.parts)
        images.set(part.file, new Uint8Array(await readFile(join(folder, part.file))));
    return checked(manifest, images);
}

/** The bundled package's manifest, or null when this build ships no firmware. */
export async function bundledManifest(folder: string): Promise<FirmwareManifest | null> {
    try {
        return validateManifest(JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")));
    } catch {
        return null;
    }
}

/**
 * The GitHub repository firmware releases come from, as "owner/name".
 *
 * Read from package.json's standard `repository` field, so a fork that changes
 * it gets its own releases rather than the upstream project's.
 */
export function repositoryOf(field: unknown): string | null {
    const text =
        typeof field === "string"
            ? field
            : typeof field === "object" && field !== null && "url" in field
              ? String((field as { url: unknown }).url)
              : "";
    const match = /(?:github:|github\.com[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
        text.trim(),
    );
    return match ? `${match[1]}/${match[2]}` : null;
}

async function fetchChecked(url: string, accept: string): Promise<Response> {
    const response = await fetch(url, {
        headers: { Accept: accept, "User-Agent": "Decky-desktop" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}.`);
    return response;
}

/**
 * The firmware in the newest published release, or null when there is none.
 *
 * Releases are numbered for the app; the firmware inside only changes version
 * when its own code changed, so its version is read from the manifest. The
 * newest release always holds the newest firmware, because a release is built
 * from everything on main at that point.
 */
export async function latestRelease(repository: string): Promise<FirmwareRelease | null> {
    const response = await fetchChecked(
        `https://api.github.com/repos/${repository}/releases?per_page=30`,
        "application/vnd.github+json",
    );
    const releases = (await response.json()) as {
        tag_name?: string;
        draft?: boolean;
        prerelease?: boolean;
        published_at?: string | null;
        assets?: { name?: string; browser_download_url?: string; size?: number }[];
    }[];
    const candidates: (Omit<FirmwareRelease, "version" | "protocol"> & { published: number })[] =
        [];
    for (const release of Array.isArray(releases) ? releases : []) {
        if (!release.tag_name || release.draft || release.prerelease) continue;
        const assets = new Map<string, string>();
        for (const asset of release.assets ?? [])
            if (asset.name && asset.browser_download_url && (asset.size ?? 0) <= MAX_ASSET_BYTES)
                assets.set(asset.name, asset.browser_download_url);
        if (assets.has("manifest.json"))
            candidates.push({
                tag: release.tag_name,
                assets,
                published: Date.parse(release.published_at ?? "") || 0,
            });
    }
    const newest = candidates.sort((a, b) => b.published - a.published)[0];
    if (!newest) return null;
    const manifest = validateManifest(
        await (
            await fetchChecked(newest.assets.get("manifest.json")!, "application/octet-stream")
        ).json(),
    );
    return {
        tag: newest.tag,
        assets: newest.assets,
        version: manifest.version,
        protocol: manifest.protocol,
    };
}

/**
 * Download a release's images, verify them, and keep them for next time.
 *
 * Cached per version under `cacheFolder`, so a deck can be updated again - or a
 * second deck set up - without downloading anything.
 */
export async function downloadRelease(
    release: FirmwareRelease,
    cacheFolder: string,
): Promise<FirmwarePackage> {
    const folder = join(cacheFolder, release.version);
    try {
        return await loadPackage(folder);
    } catch {
        // Not cached yet, or a partial download: fetch it fresh.
    }
    const manifestBytes = new Uint8Array(
        await (
            await fetchChecked(release.assets.get("manifest.json")!, "application/octet-stream")
        ).arrayBuffer(),
    );
    const manifest = validateManifest(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
    if (manifest.version !== release.version)
        throw new Error("The release's manifest describes a different version.");
    const images = new Map<string, Uint8Array>();
    for (const part of manifest.parts) {
        const url = release.assets.get(part.file);
        if (!url) throw new Error(`The release has no ${part.file}.`);
        images.set(
            part.file,
            new Uint8Array(
                await (await fetchChecked(url, "application/octet-stream")).arrayBuffer(),
            ),
        );
    }
    const verified = checked(manifest, images);
    await mkdir(folder, { recursive: true });
    for (const [file, data] of images) await writeFile(join(folder, file), data);
    // Last, so a cached folder with a manifest is always complete.
    await writeFile(join(folder, "manifest.json"), manifestBytes);
    return verified;
}
