/* global process, console */
// Electron 44 installs its binary on demand. electron-vite 5 reads path.txt
// directly, so ensure the runtime exists before handing control to its CLI.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const resolvePackage = createRequire(import.meta.url);
const root = dirname(resolvePackage.resolve("electron"));
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
function installedPath() {
    try {
        const executable = join(root, "dist", readFileSync(join(root, "path.txt"), "utf8").trim());
        const version = readFileSync(join(root, "dist", "version"), "utf8")
            .trim()
            .replace(/^v/, "");
        return existsSync(executable) && version === expectedVersion ? executable : null;
    } catch {
        return null;
    }
}
if (!installedPath()) {
    console.error(`Installing the Electron ${expectedVersion} desktop runtime…`);
    const result = spawnSync(process.execPath, [join(root, "install.js")], {
        stdio: "inherit",
        windowsHide: true,
    });
    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status || 1);
}
if (!installedPath()) {
    console.error("Electron runtime installation did not complete.");
    process.exit(1);
}
