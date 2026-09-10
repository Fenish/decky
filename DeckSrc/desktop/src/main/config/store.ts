import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createConfig, validateConfig } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
export async function loadConfig(path: string, legacyPath: string): Promise<DeckConfig> {
    try {
        const config: unknown = JSON.parse(await readFile(path, "utf8"));
        validateConfig(config);
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            await copyFile(path, `${path}.recovery-${Date.now()}`).catch(() => {});
            throw new Error(
                "Decky could not read its configuration. A recovery copy was preserved.",
            );
        }
    }
    const config = createConfig();
    try {
        const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as Record<
            string,
            { label: string; hotkey?: string }
        >;
        for (const [address, key] of Object.entries(legacy)) {
            const [page, cell] = address.split(":").map(Number);
            if (
                page === undefined ||
                cell === undefined ||
                !Number.isInteger(page) ||
                page < 0 ||
                page > 63 ||
                !Number.isInteger(cell) ||
                cell < 0 ||
                cell > 14 ||
                !key.hotkey
            )
                continue;
            while (config.pages.length <= page)
                config.pages.push({
                    id: `page-${config.pages.length}`,
                    name: `Page ${config.pages.length + 1}`,
                    parentId: "home",
                    keys: {},
                });
            if (page > 0 && cell === 10) continue;
            config.pages[page]!.keys[cell] = {
                label: key.label.slice(0, 40),
                icon: "keyboard",
                color: "#e8dbc4",
                action: { kind: "hotkey", keys: key.hotkey },
            };
        }
        validateConfig(config);
    } catch {
        return createConfig();
    }
    return config;
}
export async function saveConfig(path: string, config: DeckConfig): Promise<void> {
    validateConfig(config);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(`${path}.tmp`, path);
}
