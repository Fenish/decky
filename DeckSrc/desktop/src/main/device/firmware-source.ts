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

/** A newer Decky, as the newest release that carries a Windows installer. */
export interface AppRelease {
    version: string;
    tag: string;
    /** The release's page on GitHub. */
    page: string;
    /** Download URL of the installer. */
    installer: string;
}

interface GitHubRelease {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    published_at?: string | null;
    html_url?: string;
    assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const APP_TAG = /^v(\d+\.\d+\.\d+)$/;
const INSTALLER = /^Decky-Setup-[\w.+-]+\.exe$/;

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

async function fetchReleases(repository: string): Promise<GitHubRelease[]> {
    const response = await fetchChecked(
        `https://api.github.com/repos/${repository}/releases?per_page=30`,
        "application/vnd.github+json",
    );
    const releases = (await response.json()) as unknown;
    return Array.isArray(releases) ? (releases as GitHubRelease[]) : [];
}

/** Published releases - no drafts, no pre-releases - newest first. */
function published(releases: GitHubRelease[]): (GitHubRelease & { tag_name: string })[] {
    return releases
        .filter((r): r is GitHubRelease & { tag_name: string } =>
            Boolean(r.tag_name && !r.draft && !r.prerelease),
        )
        .map((release) => ({ release, at: Date.parse(release.published_at ?? "") || 0 }))
        .sort((a, b) => b.at - a.at)
        .map(({ release }) => release);
}

/**
 * The firmware in the newest published release, or null when there is none.
 *
 * Releases are numbered for the app; the firmware inside only changes version
 * when its own code changed, so its version is read from the manifest. The
 * newest release always holds the newest firmware, because a release is built
 * from everything on main at that point.
 */
async function firmwareIn(releases: GitHubRelease[]): Promise<FirmwareRelease | null> {
    let newest: Omit<FirmwareRelease, "version" | "protocol"> | null = null;
    for (const release of published(releases)) {
        const assets = new Map<string, string>();
        for (const asset of release.assets ?? [])
            if (asset.name && asset.browser_download_url && (asset.size ?? 0) <= MAX_ASSET_BYTES)
                assets.set(asset.name, asset.browser_download_url);
        if (assets.has("manifest.json")) {
            newest = { tag: release.tag_name, assets };
            break;
        }
    }
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

/** The newest published Decky with a Windows installer, or null when there is none. */
function appIn(releases: GitHubRelease[], repository: string): AppRelease | null {
    for (const release of published(releases)) {
        const version = APP_TAG.exec(release.tag_name)?.[1];
        const installer = release.assets?.find((asset) =>
            INSTALLER.test(asset.name ?? ""),
        )?.browser_download_url;
        if (version && installer)
            return {
                version,
                tag: release.tag_name,
                page:
                    release.html_url ??
                    `https://github.com/${repository}/releases/tag/${release.tag_name}`,
                installer,
            };
    }
    return null;
}

/** The newest firmware in a published release. */
export async function latestRelease(repository: string): Promise<FirmwareRelease | null> {
    return firmwareIn(await fetchReleases(repository));
}

/** The newest firmware and the newest Decky, from one look at the release list. */
export async function latestReleases(
    repository: string,
): Promise<{ firmware: FirmwareRelease | null; app: AppRelease | null }> {
    const releases = await fetchReleases(repository);
    return { firmware: await firmwareIn(releases), app: appIn(releases, repository) };
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
