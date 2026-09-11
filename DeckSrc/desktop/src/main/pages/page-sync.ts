/*---------------------------------------------------------------
 * Sending the profile's pages to the deck.
 *
 * While the deck loads, every page is cached (CACHE) before the active one
 * shows. A page that changed goes as a new version, built on the deck from
 * its copy where it has one, so only the keys whose pictures changed
 * travel. Toggle keys' ON pictures go separately (ALT), and STATE picks OFF
 * or ON for every key without sending a picture.
 *--------------------------------------------------------------*/

import { crc32 } from "../device/serial";
import { pageStateMask } from "./toggle-state";
import { BACK_CELL, isWidgetKey } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { DeckStatus, PageUpload, Reply } from "../../shared/api";
import { encodeLivePatch } from "../../shared/live-patch";
import type { KeyStateStore } from "../actions/key-state";
import type { MainWindow } from "../app/main-window";
import type { DeckSession } from "../deck/session";
import type { Profile } from "../profile/profile";
import type { DeckWheels } from "../widgets/deck-wheels";
import { OVERLAY_KINDS } from "../widgets/live-keys";
import type { LiveKeys } from "../widgets/live-keys";
import type { DeckPages } from "./deck-pages";
import { warmupItems } from "./warmup";

/**
 * Pictures the window drew for the profile as it was: a save came while they
 * waited behind another upload. The window draws them again for the profile
 * as it is now, so this is nothing to tell anyone.
 */
const STALE: Reply = {
    ok: false,
    message: "The profile changed while its pages were sent.",
    stale: true,
};

const toggleArtwork = (toggleFrames: PageUpload["toggleFrames"]): string =>
    (toggleFrames ?? [])
        .map((item) => `${item.cell}:${crc32(Buffer.from(item.frame))}`)
        .sort()
        .join(",");

export class PageSync {
    private storageWarningShown = false;

    constructor(
        private readonly session: DeckSession,
        private readonly profile: Profile,
        private readonly pages: DeckPages,
        private readonly live: LiveKeys,
        private readonly wheels: DeckWheels,
        private readonly keyStates: KeyStateStore,
        private readonly window: MainWindow,
    ) {}

    private get status(): DeckStatus {
        return this.session.status;
    }

    private get config(): DeckConfig {
        return this.profile.config;
    }

    /** What the deck held is no longer known: it is being looked for again. */
    forget(): void {
        this.pages.forget();
        this.live.clear();
        this.wheels.clear();
    }

    /** The deck lost what it held, or went: forget it all, and tell the window. */
    resetDeviceCache(): void {
        this.storageWarningShown = false;
        this.forget();
        this.window.sendIfOpen("deck:event", { kind: "reset", at: Date.now() });
    }

    /** Forget pages the profile no longer has. */
    prune(config: DeckConfig): void {
        this.pages.prune(config);
        this.live.prune(config);
    }

    /** The active page from the window (page:sync), as it should look now. */
    syncPage(pageId: unknown, frames: unknown, toggleFrames: unknown): Promise<Reply> {
        return this.session.serial(async (): Promise<Reply> => {
            if (typeof pageId !== "string" || pageId !== this.config.activePageId)
                return { ok: false, message: "Page changed before sync.", stale: true };
            if (!this.status.connected)
                return { ok: false, message: "Connect Decky to sync keys." };
            if (this.status.identity.protocol < 2)
                return { ok: false, message: "Install Decky firmware to sync images." };
            this.validateFrames(frames);
            this.pages.deviceReady = false;
            return this.transferPage(
                pageId,
                frames,
                false,
                toggleFrames as PageUpload["toggleFrames"],
            );
        });
    }

