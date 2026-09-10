/*---------------------------------------------------------------
 * Where firmware to install comes from: the copy bundled with this app, or the
 * newest release on GitHub. Each release carries the installer and the firmware
 * as one zip, decky-firmware-<version>.zip; the firmware keeps its own version,
 * stated in the manifest inside.
 *
 * Either way it arrives as a manifest plus images, and nothing is handed to the
 * flasher until every image matches the manifest's SHA-256 and the manifest
 * itself has passed validateManifest - which is what refuses a package that
 * would overwrite the Wi-Fi settings or the flash data partition.
 *--------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
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
    /** Download URL of the zip the firmware came from. */
    source: string;
    /** The firmware itself, every image already checked against its manifest. */
    firmware: FirmwarePackage;
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

/** The firmware package's file on a release, e.g. decky-firmware-0.1.1.zip. */
const FIRMWARE_ZIP = /^decky-firmware-[\w.+-]+\.zip$/;
/** Larger than the whole 4 MB flash, so bigger than any real image or package. */
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
 * Open a firmware zip: the manifest and the images it lists.
 *
 * Every entry's unpacked size is checked before anything is inflated, so a zip
 * that would expand into something huge is refused rather than unpacked.
 */
function unpack(zip: Uint8Array): FirmwarePackage {
    const files = unzipSync(zip, {
        filter: (file) => {
            if (file.originalSize > MAX_ASSET_BYTES)
                throw new Error("The firmware zip holds a file too large to be firmware.");
            return true;
        },
    });
    const manifestBytes = files["manifest.json"];
    if (!manifestBytes) throw new Error("The firmware zip has no manifest.json.");
    const manifest = validateManifest(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
    const images = new Map<string, Uint8Array>();
    for (const part of manifest.parts) {
        const data = files[part.file];
        if (!data) throw new Error(`The firmware zip has no ${part.file}.`);
        images.set(part.file, data);
    }
    return checked(manifest, images);
}

/**
 * The firmware in the newest published release, or null when there is none.
 *
 * Releases are numbered for the app; the firmware inside only changes version
 * when its own code changed, so its version is read from the manifest. The
 * newest release always holds the newest firmware, because a release is built
 * from everything on main at that point. `known` is the result of the last
 * look: while the newest release is unchanged, nothing is downloaded again.
 */
async function firmwareIn(
    releases: GitHubRelease[],
    known?: FirmwareRelease | null,
): Promise<FirmwareRelease | null> {
    for (const release of published(releases)) {
        const asset = release.assets?.find((item) => FIRMWARE_ZIP.test(item.name ?? ""));
        if (!asset?.browser_download_url || (asset.size ?? 0) > MAX_ASSET_BYTES) continue;
        if (known?.source === asset.browser_download_url) return known;
        const zip = new Uint8Array(
            await (
                await fetchChecked(asset.browser_download_url, "application/octet-stream")
            ).arrayBuffer(),
        );
        const firmware = unpack(zip);
        return {
            version: firmware.manifest.version,
            protocol: firmware.manifest.protocol,
            tag: release.tag_name,
            source: asset.browser_download_url,
            firmware,
        };
    }
    return null;
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
export async function latestRelease(
    repository: string,
    known?: FirmwareRelease | null,
): Promise<FirmwareRelease | null> {
    return firmwareIn(await fetchReleases(repository), known);
}

/** The newest firmware and the newest Decky, from one look at the release list. */
export async function latestReleases(
    repository: string,
    known?: FirmwareRelease | null,
): Promise<{ firmware: FirmwareRelease | null; app: AppRelease | null }> {
    const releases = await fetchReleases(repository);
    return { firmware: await firmwareIn(releases, known), app: appIn(releases, repository) };
}
