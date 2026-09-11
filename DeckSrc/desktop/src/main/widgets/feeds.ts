/*---------------------------------------------------------------
 * Widgets that show what the PC or the web says: system load, the volume
 * and the microphone, what is playing, prices. Kept as widget state, never
 * saved - a restart reads it again.
 *
 * What can tell of its own changes does: Windows says the moment the volume
 * or a mute changes (from the deck, the keyboard or its own slider), and
 * prices stream in live (crypto-feed.ts). The rest is read on an interval: the
 * CPU and memory, what is playing. A tap shows its result at once, before
 * Windows has answered.
 *--------------------------------------------------------------*/

import { cpus, freemem, totalmem } from "node:os";
import { isWidgetKey, keyAddress } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { Track, WidgetState } from "../../shared/widgets";
import type { SoundDevice } from "../../shared/widgets/level";
import { trackPosition } from "../../shared/widgets/media";
import { handleWidget } from "../../shared/widgets/registry";
import type { WidgetHandlers } from "../../shared/widgets/registry";
import type { WidgetStore } from "./widget-state";
import type { HostEvent, WindowsHost } from "../system/windows-host";
import { PriceStream } from "./crypto-feed";
import type { Socket } from "./crypto-feed";

/** Samples kept for a graph: a minute at one a second. */
export const HISTORY = 60;
/**
 * A full reading of the sound this often besides Windows' word, should one
 * be missed; and how long after the deck sets a level Windows' echoes of it
 * are let pass, so a dial being turned never jumps back.
 */
const AUDIO_CHECK_S = 15;
const LEVEL_QUIET_MS = 400;

/**
 * Each device as the helper knows it (its flow), and whether turning it up
 * unmutes it. The speaker does, as Windows' own slider does; a microphone stays
 * muted, so a stray turn never opens it.
 */
const DEVICES: Record<SoundDevice, { flow: number; unmutes: boolean }> = {
    speaker: { flow: 0, unmutes: true },
    microphone: { flow: 1, unmutes: false },
};

/** What the helper can tell whatever is playing to do. */
export type MediaControl = "media-toggle" | "media-next" | "media-previous";

/** A device's level (0-100) and mute. */
interface Sound {
    level: number;
    muted: boolean;
}
/** The helper's reading: no microphone is null. */
export type AudioReading = Record<SoundDevice, Sound | null>;

/**
 * A device's level, set as a finger turns its dial. Values that come while
 * one is being set wait, and only the newest goes next; for a moment after,
 * Windows' echoes of them are let pass.
 */
class LevelSetter {
    private next: number | null = null;
    private busy = false;
    private quietUntil = 0;

    constructor(private readonly apply: (level: number) => Promise<void>) {}

    /** Whether Windows' word on this device is let pass for now. */
    get quiet(): boolean {
        return Date.now() < this.quietUntil;
    }

    async set(level: number): Promise<void> {
        this.next = Math.max(0, Math.min(100, Math.round(level)));
        this.quietUntil = Date.now() + LEVEL_QUIET_MS;
        if (this.busy) return;
        this.busy = true;
        try {
            while (this.next !== null) {
                const next = this.next;
                this.next = null;
                await this.apply(next);
                this.quietUntil = Date.now() + LEVEL_QUIET_MS;
            }
        } finally {
            this.busy = false;
        }
    }
}
interface MediaReading {
    none?: boolean;
    title?: string;
    artist?: string;
    playing?: boolean;
    position?: number;
    duration?: number;
    updated?: number;
    cover?: string | null;
}

export const keep = (list: number[] | undefined, value: number): number[] =>
    [...(list ?? []), value].slice(-HISTORY);

/** The share of all cores at work since a caller last asked, in %. */
export class CpuMeter {
    private readonly last = new Map<string, { idle: number; total: number }>();
    constructor(private readonly read = cpus) {}
    sample(caller: string): number | null {
        const now = { idle: 0, total: 0 };
        for (const { times } of this.read()) {
            now.idle += times.idle;
            now.total += times.user + times.nice + times.sys + times.idle + times.irq;
        }
        const before = this.last.get(caller);
        this.last.set(caller, now);
        if (!before || now.total <= before.total) return null;
        return Math.round(100 * (1 - (now.idle - before.idle) / (now.total - before.total)));
    }
}

