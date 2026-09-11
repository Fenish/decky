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
import { isWidgetKey, keyAddress } from "../shared/config";
import type { DeckConfig } from "../shared/config";
import { trackPosition } from "../shared/widgets";
import type { Track, WidgetState } from "../shared/widgets";
import type { WidgetStore } from "./widgets";
import type { HostEvent, WindowsHost } from "./system/windows-host";
import { PriceStream } from "./crypto-feed";
import type { Socket } from "./crypto-feed";

/** Samples kept for a graph: a minute at one a second. */
export const HISTORY = 60;
/**
 * A full reading of the sound this often besides Windows' word, should one
 * be missed; and how long after the deck sets the volume Windows' echoes of
 * it are let pass, so a dial being turned never jumps back.
 */
const AUDIO_CHECK_S = 15;
const VOLUME_QUIET_MS = 400;

export interface AudioReading {
    level: number;
    muted: boolean;
    mic: { muted: boolean } | null;
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
    private audioKeys: { address: string; type: "volume" | "mic" }[] = [];
    private mediaKeys: string[] = [];
    private cryptoKeys = new Set<string>();
    private volumeNext: number | null = null;
    private volumeBusy = false;
    private volumeQuietUntil = 0;
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
        const audio: { address: string; type: "volume" | "mic" }[] = [];
        const media: string[] = [];
        const coins: { address: string; coin: string }[] = [];
        for (const page of config.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                if (key.action.kind !== "widget" || !isWidgetKey(page, Number(cell))) continue;
                const widget = key.action.widget;
                const address = keyAddress(page.id, Number(cell));
                if (widget.type === "system")
                    wanted.set(address, {
                        key: `system ${widget.interval}`,
                        seconds: widget.interval,
                        run: async () => this.system(address),
                    });
                else if (widget.type === "crypto") coins.push({ address, coin: widget.coin });
                else if (widget.type === "volume" || widget.type === "mic")
                    audio.push({ address, type: widget.type });
                else if (widget.type === "media") media.push(address);
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
        if (!audio.length && !media.length) {
            this.host.stop();
            this.listening = -1;
        }
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
        for (const { address, type } of this.audioKeys) {
            if (type === "volume" && Date.now() < this.volumeQuietUntil) continue;
            this.put(
                address,
                type === "volume"
                    ? { level: reading.level, muted: reading.muted }
                    : reading.mic
                      ? { muted: reading.mic.muted }
                      : { missing: true },
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
        for (const { address, type } of this.audioKeys) {
            if (type === "volume" && event.flow === 0 && Date.now() >= this.volumeQuietUntil)
                this.put(address, { level: Number(event.level), muted: event.muted === true });
            else if (type === "mic" && event.flow === 1)
                this.put(
                    address,
                    event.missing ? { missing: true } : { muted: event.muted === true },
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

    /**
     * Set the volume, as a finger turns the dial. Values that come while one
     * is being set wait, and only the newest goes next.
     */
    async setVolume(level: number): Promise<void> {
        this.volumeNext = Math.max(0, Math.min(100, Math.round(level)));
        this.volumeQuietUntil = Date.now() + VOLUME_QUIET_MS;
        if (this.volumeBusy) return;
        this.volumeBusy = true;
        try {
            while (this.volumeNext !== null) {
                const next = this.volumeNext;
                this.volumeNext = null;
                await this.host.request("volume", { level: next });
                this.volumeQuietUntil = Date.now() + VOLUME_QUIET_MS;
                for (const { address, type } of this.audioKeys)
                    if (type === "volume")
                        this.store.set(
                            address,
                            {
                                level: next,
                                muted: next > 0 ? false : this.store.get(address)?.muted,
                            },
                            false,
                        );
            }
        } finally {
            this.volumeBusy = false;
        }
    }

    /**
     * Mute or unmute the speaker or the microphone. Every key showing it
     * changes at once; Windows' own word follows, and puts it right if the
     * change did not take.
     */
    async toggleMute(address: string, microphone: boolean): Promise<void> {
        const muted = !this.store.get(address)?.muted;
        for (const key of this.audioKeys)
            if ((key.type === "mic") === microphone)
                this.store.set(key.address, { ...this.store.get(key.address), muted }, false);
        try {
            await this.host.request(microphone ? "micmute" : "mute", { muted });
        } catch (error) {
            this.now("audio");
            throw error;
        }
    }

    /**
     * Play or pause, or skip to the next track, in whatever is playing. Play
     * and pause show at once, the progress stopping or moving on from where
     * it is; a read soon after confirms it.
     */
    async control(what: "media-toggle" | "media-next"): Promise<void> {
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
