/*---------------------------------------------------------------
 * Widget keys' live pictures on the deck, and what it draws over them by
 * itself.
 *
 * A LIVE patch goes to any copy of a page the deck holds (live=1), into a
 * live picture kept apart from the page's own. Over it the deck moves its
 * overlays (OVERLAYS): text too long for the key to slide along (SLIDE,
 * slide=1), a ring's arc (SWEEP, sweep=1). All are tracked per copy of a page,
 * mirroring what each shows.
 *--------------------------------------------------------------*/

import { crc32 } from "../device/serial";
import { isWidgetKey } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { DeckStatus, KeyOverlays, Reply } from "../../shared/api";
import { encodeLivePatch } from "../../shared/live-patch";
import { decodeSlide } from "../../shared/slide-spec";
import { decodeSweep } from "../../shared/sweep-spec";
import type { DeckSession } from "../deck/session";
import type { DeckPages } from "../pages/deck-pages";
import type { Profile } from "../profile/profile";
import type { DeckWheels } from "./deck-wheels";

export type OverlayKind = keyof KeyOverlays;

/**
 * Each kind of overlay: its command, the ID flag of a deck that takes it,
 * whether the deck would take a payload on a key this size, and what an
 * invalid one is called. SWEEP's line ends with this PC's clock as it is sent,
 * which the arc's motion is reckoned in.
 */
const OVERLAYS: Record<
    OverlayKind,
    {
        command: string;
        flag: "slide" | "sweep";
        valid: (bytes: Uint8Array, width: number, height: number) => boolean;
        invalid: string;
        clock: boolean;
    }
> = {
    slide: {
        command: "SLIDE",
        flag: "slide",
        valid: (bytes, width, height) => decodeSlide(bytes, width, height) !== null,
        invalid: "Invalid sliding text.",
        clock: false,
    },
    sweep: {
        command: "SWEEP",
        flag: "sweep",
        valid: (bytes, width, height) => decodeSweep(bytes, width, height) !== null,
        invalid: "Invalid ring.",
        clock: true,
    },
};
export const OVERLAY_KINDS = Object.keys(OVERLAYS) as OverlayKind[];

/** How often a key whose picture is not reaching the deck says so in deck.log. */
const TRACE_MS = 10_000;
/** And how often one that keeps drawing the very picture the deck holds. */
const QUIET_MS = 60_000;

type Copies<T> = Map<string, Map<number, Map<number, T>>>;

export class LiveKeys {
    // Keys LIVE patches drew into, in each copy of a page the deck holds - by page
    // id, then signature - with the picture there now. Everywhere else a copy holds
    // the pictures it was sent. A patched key stays patched when its copy is shown
    // again or copied into the page's next version, so it is put right before a
    // key that is no longer a widget can keep a widget's picture.
    private readonly livePatched: Copies<Buffer> = new Map();
    // What the deck draws over keys by itself, by kind, in each copy of a page it
    // holds - by page id, then signature - as the CRC of the payload. A copy's
    // overlays go with its live pictures, and a new version of a page starts
    // with none but those it carried.
    private readonly liveOverlays: Record<OverlayKind, Copies<number>> = {
        slide: new Map(),
        sweep: new Map(),
    };
    // The newest picture asked for each widget key, until its turn to be sent: a
    // wheel turned faster than its patches travel skips the pictures between.
    private readonly liveQueue = new Map<string, [frame: unknown, overlays: unknown]>();

    // What became of a key's live pictures lately, for deck.log: one line a
    // key every TRACE_MS, so a key that stopped showing what it should says
    // why - refused by the deck, or never sent at all.
    private readonly traced = new Map<string, { note: string; at: number; count: number }>();

    constructor(
        private readonly session: DeckSession,
        private readonly profile: Profile,
        private readonly pages: DeckPages,
        private readonly wheels: DeckWheels,
        private readonly log: (line: string) => void = () => {},
    ) {}