interface Feed {
    key: string;
    timer: NodeJS.Timeout;
    run: () => void;
}

export class WidgetFeeds {
    private readonly feeds = new Map<string, Feed>();
    private readonly cpu = new CpuMeter();
    private readonly prices: PriceStream;
    private audioKeys: { address: string; device: SoundDevice }[] = [];
    private mediaKeys: string[] = [];
    private cryptoKeys = new Set<string>();
    private readonly levels: Record<SoundDevice, LevelSetter> = {
        speaker: new LevelSetter((level) => this.applyLevel("speaker", level)),
        microphone: new LevelSetter((level) => this.applyLevel("microphone", level)),
    };
    // The helper run Windows was asked to tell of audio changes in.
    private listening = -1;

    constructor(
        private readonly store: WidgetStore,
        private readonly host: WindowsHost,
        fetchJson: (url: string) => Promise<unknown> = async (url) => {
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        },
        openSocket?: (url: string) => Socket,
    ) {
        this.prices = new PriceStream(store, fetchJson, openSocket);
        host.on?.((event) => this.heard(event));
    }

    /** Start, change and stop feeds to match the profile. */
    sync(config: DeckConfig): void {
        const wanted = new Map<
            string,
            { key: string; seconds: number; run: () => Promise<void> }
        >();
        const audio: { address: string; device: SoundDevice }[] = [];
        const media: string[] = [];
        const coins: { address: string; coin: string }[] = [];
        // What each kind of widget reads; the others read nothing.
        const reads: WidgetHandlers<[address: string], unknown> = {
            system: (widget, address) =>
                wanted.set(address, {
                    key: `system ${widget.interval}`,
                    seconds: widget.interval,
                    run: async () => this.system(address),
                }),
            crypto: (widget, address) => coins.push({ address, coin: widget.coin }),
            volume: (_widget, address) => audio.push({ address, device: "speaker" }),
            mic: (_widget, address) => audio.push({ address, device: "microphone" }),
            media: (_widget, address) => media.push(address),
        };
        for (const page of config.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                if (key.action.kind !== "widget" || !isWidgetKey(page, Number(cell))) continue;
                handleWidget(reads, key.action.widget, keyAddress(page.id, Number(cell)));
            }
        this.audioKeys = audio;
        this.mediaKeys = media;
        this.cryptoKeys = new Set(coins.map((item) => item.address));
        this.prices.sync(coins);
        // Volume and microphone share one listener, and a check now and then;
        // players are read every second.
        if (audio.length)
            wanted.set("audio", { key: "audio", seconds: AUDIO_CHECK_S, run: () => this.audio() });
        if (media.length)
            wanted.set("media", { key: "media", seconds: 1, run: () => this.playing() });
        for (const [id, feed] of this.feeds) {
            if (wanted.get(id)?.key === feed.key) continue;
            clearInterval(feed.timer);
            this.feeds.delete(id);
        }
        for (const [id, next] of wanted) {
            if (this.feeds.has(id)) continue;
            let busy = false;
            let again = false;
            // One reading at a time: a slow answer never stacks up behind
            // itself, and one asked for meanwhile follows it.
            const run = (): void => {
                if (busy) {
                    again = true;
                    return;
                }
                busy = true;
                void next
                    .run()
                    .catch(() => {})
                    .finally(() => {
                        busy = false;
                        if (again) {
                            again = false;
                            run();
                        }
                    });
            };
            const timer = setInterval(run, next.seconds * 1000);
            timer.unref();
            this.feeds.set(id, { key: next.key, timer, run });
            run();
        }
        const needed = audio.length > 0 || media.length > 0;
        this.host.hold("feeds", needed);
        if (!needed) this.listening = -1;
    }

    /** Read again now: a tap on a price, or right after a change. */
    now(id: string): void {
        if (this.cryptoKeys.has(id)) this.prices.now(id);
        else this.feeds.get(id)?.run();
    }

    stop(): void {
        for (const feed of this.feeds.values()) clearInterval(feed.timer);
        this.feeds.clear();
        this.prices.stop();
        this.host.stop();
    }

