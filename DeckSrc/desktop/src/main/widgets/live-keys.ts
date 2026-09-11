/*---------------------------------------------------------------
 * Widget keys' live pictures on the deck, and the text it slides on them.
 *
 * A LIVE patch goes to any copy of a page the deck holds (live=1), into a
 * live picture kept apart from the page's own; SLIDE gives a key text too
 * long for it to slide along (slide=1). Both are tracked per copy of a page,
 * mirroring what each shows.
 *--------------------------------------------------------------*/

import { crc32 } from "../device/serial";
import { isWidgetKey } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { DeckStatus, Reply } from "../../shared/api";
import { encodeLivePatch } from "../../shared/live-patch";
import { decodeSlide } from "../../shared/slide-spec";
import type { DeckSession } from "../deck/session";
import type { DeckPages } from "../pages/deck-pages";
import type { Profile } from "../profile/profile";
import type { DeckWheels } from "./deck-wheels";

export class LiveKeys {
    // Keys LIVE patches drew into, in each copy of a page the deck holds - by page
    // id, then signature - with the picture there now. Everywhere else a copy holds
    // the pictures it was sent. A patched key stays patched when its copy is shown
    // again or copied into the page's next version, so it is put right before a
    // key that is no longer a widget can keep a widget's picture.
    private readonly livePatched = new Map<string, Map<number, Map<number, Buffer>>>();
    // Text the deck slides along on keys, in each copy of a page it holds - by
    // page id, then signature - as the CRC of the SLIDE payload. A copy's text
    // goes with it, and a new version of a page starts with none (slide=1).
    private readonly liveSlides = new Map<string, Map<number, Map<number, number>>>();
    // The newest picture asked for each widget key, until its turn to be sent: a
    // wheel turned faster than its patches travel skips the pictures between.
    private readonly liveQueue = new Map<string, [frame: unknown, slide: unknown]>();

    constructor(
        private readonly session: DeckSession,
        private readonly profile: Profile,
        private readonly pages: DeckPages,
        private readonly wheels: DeckWheels,
    ) {}

    private get status(): DeckStatus {
        return this.session.status;
    }

    private get config(): DeckConfig {
        return this.profile.config;
    }

    patchesIn(pageId: string, signature: number): Map<number, Buffer> {
        const copies = this.livePatched.get(pageId) ?? new Map<number, Map<number, Buffer>>();
        const patches = copies.get(signature) ?? new Map<number, Buffer>();
        this.livePatched.set(pageId, copies.set(signature, patches));
        return patches;
    }

    slidesIn(pageId: string, signature: number): Map<number, number> {
        const copies = this.liveSlides.get(pageId) ?? new Map<number, Map<number, number>>();
        const slides = copies.get(signature) ?? new Map<number, number>();
        this.liveSlides.set(pageId, copies.set(signature, slides));
        return slides;
    }

    /** The live pictures in the deck's copy `signature` of a page, if any are known. */
    patchesOf(pageId: string, signature: number): Map<number, Buffer> | undefined {
        return this.livePatched.get(pageId)?.get(signature);
    }

    /** The text sliding on keys of the deck's copy `signature` of a page, if any is known. */
    slidesOf(pageId: string, signature: number): Map<number, number> | undefined {
        return this.liveSlides.get(pageId)?.get(signature);
    }

    /** The deck's copy `signature` of a page shows its own pictures alone now. */
    dropCopy(pageId: string, signature: number): void {
        this.livePatched.get(pageId)?.delete(signature);
        this.liveSlides.get(pageId)?.delete(signature);
    }

    /** A commit drops the deck's other copies of the page but the one shown. */
    dropOtherCopies(pageId: string, signature: number): void {
        const { displayed } = this.pages;
        for (const copies of [this.livePatched.get(pageId), this.liveSlides.get(pageId)])
            for (const kept of copies?.keys() ?? [])
                if (
                    kept !== signature &&
                    !(displayed?.pageId === pageId && displayed.signature === kept)
                )
                    copies!.delete(kept);
    }

    /** Forget pages the profile no longer has. */
    prune(config: DeckConfig): void {
        for (const copies of [this.livePatched, this.liveSlides])
            for (const id of copies.keys())
                if (!config.pages.some((page) => page.id === id)) copies.delete(id);
    }

    clear(): void {
        this.livePatched.clear();
        this.liveSlides.clear();
    }

    /** A new session on the deck: it forgets any text it slid. */
    clearSlides(): void {
        this.liveSlides.clear();
    }