    /**
     * A widget key's picture did not reach the deck's screen. Logged the first
     * time, then at most every TRACE_MS with how often it happened since;
     * "sent" clears it, so the log holds only what went wrong and for how long.
     */
    private trace(pageId: string, cell: number, note: string, every = TRACE_MS): void {
        const address = `${pageId}:${cell}`;
        if (note === "sent") {
            const was = this.traced.get(address);
            if (was) {
                this.traced.delete(address);
                this.log(`live ${address}: sending again, after ${was.count} × ${was.note}`);
            }
            return;
        }
        const now = Date.now();
        const was = this.traced.get(address);
        if (was?.note === note && now - was.at < every) {
            was.count++;
            return;
        }
        this.traced.set(address, { note, at: now, count: 1 });
        this.log(
            `live ${address}: ${note}${was?.note === note ? ` (${was.count} since)` : ""}`.trim(),
        );
    }

    private get status(): DeckStatus {
        return this.session.status;
    }

    private get config(): DeckConfig {
        return this.profile.config;
    }

    private static copyIn<T>(copies: Copies<T>, pageId: string, signature: number): Map<number, T> {
        const page = copies.get(pageId) ?? new Map<number, Map<number, T>>();
        const keys = page.get(signature) ?? new Map<number, T>();
        copies.set(pageId, page.set(signature, keys));
        return keys;
    }

    private get allCopies(): Copies<unknown>[] {
        return [this.livePatched, ...Object.values(this.liveOverlays)];
    }

    patchesIn(pageId: string, signature: number): Map<number, Buffer> {
        return LiveKeys.copyIn(this.livePatched, pageId, signature);
    }

    overlaysIn(kind: OverlayKind, pageId: string, signature: number): Map<number, number> {
        return LiveKeys.copyIn(this.liveOverlays[kind], pageId, signature);
    }

    /** The live pictures in the deck's copy `signature` of a page, if any are known. */
    patchesOf(pageId: string, signature: number): Map<number, Buffer> | undefined {
        return this.livePatched.get(pageId)?.get(signature);
    }

    /** The overlays of a kind on keys of the deck's copy `signature` of a page, if any are known. */
    overlaysOf(
        kind: OverlayKind,
        pageId: string,
        signature: number,
    ): Map<number, number> | undefined {
        return this.liveOverlays[kind].get(pageId)?.get(signature);
    }

    /** The deck's copy `signature` of a page shows its own pictures alone now. */
    dropCopy(pageId: string, signature: number): void {
        for (const copies of this.allCopies) copies.get(pageId)?.delete(signature);
    }

    /** A commit drops the deck's other copies of the page but the one shown. */
    dropOtherCopies(pageId: string, signature: number): void {
        const { displayed } = this.pages;
        for (const copies of this.allCopies.map((all) => all.get(pageId)))
            for (const kept of copies?.keys() ?? [])
                if (
                    kept !== signature &&
                    !(displayed?.pageId === pageId && displayed.signature === kept)
                )
                    copies!.delete(kept);
    }

    /** Forget pages the profile no longer has. */
    prune(config: DeckConfig): void {
        for (const copies of this.allCopies)
            for (const id of copies.keys())
                if (!config.pages.some((page) => page.id === id)) copies.delete(id);
    }

    clear(): void {
        for (const copies of this.allCopies) copies.clear();
    }

    /** A new session on the deck: it forgets every overlay it drew. */
    clearOverlays(): void {
        for (const copies of Object.values(this.liveOverlays)) copies.clear();
    }

    /**
     * A widget key's new picture from the window (deck:live), and what the deck
     * draws over it. The send already waiting for this key takes the newest.
     */
    queue(
        pageId: unknown,
        cell: unknown,
        frame: unknown,
        overlays: unknown,
    ): Reply | Promise<Reply> {
        const address = `${String(pageId)}:${String(cell)}`;
        const waiting = this.liveQueue.has(address);
        this.liveQueue.set(address, [frame, overlays]);
        if (waiting) return { ok: true, message: "Queued." };
        return this.session.serial(() => {
            const [newest, over] = this.liveQueue.get(address)!;
            this.liveQueue.delete(address);
            return this.sendLive(pageId, cell, newest, over);
        });
    }

