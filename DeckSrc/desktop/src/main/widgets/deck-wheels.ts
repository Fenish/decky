/*---------------------------------------------------------------
 * Wheels the deck turns by itself: an adjustable countdown's drum, the
 * volume and microphone dials, a list's or coin's drum and the die. The app
 * sends a key's look (WHEEL) and hears where it comes to rest (EV ... WHEEL,
 * VALUE); DRAG names the keys a finger turns.
 *--------------------------------------------------------------*/

import { crc32 } from "../device/serial";
import { isWidgetKey, keyAddress } from "../../shared/config";
import type { DeckConfig, DeckPage } from "../../shared/config";
import type { DeckStatus, Reply } from "../../shared/api";
import { unpackPose } from "../../shared/die";
import { decodeWheelSpec } from "../../shared/wheel-spec";
import { diceFaces } from "../../shared/widgets/dice";
import type { DiceWidget } from "../../shared/widgets/dice";
import { deckTurned, fingerTurns } from "../../shared/widgets/registry";
import { hasWheel } from "../../shared/widgets/timer";
import type { DeckSession } from "../deck/session";
import type { DeckPages } from "../pages/deck-pages";
import type { Profile } from "../profile/profile";
import type { WidgetStore } from "./widget-state";

// Keys the deck turns a wheel on, on the page it shows (page id and
// signature): the look's CRC, the label it rests on, and the times behind
// its labels. The deck drops them when another page shows or a picture is
// sent for the key.
interface ArmedWheel {
    kind: "drum" | "dial" | "die";
    pageId: string;
    signature: number;
    crc: number;
    index: number;
    values: number[];
    /** Where a roll still spinning will land. */
    rolling?: number;
}

export class DeckWheels {
    private readonly wheels = new Map<number, ArmedWheel>();
    // As liveQueue (live-keys.ts), for wheels: the newest arming asked for each key.
    private readonly wheelQueue = new Map<string, unknown[]>();
    // The keys the deck reports finger movement on, as last sent; null if unknown.
    private dragMask: number | null = null;

    constructor(
        private readonly session: DeckSession,
        private readonly profile: Profile,
        private readonly pages: DeckPages,
        private readonly widgetStore: WidgetStore,
    ) {}

    private get status(): DeckStatus {
        return this.session.status;
    }

    private get config(): DeckConfig {
        return this.profile.config;
    }

    /** The deck forgets them all: on HELLO, a reset, or a deck found again. */
    clear(): void {
        this.dragMask = null;
        this.wheels.clear();
    }

    /** Whether the deck turns the wheel on a key of `pageId` itself. */
    turns(cell: number, pageId: string): boolean {
        return this.wheels.get(cell)?.pageId === pageId;
    }

    /** The deck's wheel on a key of the page shown ends with a picture for it. */
    pictureSent(pageId: string, cell: number): void {
        if (this.wheels.get(cell)?.pageId === pageId) this.wheels.delete(cell);
    }

    /**
     * Arm a key's wheel from the window (deck:wheel). An arming waiting its
     * turn takes the newest look instead.
     */
    queue(
        pageId: unknown,
        cell: unknown,
        spec: unknown,
        values: unknown,
        index: unknown,
    ): Reply | Promise<Reply> {
        const address = `${String(pageId)}:${String(cell)}`;
        const waiting = this.wheelQueue.has(address);
        this.wheelQueue.set(address, [spec, values, index]);
        if (waiting) return { ok: true, message: "Queued." };
        return this.session.serial(() => {
            const [newest, times, at] = this.wheelQueue.get(address)!;
            this.wheelQueue.delete(address);
            return this.sendWheel(pageId, cell, newest, times, at);
        });
    }