    /**
     * Every page from the window (pages:cache), while the deck loads: cached
     * one by one, then every widget's picture and every look sent ahead, and
     * last the active page shown.
     */
    cachePages(pages: unknown, warmup: unknown): Promise<Reply> {
        return this.session.serial(async (): Promise<Reply> => {
            const { link } = this.session;
            if (!this.status.connected || this.status.identity.protocol < 3)
                return { ok: false, message: "Page preloading requires Decky firmware v3." };
            if (!Array.isArray(pages) || pages.length > 64)
                throw new Error("Invalid page cache request.");
            const ids = new Set<string>();
            for (const page of pages) {
                if (
                    typeof page !== "object" ||
                    page === null ||
                    typeof page.pageId !== "string" ||
                    ids.has(page.pageId)
                )
                    throw new Error("Invalid cached page.");
                this.validateFrames(page.frames);
                ids.add(page.pageId);
            }
            // Pages added or removed since the window drew these.
            if (
                ids.size !== this.config.pages.length ||
                this.config.pages.some((item) => !ids.has(item.id))
            )
                return STALE;
            const capacity = this.status.identity.cacheSlots ?? 8;
            if (pages.length > capacity)
                return {
                    ok: false,
                    message: `Decky can hold ${capacity} page snapshots in memory; this profile has ${pages.length}. The current page will still work.`,
                };
            const warm = warmupItems(warmup, this.status, this.config, (overlays) => {
                try {
                    this.live.validOverlays(overlays);
                    return true;
                } catch {
                    return false;
                }
            });
            this.pages.deviceReady = false;
            if (!this.pages.cacheInitialized) {
                // The deck's progress counts every key, ON picture, widget
                // picture and look to come.
                const units =
                    this.status.identity.protocol >= 4
                        ? ` ${(pages as PageUpload[]).reduce((sum, page) => sum + 15 + (page.toggleFrames?.length ?? 0), 0) + warm.widgets.length + warm.looks.length}`
                        : "";
                const reply = await link.command(`HELLO ${pages.length}${units}`, 2000);
                if (!reply.ok) return reply;
                // A new session on the deck: it forgets which keys have wheels,
                // and every overlay it drew.
                this.wheels.clear();
                this.live.clearOverlays();
                // Uploads over USB in 2 KB blocks where the deck takes them.
                if ((this.status.identity.block ?? 0) >= 2048) await link.useBlock(2048);
            }
            for (const page of pages as PageUpload[]) {
                const reply = await this.transferPage(
                    page.pageId,
                    page.frames,
                    true,
                    page.toggleFrames,
                );
                if (!reply.ok) return reply;
            }
            // Every page's widgets as they are now, and the looks of the keys
            // the deck turns, while it still shows its progress: no page
            // opens on placeholders, or waits for a look.
            for (const item of warm.widgets) {
                const index = this.config.pages.findIndex((page) => page.id === item.pageId);
                const record = this.pages.uploaded.get(item.pageId);
                if (index < 0 || !record) continue;
                await this.live.patchWithOverlays(
                    item.pageId,
                    index,
                    record,
                    item.cell,
                    item.frame,
                    item.overlays ?? {},
                );
            }
            for (const look of warm.looks) {
                const index = this.config.pages.findIndex((page) => page.id === look.pageId);
                const record = this.pages.uploaded.get(look.pageId);
                if (index >= 0 && record)
                    await link.push(
                        -1,
                        look.spec,
                        () => {},
                        `WHEEL ${index} ${record.signature} -1 0 ${look.spec.length} ${crc32(look.spec)}`,
                    );
            }
            const active = (pages as PageUpload[]).find(
                (page) => page.pageId === this.config.activePageId,
            );
            if (!active) return { ok: false, message: "Workspace changed during page preload." };
            const reply = await this.transferPage(
                active.pageId,
                active.frames,
                false,
                active.toggleFrames,
            );
            if (reply.ok) this.pages.cacheInitialized = true;
            return reply.ok ? { ok: true, message: `Cached ${pages.length} pages.` } : reply;
        });
    }

    /**
     * A toggle key flipped: the window hears the new states, and where the
     * deck holds both pictures of every toggle (protocol 4) it is sent them
     * with one STATE, whose reply this returns; null when nothing was sent.
     */
    showToggles(pageId: string): Promise<Reply> | null {
        const direct = this.status.connected && this.status.identity.protocol >= 4;
        if (!direct) this.pages.deviceReady = false;
        this.window.send("keys:states", this.keyStates.snapshot());
        if (!direct || !this.pages.deviceReady || this.config.activePageId !== pageId) return null;
        return this.session.serial(async () => {
            if (!this.pages.deviceReady || this.config.activePageId !== pageId)
                return { ok: true, message: "Page changed." };
            return this.activateState(pageId);
        });
    }

    private async activateState(pageId: string): Promise<Reply> {
        const index = this.config.pages.findIndex((page) => page.id === pageId);
        const record = this.pages.uploaded.get(pageId);
        if (index < 0 || !record) return { ok: false, message: "Page is not ready." };
        return this.session.link.command(
            `STATE ${index} ${record.signature} ${pageStateMask(this.config.pages[index]!, this.keyStates.snapshot())}`,
            2000,
        );
    }