    /**
     * Bring a widget key on the deck up to date with a patch: what changed since
     * the picture the deck holds. The deck checks that picture's CRC first, so a
     * copy that drifted (reloaded from the SD card, rebuilt, a patch lost) is
     * refused, and the whole key goes instead.
     */
    private async sendLive(
        pageId: unknown,
        cell: unknown,
        frame: unknown,
        overlays?: unknown,
    ): Promise<Reply> {
        if (
            typeof pageId !== "string" ||
            !Number.isInteger(cell) ||
            Number(cell) < 0 ||
            Number(cell) > 14
        )
            throw new Error("Invalid key.");
        if (!this.status.connected || !this.status.identity.live)
            return { ok: false, message: "This firmware shows widgets without updating them." };
        const { keyWidth: width, keyHeight: height } = this.status.identity;
        if (!(frame instanceof Uint8Array) || frame.length !== width * height * 2)
            throw new Error("Invalid widget image.");
        const over = this.validOverlays(overlays);
        const index = this.config.pages.findIndex((page) => page.id === pageId);
        const record = this.pages.uploaded.get(pageId);
        // Pages not shown are kept up to date too where the deck takes it (warm=1),
        // so one opens as it is now.
        const reachable = this.config.activePageId === pageId || this.status.identity.warm === true;
        if (!this.pages.deviceReady || !reachable || index < 0 || !record) {
            this.trace(
                pageId,
                Number(cell),
                !record
                    ? "the deck holds no copy of this page"
                    : !this.pages.deviceReady
                      ? "the page shown is not ready"
                      : "the page cannot be reached",
            );
            return { ok: true, message: "The page is not on the deck." };
        }
        // A tick drawn just before the widget moved or went must not land where it was.
        if (!isWidgetKey(this.config.pages[index]!, Number(cell)))
            return { ok: true, message: "That key is not a widget." };
        return this.patchWithOverlays(pageId, index, record, Number(cell), frame, over);
    }

    /**
     * A key's picture and its overlays: an overlay that goes before the
     * picture, one that comes or changes after it - so neither the old one
     * over the new picture nor the new one over the old picture ever shows.
     */
    async patchWithOverlays(
        pageId: string,
        index: number,
        record: { signature: number; frames: Buffer[] },
        cell: number,
        frame: Uint8Array,
        overlays: KeyOverlays,
    ): Promise<Reply> {
        const kinds = OVERLAY_KINDS.filter((kind) => overlays[kind] !== undefined);
        for (const kind of kinds.filter((kind) => overlays[kind] === null)) {
            const reply = await this.syncOverlay(kind, pageId, index, record.signature, cell, null);
            if (!reply.ok) return reply;
        }
        const reply = await this.patchKey(pageId, index, record, cell, frame);
        if (!reply.ok) return reply;
        for (const kind of kinds.filter((kind) => overlays[kind])) {
            const synced = await this.syncOverlay(
                kind,
                pageId,
                index,
                record.signature,
                cell,
                overlays[kind]!,
            );
            if (!synced.ok) return synced;
        }
        return reply;
    }

    /**
     * Overlays the deck can draw on a key: for each kind, a payload it would
     * take, or null for none. Throws on any other.
     */
    validOverlays(overlays: unknown): KeyOverlays {
        if (overlays === undefined || overlays === null) return {};
        if (typeof overlays !== "object") throw new Error("Invalid key overlays.");
        const given = overlays as Record<string, unknown>;
        const valid: KeyOverlays = {};
        for (const kind of OVERLAY_KINDS) {
            const bytes = given[kind];
            if (bytes === undefined) continue;
            if (
                bytes !== null &&
                !(
                    bytes instanceof Uint8Array &&
                    this.status.connected &&
                    OVERLAYS[kind].valid(
                        bytes,
                        this.status.identity.keyWidth,
                        this.status.identity.keyHeight,
                    )
                )
            )
                throw new Error(OVERLAYS[kind].invalid);
            valid[kind] = bytes;
        }
        return valid;
    }