    /**
     * Hand an adjustable countdown at rest to the deck, which draws and turns its
     * wheel. A look the deck already keeps (by CRC) is armed with one line; only
     * a new one travels whole.
     */
    private async sendWheel(
        pageId: unknown,
        cell: unknown,
        spec: unknown,
        values: unknown,
        index: unknown,
    ): Promise<Reply> {
        if (
            typeof pageId !== "string" ||
            !Number.isInteger(cell) ||
            Number(cell) < 0 ||
            Number(cell) > 14
        )
            throw new Error("Invalid key.");
        if (!this.status.connected || !this.status.identity.wheel)
            return { ok: false, message: "This firmware turns no wheels." };
        const { keyWidth: width, keyHeight: height } = this.status.identity;
        const look = spec instanceof Uint8Array ? decodeWheelSpec(spec, width, height) : null;
        // A drum's labels each stand for a value (a time, a coin's side); a
        // dial's index is its value, and a die's how it lies.
        const count = look?.kind === "drum" ? look.labels.length : 0;
        const [low, high] = look?.kind === "dial" ? [look.min, look.max] : [0, count - 1];
        const placed =
            look?.kind === "die"
                ? unpackPose(Number(index)) !== null
                : Number(index) >= low && Number(index) <= high;
        if (
            !look ||
            !(spec instanceof Uint8Array) ||
            !Array.isArray(values) ||
            values.length !== count ||
            values.some((v) => !Number.isInteger(v) || v < 0 || v > 86_399) ||
            !Number.isInteger(index) ||
            !placed
        )
            throw new Error("Invalid wheel.");
        if (look.kind !== "drum" && !this.status.identity.dial)
            return { ok: false, message: "This firmware turns no dials." };
        const at = Number(cell);
        const pageIndex = this.config.pages.findIndex((page) => page.id === pageId);
        const record = this.pages.uploaded.get(pageId);
        if (
            !this.pages.deviceReady ||
            this.config.activePageId !== pageId ||
            pageIndex < 0 ||
            !record
        )
            return { ok: true, message: "The page is not on the deck." };
        const widget = this.profile.currentWidget(pageId, at);
        const turned =
            widget && deckTurned(widget, this.widgetStore.get(keyAddress(pageId, at)), Date.now());
        if (widget?.type === "timer" && hasWheel(widget) && !turned)
            return { ok: true, message: "The countdown is running." };
        if (turned !== look.kind) return { ok: true, message: "That key has no wheel." };
        const crc = crc32(spec);
        const armed = this.wheels.get(at);
        if (
            armed?.pageId === pageId &&
            armed.signature === record.signature &&
            armed.crc === crc &&
            armed.index === index
        )
            return { ok: true, message: "Unchanged." };
        let reply = await this.session.link.command(
            `WHEELAT ${pageIndex} ${record.signature} ${at} ${index} ${crc}`,
            2000,
        );
        if (!reply.ok && reply.message.includes("wheel unknown"))
            reply = await this.session.link.push(
                at,
                spec,
                () => {},
                `WHEEL ${pageIndex} ${record.signature} ${at} ${index} ${spec.length} ${crc}`,
            );
        if (reply.ok)
            this.wheels.set(at, {
                kind: look.kind,
                pageId,
                signature: record.signature,
                crc,
                index: Number(index),
                values: values as number[],
            });
        else this.wheels.delete(at);
        return reply;
    }

    /**
     * The deck's drum came to rest on a label: a countdown's time now, or the
     * side a roll landed on. Or its die stopped: the face up, and where it lies.
     */
    wheelSettled(cell: number, index: number): void {
        const armed = this.wheels.get(cell);
        if (!armed || armed.pageId !== this.config.activePageId) return;
        const widget = this.profile.currentWidget(armed.pageId, cell);
        const address = keyAddress(armed.pageId, cell);
        if (armed.kind === "die") {
            const pose = unpackPose(index);
            if (!pose || widget?.type !== "dice") return;
            armed.index = index;
            this.widgetStore.set(address, { value: pose.face, rest: index });
            return;
        }
        const value = armed.values[index];
        if (value === undefined) return;
        armed.index = index;
        armed.rolling = undefined;
        if (widget?.type === "timer" && hasWheel(widget))
            this.widgetStore.set(address, { picked: { seconds: value, over: widget.seconds } });
        else if (widget?.type === "dice") this.widgetStore.set(address, { value });
    }