    private system(address: string): void {
        const state = this.store.get(address);
        const cpu = this.cpu.sample(address);
        this.store.set(
            address,
            {
                cpu: cpu === null ? (state?.cpu ?? []) : keep(state?.cpu, cpu),
                ram: keep(state?.ram, Math.round(100 * (1 - freemem() / totalmem()))),
            },
            false,
        );
    }

    /** Set a key's state if it changed: unchanged readings wake nothing up. */
    private put(address: string, next: WidgetState): void {
        if (JSON.stringify(this.store.get(address)) !== JSON.stringify(next))
            this.store.set(address, next, false);
    }

    private async audio(): Promise<void> {
        const reading = await this.host.request<AudioReading>("audio");
        for (const { address, device } of this.audioKeys) {
            if (this.levels[device].quiet) continue;
            const sound = reading[device];
            this.put(
                address,
                sound ? { level: sound.level, muted: sound.muted } : { missing: true },
            );
        }
        // From here Windows tells of every change itself - again after the
        // helper started anew.
        if (this.listening !== this.host.run) {
            await this.host.request("watch-audio");
            this.listening = this.host.run;
        }
    }

    /** Windows' word that the speaker (flow 0) or microphone (1) changed. */
    private heard(event: HostEvent): void {
        if (event.event !== "audio") return;
        for (const { address, device } of this.audioKeys) {
            if (DEVICES[device].flow !== event.flow || this.levels[device].quiet) continue;
            this.put(
                address,
                event.missing
                    ? { missing: true }
                    : { level: Number(event.level), muted: event.muted === true },
            );
        }
    }

    private async playing(): Promise<void> {
        const reading = await this.host.request<MediaReading>("media");
        const track: Track | undefined =
            reading.none || !reading.title
                ? undefined
                : {
                      title: reading.title,
                      artist: reading.artist ?? "",
                      playing: reading.playing === true,
                      position: reading.position ?? 0,
                      duration: reading.duration ?? 0,
                      at: reading.updated && reading.updated > 0 ? reading.updated : Date.now(),
                      ...(reading.cover ? { art: reading.cover } : {}),
                  };
        for (const address of this.mediaKeys)
            if (JSON.stringify(this.store.get(address)?.track) !== JSON.stringify(track))
                this.store.set(address, track ? { track } : {}, false);
    }

    /** Set a device's level, as a finger turns its dial. */
    setLevel(device: SoundDevice, level: number): Promise<void> {
        return this.levels[device].set(level);
    }

    private async applyLevel(device: SoundDevice, level: number): Promise<void> {
        const { flow, unmutes } = DEVICES[device];
        await this.host.request("level", { flow, level, unmute: unmutes });
        for (const key of this.audioKeys)
            if (key.device === device) {
                const muted = this.store.get(key.address)?.muted;
                this.store.set(
                    key.address,
                    { level, muted: unmutes && level > 0 ? false : muted },
                    false,
                );
            }
    }

    /**
     * Mute or unmute the speaker or the microphone. Every key showing it
     * changes at once; Windows' own word follows, and puts it right if the
     * change did not take.
     */
    async toggleMute(address: string, device: SoundDevice): Promise<void> {
        const muted = !this.store.get(address)?.muted;
        for (const key of this.audioKeys)
            if (key.device === device)
                this.store.set(key.address, { ...this.store.get(key.address), muted }, false);
        try {
            await this.host.request("mute", { flow: DEVICES[device].flow, muted });
        } catch (error) {
            this.now("audio");
            throw error;
        }
    }

    /**
     * Play or pause, or skip to the next or previous track, in whatever is
     * playing. Play and pause show at once, the progress stopping or moving
     * on from where it is; a read soon after confirms it.
     */
    async control(what: MediaControl): Promise<void> {
        if (what === "media-toggle") {
            const now = Date.now();
            for (const address of this.mediaKeys) {
                const track = this.store.get(address)?.track;
                if (track)
                    this.store.set(
                        address,
                        {
                            track: {
                                ...track,
                                position: trackPosition(track, now),
                                at: now,
                                playing: !track.playing,
                            },
                        },
                        false,
                    );
            }
        }
        await this.host.request(what);
        setTimeout(() => this.now("media"), 300);
    }
}