    /**
     * A widget key's new picture from the window (deck:live). The send already
     * waiting for this key takes the newest picture.
     */
    queue(pageId: unknown, cell: unknown, frame: unknown, slide: unknown): Reply | Promise<Reply> {
        const address = `${String(pageId)}:${String(cell)}`;
        const waiting = this.liveQueue.has(address);
        this.liveQueue.set(address, [frame, slide]);
        if (waiting) return { ok: true, message: "Queued." };
        return this.session.serial(() => {
            const [newest, text] = this.liveQueue.get(address)!;
            this.liveQueue.delete(address);
            return this.sendLive(pageId, cell, newest, text);
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
        slide?: unknown,
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
        if (!this.validSlide(slide)) throw new Error("Invalid sliding text.");
        const index = this.config.pages.findIndex((page) => page.id === pageId);
        const record = this.pages.uploaded.get(pageId);
        // Pages not shown are kept up to date too where the deck takes it (warm=1),
        // so one opens as it is now.
        const reachable = this.config.activePageId === pageId || this.status.identity.warm === true;
        if (!this.pages.deviceReady || !reachable || index < 0 || !record)
            return { ok: true, message: "The page is not on the deck." };
        // A tick drawn just before the widget moved or went must not land where it was.
        if (!isWidgetKey(this.config.pages[index]!, Number(cell)))
            return { ok: true, message: "That key is not a widget." };
        const reply = await this.patchKey(pageId, index, record, Number(cell), frame);
        // The picture first, then its text: new text on an old picture would
        // show both, for a moment, where the old picture had its own.
        if (!reply.ok || slide === undefined) return reply;
        return this.syncSlide(pageId, index, record.signature, Number(cell), slide);
    }

    /** Text the deck can slide on a key: a SLIDE payload it would take, or null for none. */
    validSlide(slide: unknown): slide is Uint8Array | null | undefined {
        if (slide === undefined || slide === null) return true;
        if (!(slide instanceof Uint8Array) || !this.status.connected) return false;
        return (
            decodeSlide(slide, this.status.identity.keyWidth, this.status.identity.keyHeight) !==
            null
        );
    }

    /**
     * Give a key in the deck's copy of a page (`signature`) the text it slides
     * along, or take it away (null): only what differs from what that copy has.
     */
    async syncSlide(
        pageId: string,
        index: number,
        signature: number,
        cell: number,
        slide: Uint8Array | null,
    ): Promise<Reply> {
        if (!this.status.connected || !this.status.identity.slide)
            return { ok: true, message: "This firmware slides no text." };
        const slides = this.slidesIn(pageId, signature);
        const crc = slide ? crc32(slide) : undefined;
        if (slides.get(cell) === crc) return { ok: true, message: "Unchanged." };
        const reply = slide
            ? await this.session.link.push(
                  cell,
                  slide,
                  () => {},
                  `SLIDE ${index} ${signature} ${cell} ${slide.length} ${crc}`,
              )
            : await this.session.link.command(`SLIDE ${index} ${signature} ${cell} 0 0`, 2000);
        if (reply.ok && crc !== undefined) slides.set(cell, crc);
        else if (reply.ok) slides.delete(cell);
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
        const base = patches.get(cell) ?? record.frames[cell]!;
        if (base.equals(next)) return { ok: true, message: "Unchanged." };
        const send = (payload: Uint8Array, baseCrc: number): Promise<Reply> =>
            this.session.link.push(
                cell,
                payload,
                () => {},
                `LIVE ${index} ${record.signature} ${cell} ${baseCrc} ${payload.length} ${crc32(payload)}`,
            );
        let reply = await send(encodeLivePatch(base, next, width, height), crc32(base));
        if (!reply.ok && reply.message.includes("live base"))
            reply = await send(encodeLivePatch(null, next, width, height), 0);
        if (reply.ok) patches.set(cell, next);
        if (reply.ok) this.wheels.pictureSent(pageId, cell);
        return reply;
    }

    /**
     * Show the page's own pictures again on keys in the deck's copy `signature`
     * that have live pictures and are widgets no longer - their live picture and
     * sliding text dropped. Widget keys keep theirs; their next patch goes on top.
     */
    async restoreKeys(pageId: string, index: number, signature: number): Promise<Reply> {
        const patches = this.livePatched.get(pageId)?.get(signature);
        const slides = this.liveSlides.get(pageId)?.get(signature);
        const page = this.config.pages[index];
        if ((!patches?.size && !slides?.size) || !page || !this.status.connected)
            return { ok: true, message: "" };
        for (const cell of new Set([...(slides?.keys() ?? []), ...(patches?.keys() ?? [])])) {
            if (isWidgetKey(page, cell)) continue;
            // The key's own picture is intact: dropping its live one shows it,
            // and drops the text sliding over it too.
            const reply = patches?.has(cell)
                ? await this.session.link.command(`LIVE ${index} ${signature} ${cell} 0 0 0`, 2000)
                : await this.syncSlide(pageId, index, signature, cell, null);
            if (!reply.ok) return reply;
            patches?.delete(cell);
            slides?.delete(cell);
        }
        return { ok: true, message: "" };
    }
}