    /**
     * A finger turns a dial on the deck: it now rests at `value`. False when
     * no dial of the page shown is there.
     */
    dialTurned(cell: number, value: number): boolean {
        const armed = this.wheels.get(cell);
        if (armed?.kind !== "dial" || armed.pageId !== this.config.activePageId) return false;
        armed.index = value;
        return true;
    }

    /**
     * Roll dice: a face picked at random, which a drum on the deck spins to -
     * two turns of faces at least - and lands on. Without one, the app shows it.
     * A tap while it spins rolls on from where it was going, never back.
     */
    rollDice(pageId: string, cell: number, widget: DiceWidget): string {
        const faces = diceFaces(widget);
        const pick = Math.floor(Math.random() * faces.length);
        const armed = this.wheels.get(cell);
        const pageIndex = this.config.pages.findIndex((page) => page.id === pageId);
        // A die on the deck is thrown there, and lands however it lands.
        if (
            armed?.kind === "die" &&
            armed.pageId === pageId &&
            this.pages.deviceReady &&
            pageIndex >= 0
        ) {
            this.rollOnDeck(
                pageId,
                cell,
                `WHEELROLL ${pageIndex} ${armed.signature} ${cell} 0`,
                pick,
            );
            return "Rolling.";
        }
        if (armed?.pageId === pageId && this.pages.deviceReady && pageIndex >= 0) {
            let target = (armed.rolling ?? armed.index) + Math.max(10, faces.length * 2);
            while (target < armed.values.length - 1 && armed.values[target] !== pick) target++;
            if (armed.values[target] === pick) {
                armed.rolling = target;
                const command = `WHEELROLL ${pageIndex} ${armed.signature} ${cell} ${target}`;
                this.rollOnDeck(pageId, cell, command, pick);
                return `Rolling for ${faces[pick]}.`;
            }
        }
        this.widgetStore.set(keyAddress(pageId, cell), { value: pick });
        return `Rolled ${faces[pick]}.`;
    }

    /**
     * Roll a key the deck turns. Should the deck refuse - it no longer has the
     * key armed (older firmware drops a look for another, and its key with
     * it) - the app rolls it instead, and forgets the arming so the key's look
     * goes again with its next picture.
     */
    private rollOnDeck(pageId: string, cell: number, command: string, pick: number): void {
        void this.session
            .serial(() => this.session.link.command(command, 2000))
            .then((reply) => {
                if (reply.ok) return;
                this.wheels.delete(cell);
                this.widgetStore.set(keyAddress(pageId, cell), { value: pick });
            })
            .catch(() => {});
    }

    /** Wheels belong to the page the deck showed them on; another page drops them. */
    forgetHiddenWheels(): void {
        const { displayed } = this.pages;
        for (const [cell, armed] of this.wheels)
            if (armed.pageId !== displayed?.pageId || armed.signature !== displayed.signature)
                this.wheels.delete(cell);
    }

    /** Tell the deck which keys of the page shown have wheels, if that changed. */
    async syncDrag(page: DeckPage): Promise<void> {
        if (!this.status.connected || !this.status.identity.drag) return;
        let mask = 0;
        for (let cell = 0; cell < 15; cell++) {
            const action = page.keys[String(cell)]?.action;
            // Keys a finger turns: a swipe on them is neither a tap nor a hold.
            const turns = action?.kind === "widget" && fingerTurns(action.widget);
            if (isWidgetKey(page, cell) && turns) mask |= 1 << cell;
        }
        if (mask === this.dragMask) return;
        const reply = await this.session.link.command(`DRAG ${mask}`, 2000);
        this.dragMask = reply.ok ? mask : null;
    }
}
