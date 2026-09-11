/* global URL, window, console, Buffer, setTimeout, process, Event */
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("out/renderer");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
    const page = await browser.newPage({
        viewport: { width: 1536, height: 1024 },
        deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://decky.test/**", async (route) => {
        const file = resolve(
            root,
            decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "") ||
                "index.html",
        );
        if (!file.startsWith(root + sep)) {
            await route.abort();
            return;
        }
        try {
            await route.fulfill({
                body: await readFile(file),
                contentType:
                    {
                        ".html": "text/html",
                        ".css": "text/css",
                        ".js": "text/javascript",
                        ".png": "image/png",
                        ".webp": "image/webp",
                        ".glb": "model/gltf-binary",
                    }[extname(file)] ?? "application/octet-stream",
            });
        } catch {
            await route.fulfill({ status: 404, body: "Not found" });
        }
    });
    await page.goto("https://decky.test/");
    await page.locator(".disconnected-model[data-ready=true]").waitFor();
    await expect(
        page.getByRole("heading", { name: "Decky is offline", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.locator(".disconnected-screen").getByRole("button")).toHaveCount(0);
    await page.waitForTimeout(500);
    await mkdir("output", { recursive: true });
    await page.screenshot({ path: "output/decky-disconnected-implemented.png" });
    const data = await page
        .locator(".disconnected-model canvas")
        .evaluate((canvas) => canvas.toDataURL("image/png"));
    await writeFile(
        "output/decky-disconnected-model.png",
        Buffer.from(data.split(",")[1], "base64"),
    );
    if (process.argv.includes("--visual-only")) {
        await browser.close();
        process.exit(0);
    }
    await page.evaluate(() => {
        window.__online = false;
        window.__checks = 0;
        window.deck.status = async () => {
            window.__checks++;
            await new Promise((resolve) => setTimeout(resolve, 40));
            return window.__online
                ? {
                      connected: true,
                      identity: {
                          portPath: "TEST",
                          protocol: window.__protocol ?? 1,
                          serial: "a4cb8fcdd274",
                          cells: 15,
                          columns: 5,
                          rows: 3,
                          keyWidth: 118,
                          keyHeight: 123,
                          pages: 2,
                      },
                  }
                : { connected: false };
        };
    });
    await page.waitForFunction(() => window.__checks >= 1, {}, { timeout: 5000 });
    const first = Date.now();
    await page.waitForFunction(() => window.__checks >= 2, {}, { timeout: 5000 });
    const interval = Date.now() - first;
    if (interval < 3400 || interval > 4800)
        throw new Error(`Unexpected retry interval: ${interval}`);

    // A silent USB device is offered for setup straight away, but nothing touches
    // it until the user asks; the check then installs only on a CrowPanel.
    await page.evaluate(() => {
        window.__unknown = [{ path: "COM9", label: "COM9 - USB-SERIAL CH340" }];
        const plain = window.deck.status;
        window.deck.status = async () => {
            const result = await plain();
            return !result.connected && window.__unknown
                ? { ...result, unknownDevices: window.__unknown }
                : result;
        };
        window.deck.firmwareInfo = async () => ({
            appVersion: "0.2.0",
            installed: null,
            transport: null,
            bundled: { version: "1.4.0", protocol: 7 },
            latest: null,
            repository: null,
            update: null,
        });
        window.__crowPanel = false;
        window.deck.firmwareProbe = async (path) => {
            window.__probed = path;
            return window.__crowPanel
                ? { crowPanel: true, chip: "ESP32-S3", mac: "a4:cb:8f:cd:d2:74" }
                : { crowPanel: false, chip: "ESP32-C3", mac: "34:85:18:00:00:01" };
        };
        window.deck.firmwareInstall = async (request) => {
            window.__installed = request;
            return { ok: true, message: "Firmware 1.4.0 installed. Decky is restarting." };
        };
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("Install Decky on this device?")).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("The device on COM9 isn't running Decky yet.")).toBeVisible();
    // The device has been found, so the page stops saying it is looking.
    await expect(page.getByText("Looking for Decky…")).toHaveCount(0);
    if (await page.evaluate(() => window.__probed))
        throw new Error("The device was probed before the user asked");
    // Buttons fade their background in 0.18 s; photograph the settled state.
    await page.mouse.move(5, 500);
    await page.waitForTimeout(300);
    await page.screenshot({ path: "output/decky-first-install.png" });
    // Something else behind the same USB chip: checked, and left alone.
    await page.getByRole("button", { name: "Install Decky", exact: true }).click();
    await expect(page.getByText("This isn't a CrowPanel")).toBeVisible();
    await expect(page.getByText("Found ESP32-C3. Nothing was changed.")).toBeVisible();
    if (await page.evaluate(() => window.__installed))
        throw new Error("Firmware was installed on a device that is not a CrowPanel");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    // A CrowPanel: the same one button checks it and installs.
    await page.evaluate(() => {
        window.__crowPanel = true;
    });
    await page.getByRole("button", { name: "Install Decky", exact: true }).click();
    await expect(page.getByText("Firmware 1.4.0 installed. Decky is restarting.")).toBeVisible();
    const installed = await page.evaluate(() => window.__installed);
    if (installed?.source !== "bundled" || installed?.path !== "COM9")
        throw new Error(`Unexpected first install request: ${JSON.stringify(installed)}`);
    await page.evaluate(() => {
        window.__unknown = null;
    });
    // Connected, the deck loads first: the screen says so, nothing opens and
    // nothing is editable until its pages are in, then the reveal plays.
    await page.evaluate(() => {
        window.__protocol = 3;
        window.__holdLoading = true;
        window.deck.cachePages = async () => {
            if (window.__holdLoading)
                await new Promise((resolve) => {
                    window.__finishLoading = resolve;
                });
            return { ok: true, message: "Cached 1 pages." };
        };
        window.__online = true;
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("heading", { name: "Decky is starting", exact: true })).toBeVisible(
        { timeout: 6000 },
    );
    await page.waitForTimeout(1500);
    await expect(page.locator(".disconnected-screen")).toHaveAttribute("data-phase", "waiting");
    await expect(page.locator(".app-shell")).not.toBeVisible();
    await page.screenshot({ path: "output/decky-connect-booting.png" });
    await page.evaluate(() => {
        window.__holdLoading = false;
        window.__finishLoading?.();
    });
    await page.locator(".disconnected-screen[data-phase=rotating]").waitFor();
    await expect(page.locator(".app-shell")).not.toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: "output/decky-connect-turn.png" });
    await page.locator(".disconnected-screen[data-phase=zooming]").waitFor();
    await expect(page.locator(".app-shell")).not.toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "output/decky-connect-zoom.png" });
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".disconnected-screen")).toHaveCount(0);
    await page.getByRole("button", { name: "Key 1: Unassigned", exact: true }).click();
    await page.getByRole("button", { name: "Hotkey", exact: true }).click();
    await page.getByLabel("Key title", { exact: true }).fill("Keep this draft");
    await page.evaluate(() => {
        window.__online = false;
        window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("heading", { name: "Decky is offline", exact: true }).waitFor();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    // A disconnect detected while rotating must cancel the reveal.
    await page.evaluate(() => {
        window.__online = true;
        window.dispatchEvent(new Event("focus"));
    });
    await page.locator(".disconnected-screen[data-phase=rotating]").waitFor();
    await page.evaluate(() => {
        window.__online = false;
        window.dispatchEvent(new Event("focus"));
    });
    await page.locator(".disconnected-screen[data-phase=waiting]").waitFor();
    await page.waitForTimeout(2000);
    await expect(page.locator(".app-shell")).not.toBeVisible();
    await page.evaluate(() => {
        window.__online = true;
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByLabel("Key title", { exact: true })).toHaveValue("Keep this draft", {
        timeout: 4000,
    });
    await page.evaluate(() => {
        window.__online = false;
        window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("heading", { name: "Decky is offline", exact: true }).waitFor();
    for (const size of [
        { width: 1080, height: 760 },
        { width: 1920, height: 1080 },
    ]) {
        await page.setViewportSize(size);
        await page.locator(".disconnected-model[data-ready=true]").waitFor();
        await page.waitForTimeout(350);
        const box = await page
            .getByRole("heading", { name: "Decky is offline", exact: true })
            .boundingBox();
        if (
            !box ||
            box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > size.width ||
            box.y + box.height > size.height
        )
            throw new Error("Heading clipped");
        await page.screenshot({ path: `output/decky-disconnected-${size.width}.png` });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
        window.__online = true;
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 1200 });
    if (errors.length) throw new Error(errors.join("\n"));
    console.error(
        `Connection checks passed: ${interval} ms automatic retry, no buttons/sidebar, loading first, then turn → center-key zoom → dashboard, interrupted transition, preserved draft, responsive sizes, reduced motion.`,
    );
} finally {
    await browser.close();
}
