import { app, nativeImage } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validProgramTarget } from "../../shared/programs";
import type { InstalledProgram } from "../../shared/programs";
interface CatalogProgram extends InstalledProgram {
    iconPath?: string;
    iconIsImage?: boolean;
}
const execute = promisify(execFile);
// Fixed read-only discovery script. Search text is never passed to PowerShell.
const DISCOVER = String.raw`
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$apps=New-Object 'System.Collections.Generic.List[object]'
$ws=New-Object -ComObject WScript.Shell
$roots=@([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms')) | Select-Object -Unique
foreach($root in $roots){
 if(!$root){continue}
 Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -File | ForEach-Object {
  $shortcut=$ws.CreateShortcut($_.FullName)
  if($shortcut.TargetPath -and (Test-Path -LiteralPath $shortcut.TargetPath -PathType Leaf)){
   $iconPath=([string]$shortcut.IconLocation -replace ',\s*-?\d+$','').Trim('"')
   $iconIsImage=($iconPath -match '\.(ico|png|jpg|jpeg)$')
   if(!$iconIsImage -or !(Test-Path -LiteralPath $iconPath -PathType Leaf)){$iconPath=$shortcut.TargetPath;$iconIsImage=$false}
   $apps.Add([pscustomobject]@{name=$_.BaseName;path=$_.FullName;source='start-menu';iconPath=$iconPath;iconIsImage=$iconIsImage})
  }
 }
}
$registry=@('Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths','Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths','Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')
foreach($root in $registry){
 Get-ChildItem -LiteralPath $root | ForEach-Object {
  $target=[string]$_.GetValue('')
  $target=[Environment]::ExpandEnvironmentVariables($target.Trim('"'))
  if($target -match '\.exe$' -and (Test-Path -LiteralPath $target -PathType Leaf)){
   $apps.Add([pscustomobject]@{name=[IO.Path]::GetFileNameWithoutExtension($_.PSChildName);path=$target;source='registered';iconPath=$target;iconIsImage=$false})
  }
 }
}

$packages=@{}
Get-AppxPackage | ForEach-Object {$packages[$_.PackageFamilyName]=$_.InstallLocation}
$manifests=@{}
function Find-AppIcon([string]$identifier){
 $parts=$identifier.Split('!')
 if($parts.Count -ne 2 -or !$packages.ContainsKey($parts[0])){return $null}
 $root=$packages[$parts[0]]
 if(!$manifests.ContainsKey($root)){$manifests[$root]=[xml](Get-Content -LiteralPath (Join-Path $root 'AppxManifest.xml') -Raw)}
 $manifest=$manifests[$root]
 $application=$manifest.Package.Applications.Application | Where-Object {$_.Id -eq $parts[1]} | Select-Object -First 1
 $visual=$application.ChildNodes | Where-Object {$_.LocalName -eq 'VisualElements'} | Select-Object -First 1
 $logo=$null
 if($visual){$logo=$visual.GetAttribute('Square44x44Logo');if(!$logo){$logo=$visual.GetAttribute('Square150x150Logo')}}
 if(!$logo){$logo=[string]$manifest.Package.Properties.Logo}
 if(!$logo){return $null}
 $file=Join-Path $root $logo
 if(Test-Path -LiteralPath $file -PathType Leaf){return $file}
 $folder=Split-Path -Parent $file
 $stem=[IO.Path]::GetFileNameWithoutExtension($file)
 $candidate=Get-ChildItem -LiteralPath $folder -Filter ($stem+'*.png') -File | Sort-Object @{Expression={if($_.Name -match 'targetsize-32.*unplated'){0}elseif($_.Name -match 'targetsize-48.*unplated'){1}elseif($_.Name -match 'targetsize-64.*unplated'){2}elseif($_.Name -match 'unplated'){3}elseif($_.Name -match 'scale-200'){4}else{5}}} | Select-Object -First 1
 if($candidate){return $candidate.FullName}
 return $null
}
Get-StartApps | ForEach-Object {
 if($_.Name -and $_.AppID){$icon=Find-AppIcon ([string]$_.AppID);$apps.Add([pscustomobject]@{name=[string]$_.Name;path=('app:'+[string]$_.AppID);source='windows';iconPath=$icon;iconIsImage=$true})}
}
ConvertTo-Json -InputObject @($apps.ToArray()) -Compress -Depth 3
`;
let cache: CatalogProgram[] | null = null;
let cachedAt = 0;
let pending: Promise<CatalogProgram[]> | null = null;
export function normalizePrograms(value: unknown): CatalogProgram[] {
    if (!Array.isArray(value)) throw new Error("Windows returned an invalid application list.");
    const names = new Set<string>();
    const paths = new Set<string>();
    const result: CatalogProgram[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) continue;
        const candidate = item as Partial<CatalogProgram>;
        if (
            typeof candidate.name !== "string" ||
            candidate.name.length > 160 ||
            !candidate.name.trim() ||
            !validProgramTarget(candidate.path) ||
            !["start-menu", "registered", "windows"].includes(candidate.source ?? "")
        )
            continue;
        const name = candidate.name.trim();
        const key = name.toLocaleLowerCase();
        const path = candidate.path.toLocaleLowerCase();
        // Prefer the Start menu entry because it preserves arguments and working directory.
        if (names.has(key) || paths.has(path)) continue;
        names.add(key);
        paths.add(path);
        result.push({
            name,
            path: candidate.path,
            source: candidate.source!,
            ...(typeof candidate.iconPath === "string" && /^[a-z]:[\\/]/i.test(candidate.iconPath)
                ? { iconPath: candidate.iconPath, iconIsImage: candidate.iconIsImage === true }
                : {}),
        });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
}
async function loadCatalog(): Promise<CatalogProgram[]> {
    if (process.platform !== "win32") return [];
    if (cache && Date.now() - cachedAt < 5 * 60 * 1000) return cache;
    if (pending) return pending;
    pending = execute(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(DISCOVER, "utf16le").toString("base64"),
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
    )
        .then(({ stdout }) => {
            const result = normalizePrograms(
                JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]"),
            );
            cache = result;
            cachedAt = Date.now();
            return result;
        })
        .finally(() => {
            pending = null;
        });
    return pending;
}

export async function listPrograms(): Promise<InstalledProgram[]> {
    return (await loadCatalog()).map(({ name, path, source }) => ({ name, path, source }));
}
const iconCache = new Map<string, Promise<string | null>>();
export async function getProgramIcon(path: unknown): Promise<string | null> {
    if (typeof path !== "string" || !validProgramTarget(path))
        throw new Error("Invalid application icon request.");
    const item = (await loadCatalog()).find((program) => program.path === path);
    if (!item) throw new Error("Application is not in the installed app list.");
    const existing = iconCache.get(path);
    if (existing) return existing;
    const icon = (async (): Promise<string | null> => {
        try {
            if (item.iconIsImage) {
                if (!item.iconPath) return null;
                const image = nativeImage.createFromPath(item.iconPath);
                return image.isEmpty() ? null : image.resize({ width: 32, height: 32 }).toDataURL();
            }
            const image = await app.getFileIcon(item.iconPath ?? item.path, { size: "small" });
            return image.isEmpty() ? null : image.toDataURL();
        } catch {
            return null;
        }
    })();
    if (iconCache.size >= 2048) iconCache.clear();
    iconCache.set(path, icon);
    return icon;
}