    /**
     * Give a key in the deck's copy of a page (`signature`) its overlay of a
     * kind, or take it away (null): only what differs from what that copy has.
     */
    async syncOverlay(
        kind: OverlayKind,
        pageId: string,
        index: number,
        signature: number,
        cell: number,
        bytes: Uint8Array | null,
    ): Promise<Reply> {
        const { command, flag, clock } = OVERLAYS[kind];
        if (!this.status.connected || !this.status.identity[flag])
            return { ok: true, message: `This firmware takes no ${command}.` };
        const held = this.overlaysIn(kind, pageId, signature);
        const crc = bytes ? crc32(bytes) : undefined;
        if (held.get(cell) === crc) return { ok: true, message: "Unchanged." };
        const line = `${command} ${index} ${signature} ${cell}`;
        const reply = bytes
            ? await this.session.link.push(
                  cell,
                  bytes,
                  () => {},
                  `${line} ${bytes.length} ${crc}${clock ? ` ${Date.now()}` : ""}`,
              )
            : await this.session.link.command(`${line} 0 0${clock ? " 0" : ""}`, 2000);
        if (reply.ok && crc !== undefined) held.set(cell, crc);
        else if (reply.ok) held.delete(cell);
        return reply;
    }

    /**
     * Patch a key in the deck's copy of a page (any it holds, shown or not): what
     * changed since the picture it holds there.
     */
    async patchKey(
        pageId: string,
        index: number,
        record: { signature: number; frames: Buffer[] },
        cell: number,
        frame: Uint8Array,
    ): Promise<Reply> {
        if (!this.status.connected) return { ok: false, message: "Decky is disconnected." };
        const { keyWidth: width, keyHeight: height } = this.status.identity;
        const patches = this.patchesIn(pageId, record.signature);
        const next = Buffer.from(frame);
        const held = patches.get(cell);
        const base = held ?? record.frames[cell]!;
        if (base.equals(next)) {
            // Nothing to send - unless what the deck holds is not what it
            // shows, when the key would stay as it is for good. Logged slowly:
            // a key drawing the same picture minute after minute says so.
            if (held) this.trace(pageId, cell, "unchanged, so nothing sent", QUIET_MS);
            return { ok: true, message: "Unchanged." };
        }
        const send = async (payload: Uint8Array, baseCrc: number): Promise<Reply> => {
            try {
                return await this.session.link.push(
                    cell,
                    payload,
                    () => {},
                    `LIVE ${index} ${record.signature} ${cell} ${baseCrc} ${payload.length} ${crc32(payload)}`,
                );
            } catch (error) {
                // The deck went mid-patch (its cable, its Wi-Fi): the window
                // draws the key again once it is back, and nothing is recorded.
                return { ok: false, message: String(error) };
            }
        };
        let reply = await send(encodeLivePatch(base, next, width, height), crc32(base));
        if (!reply.ok && reply.message.includes("live base"))
            reply = await send(encodeLivePatch(null, next, width, height), 0);
        this.trace(pageId, cell, reply.ok ? "sent" : `the deck refused it: ${reply.message}`);
        if (reply.ok) patches.set(cell, next);
        if (reply.ok) this.wheels.pictureSent(pageId, cell);
        return reply;
    }

    /**
     * Show the page's own pictures again on keys in the deck's copy `signature`
     * that have live pictures or overlays and are widgets no longer - dropping
     * the live picture drops its overlays too. Widget keys keep theirs; their
     * next patch goes on top.
     */
    async restoreKeys(pageId: string, index: number, signature: number): Promise<Reply> {
        const patches = this.livePatched.get(pageId)?.get(signature);
        const overlays = OVERLAY_KINDS.map(
            (kind) => [kind, this.overlaysOf(kind, pageId, signature)] as const,
        );
        const page = this.config.pages[index];
        const cells = new Set([
            ...(patches?.keys() ?? []),
            ...overlays.flatMap(([, held]) => [...(held?.keys() ?? [])]),
        ]);
        if (!cells.size || !page || !this.status.connected) return { ok: true, message: "" };
        for (const cell of cells) {
            if (isWidgetKey(page, cell)) continue;
            if (patches?.has(cell)) {
                const reply = await this.session.link.command(
                    `LIVE ${index} ${signature} ${cell} 0 0 0`,
                    2000,
                );
                if (!reply.ok) return reply;
            } else
                for (const [kind, held] of overlays) {
                    if (!held?.has(cell)) continue;
                    const reply = await this.syncOverlay(
                        kind,
                        pageId,
                        index,
                        signature,
                        cell,
                        null,
                    );
                    if (!reply.ok) return reply;
                }
            patches?.delete(cell);
            for (const [, held] of overlays) held?.delete(cell);
        }
        return { ok: true, message: "" };
    }
}