    private validateFrames(frames: unknown): asserts frames is Uint8Array[] {
        if (!this.status.connected) throw new Error("Decky is disconnected.");
        const bytes = this.status.identity.keyWidth * this.status.identity.keyHeight * 2;
        if (
            !Array.isArray(frames) ||
            frames.length !== 15 ||
            frames.some((frame) => !(frame instanceof Uint8Array) || frame.length !== bytes)
        )
            throw new Error("Invalid page image data.");
    }

    private async transferPage(
        pageId: string,
        frames: Uint8Array[],
        cacheOnly = false,
        toggleFrames?: PageUpload["toggleFrames"],
    ): Promise<Reply> {
        const { link } = this.session;
        this.validateFrames(frames);
        const index = this.config.pages.findIndex((page) => page.id === pageId);
        if (index < 0) throw new Error("Page no longer exists.");
        const signature = crc32(Buffer.concat(frames.map((frame) => Buffer.from(frame))));
        const independentToggles = this.status.connected && this.status.identity.protocol >= 4;
        if (independentToggles) {
            const expected = Object.entries(this.config.pages[index]!.keys)
                .filter(
                    ([cell, key]) =>
                        key.behavior === "toggle" &&
                        !(this.config.pages[index]!.parentId && Number(cell) === BACK_CELL),
                )
                .map(([cell]) => Number(cell));
            if (
                !Array.isArray(toggleFrames) ||
                toggleFrames.some(
                    (item) =>
                        !item ||
                        !Number.isInteger(item.cell) ||
                        !(item.frame instanceof Uint8Array) ||
                        item.frame.length !== frames[0]!.length,
                )
            )
                throw new Error("Invalid toggle artwork.");
            // ON pictures for the page's toggles as they were: a toggle added or taken away since.
            const cells = new Set(toggleFrames.map((item) => item.cell));
            if (
                cells.size !== toggleFrames.length ||
                cells.size !== expected.length ||
                expected.some((cell) => !cells.has(cell))
            )
                return STALE;
        }
        const toggles = independentToggles ? toggleArtwork(toggleFrames) : "";
        // A page the deck already holds with this exact artwork, ON appearances
        // included, opens with one STATE. Over Wi-Fi every command is a round trip,
        // and a CACHE plus an ALT check per toggle key made a page with toggles
        // visibly slower to open than one without. If the deck has dropped the page
        // since, STATE is refused and the full exchange below runs.
        const known = this.pages.uploaded.get(pageId);
        if (
            !cacheOnly &&
            independentToggles &&
            known?.signature === signature &&
            known.toggles === toggles
        ) {
            const shown = await link.command(
                `STATE ${index} ${signature} ${pageStateMask(this.config.pages[index]!, this.keyStates.snapshot())}`,
                2000,
            );
            if (shown.ok) {
                const restored = await this.live.restoreKeys(pageId, index, signature);
                if (!restored.ok) return restored;
                this.pages.displayed = { pageId, ...known };
                this.wheels.forgetHiddenWheels();
                this.pages.deviceReady = this.config.activePageId === pageId;
                if (this.pages.deviceReady) await this.wheels.syncDrag(this.config.pages[index]!);
                return { ok: true, message: "Keys synced." };
            }
            this.pages.uploaded.delete(pageId);
        }
        let reply = await link.command(
            `${cacheOnly || independentToggles ? "CACHE" : "PAGE"} ${index} ${signature}`,
            5000,
        );
        if (!reply.ok) return reply;
        const { displayed } = this.pages;
        const previous =
            this.pages.uploaded.get(pageId) ?? (displayed?.pageId === pageId ? displayed : null);
        if (!reply.message.includes("cached=1")) {
            const base = Number(reply.message.match(/base=(\d+)/)?.[1]);
            const incremental = reply.message.includes("copied=1") && previous?.signature === base;
            // The deck starts this version from its copy of `base`, whose own
            // pictures are exactly as they were sent: live pictures are kept
            // apart, and carried into the version (`live=` names them). So only
            // keys whose picture changed go, each where the deck takes patches
            // (live=1) as one against the picture it holds - a style change on a
            // page of live widgets is one small patch, not every widget again.
            const patching = this.status.connected && this.status.identity.live === true;
            const { keyWidth: width, keyHeight: height } = this.status.connected
                ? this.status.identity
                : { keyWidth: 0, keyHeight: 0 };
            const copiedPatches = incremental ? this.live.patchesOf(pageId, base) : undefined;
            const carried = Number(reply.message.match(/\blive=(\d+)/)?.[1] ?? 0);
            this.live.dropCopy(pageId, signature);
            const sent = new Set<number>();
            try {
                for (let cell = 0; cell < 15; cell++) {
                    const frame = frames[cell]!;
                    if (incremental && previous!.frames[cell]!.equals(Buffer.from(frame))) continue;
                    sent.add(cell);
                    if (!frame.some((byte) => byte !== 0))
                        reply = await link.command(`BLANK ${cell}`, 2000);
                    else if (patching) {
                        // Against the copy's own picture; in a fresh copy the
                        // deck holds nothing known, and the patch is the whole key.
                        const held = incremental ? previous!.frames[cell]! : null;
                        const payload = encodeLivePatch(held, frame, width, height);
                        reply = await link.push(
                            cell,
                            payload,
                            () => {},
                            `PATCH ${cell} ${payload.length} ${crc32(payload)}`,
                        );
                    } else reply = await link.push(cell, frame, () => {});
                    if (!reply.ok) {
                        await link.command("ABORT", 1000);
                        return reply;
                    }
                }
                reply = await link.command(`COMMIT ${signature}`, 5000);
                this.reportStorageFailure(reply);
                if (!reply.ok) return reply;
            } catch (error) {
                await link.command("ABORT", 1000).catch(() => {});
                throw error;
            }
            // The live pictures the version carried, with their overlays: kept
            // where the key is still a widget whose picture is known; dropped
            // where it moved or went, or it would go on showing its last.
            const patches = this.live.patchesIn(pageId, signature);
            for (let cell = 0; cell < 15; cell++) {
                if (!(carried & (1 << cell)) || sent.has(cell)) continue;
                const picture = copiedPatches?.get(cell);
                if (picture && isWidgetKey(this.config.pages[index]!, cell)) {
                    patches.set(cell, picture);
                    for (const kind of OVERLAY_KINDS) {
                        const held = this.live.overlaysOf(kind, pageId, base)?.get(cell);
                        if (held !== undefined)
                            this.live.overlaysIn(kind, pageId, signature).set(cell, held);
                    }
                    continue;
                }
                reply = await link.command(`LIVE ${index} ${signature} ${cell} 0 0 0`, 2000);
                if (!reply.ok) return reply;
            }
            this.live.dropOtherCopies(pageId, signature);
        } else {
            // A copy the deck kept: perhaps the very one the patches went to, and
            // the same pictures with a widget moved share its signature. Read back
            // from the card, it is as it was sent, with no overlays.
            if (reply.message.includes("storage=sd")) this.live.dropCopy(pageId, signature);
            reply = await this.live.restoreKeys(pageId, index, signature);
            if (!reply.ok) return reply;
        }
        if (independentToggles)
            for (const alternate of toggleFrames!) {
                reply = await link.push(
                    alternate.cell,
                    alternate.frame,
                    () => {},
                    `ALT ${index} ${signature} ${alternate.cell} ${alternate.frame.length} ${crc32(alternate.frame)}`,
                );
                this.reportStorageFailure(reply);
                if (!reply.ok) return reply;
            }
        const record = { signature, frames: frames.map((frame) => Buffer.from(frame)), toggles };
        this.pages.uploaded.set(pageId, record);
        if (!cacheOnly) {
            if (independentToggles) {
                reply = await this.activateState(pageId);
                if (!reply.ok) return reply;
            }
            this.pages.displayed = { pageId, ...record };
            this.wheels.forgetHiddenWheels();
            this.pages.deviceReady = this.config.activePageId === pageId;
            if (this.pages.deviceReady) await this.wheels.syncDrag(this.config.pages[index]!);
        }
        return { ok: true, message: cacheOnly ? "Page cached." : "Keys synced." };
    }

    private reportStorageFailure(reply: Reply): void {
        if (
            !this.storageWarningShown &&
            this.status.connected &&
            this.status.identity.persistentCache &&
            reply.ok &&
            reply.message.includes("stored=0")
        ) {
            this.storageWarningShown = true;
            this.window.send("action:activity", {
                at: Date.now(),
                label: "SD card",
                ok: false,
                message:
                    "Artwork is working in memory, but the SD card could not save it. Check the card and free space.",
            });
        }
    }
}
