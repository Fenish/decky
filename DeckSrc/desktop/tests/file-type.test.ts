/*---------------------------------------------------------------
 * Teaching Windows what a .deckyprofile is: the keys written, and the ones
 * left alone because they already say the right thing.
 *--------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { profileTypeKeys, registerProfileType } from "../src/main/system/file-type";
import type { Registry } from "../src/main/system/file-type";

const EXE = "C:\\Program Files\\Decky\\Decky.exe";
const ICON = "C:\\Program Files\\Decky\\resources\\profile.ico";

/** A registry that remembers, starting from `saved`. */
function registry(saved: Record<string, string> = {}) {
    const written: { key: string; value: string }[] = [];
    const store: Record<string, string> = { ...saved };
    const it: Registry = {
        read: async (key) => store[key] ?? "",
        write: async (key, value) => {
            store[key] = value;
            written.push({ key, value });
        },
    };
    return { registry: it, written, store };
}

describe("the .deckyprofile file type", () => {
    it("names the type, its icon, and the command that opens one", async () => {
        const { registry: fake, written } = registry();
        expect(await registerProfileType(EXE, ICON, fake)).toBe(true);
        expect(written.map((item) => item.key)).toEqual([
            "HKCU\\Software\\Classes\\.deckyprofile",
            "HKCU\\Software\\Classes\\Decky.Profile",
            "HKCU\\Software\\Classes\\Decky.Profile\\DefaultIcon",
            "HKCU\\Software\\Classes\\Decky.Profile\\shell\\open\\command",
        ]);
        // The file double-clicked arrives as an argument.
        expect(written.at(-1)!.value).toBe(`"${EXE}" "%1"`);
        expect(written.at(-2)!.value).toBe(ICON);
        // Under HKCU: no administrator, and nobody else on the PC is touched.
        expect(written.every((item) => item.key.startsWith("HKCU\\"))).toBe(true);
    });

    it("writes nothing when Windows already points at this Decky", async () => {
        const saved = Object.fromEntries(
            profileTypeKeys(EXE, ICON).map(({ key, value }) => [key, value]),
        );
        const { registry: fake, written } = registry(saved);
        expect(await registerProfileType(EXE, ICON, fake)).toBe(false);
        expect(written).toEqual([]);
    });

    it("puts right what points at a Decky that has moved", async () => {
        const saved = Object.fromEntries(
            profileTypeKeys("D:\\old\\Decky.exe", "D:\\old\\profile.ico").map(({ key, value }) => [
                key,
                value,
            ]),
        );
        const { registry: fake, written, store } = registry(saved);
        expect(await registerProfileType(EXE, ICON, fake)).toBe(true);
        // Only what was wrong: the type's own name was right already.
        expect(written.map((item) => item.key)).toEqual([
            "HKCU\\Software\\Classes\\Decky.Profile\\DefaultIcon",
            "HKCU\\Software\\Classes\\Decky.Profile\\shell\\open\\command",
        ]);
        expect(store["HKCU\\Software\\Classes\\Decky.Profile\\shell\\open\\command"]).toBe(
            `"${EXE}" "%1"`,
        );
    });

    it("lets Decky start even when the registry will not have it", async () => {
        const refusing: Registry = {
            read: async () => "",
            write: async () => {
                throw new Error("Access is denied.");
            },
        };
        await expect(registerProfileType(EXE, ICON, refusing)).resolves.toBe(false);
    });
});
