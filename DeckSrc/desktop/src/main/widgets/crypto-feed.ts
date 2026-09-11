/*---------------------------------------------------------------
 * Live coin prices for crypto widgets: Binance's public market data (no
 * account or key), streamed - a price a second while it trades - over one
 * WebSocket for every coin in use. The last 24 hours for the chart come from
 * the same place, hourly. A coin the stream says nothing about is read from
 * Binance's REST ticker, else CoinGecko, every minute.
 *--------------------------------------------------------------*/

import type { WidgetState } from "../../shared/widgets";
import { COINS } from "../../shared/widgets/crypto";
import type { WidgetStore } from "./widget-state";

const STREAM = "wss://data-stream.binance.vision/stream?streams=";
const REST = "https://data-api.binance.vision/api/v3";
/** How far back the ticker's arrow looks: the move over the last minute. */
export const ARROW_MS = 60_000;
/** A coin the stream has said nothing about for this long is asked for instead. */
const QUIET_MS = 20_000;
const HISTORY_MS = 3_600_000;
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];

/** The little of WebSocket used here, so tests can stand in for it. */
export interface Socket {
    onopen: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    close(): void;
}

/** A Binance symbol for a coin's CoinGecko id: BTCUSDT for bitcoin. */
export function pairOf(coin: string): string | undefined {
    const symbol = COINS.find((item) => item.id === coin)?.symbol;
    return symbol ? `${symbol}USDT` : undefined;
}

/** A price and the day's change from a 24-hour ticker, streamed or asked for. */
export function readTicker(
    body: unknown,
): { symbol: string; price: number; change: number } | null {
    const data = (body as { data?: unknown })?.data ?? body;
    if (typeof data !== "object" || data === null) return null;
    const t = data as Record<string, unknown>;
    // The stream's miniTicker: last (c) and 24 h ago (o); the REST ticker: lastPrice and its %.
    const price = Number(t.c ?? t.lastPrice);
    const open = Number(t.o ?? t.openPrice);
    const symbol = String(t.s ?? t.symbol ?? "");
    if (!symbol || !Number.isFinite(price) || price <= 0) return null;
    const change =
        t.priceChangePercent !== undefined
            ? Number(t.priceChangePercent)
            : open > 0
              ? ((price - open) / open) * 100
              : 0;
    return { symbol, price, change: Number.isFinite(change) ? change : 0 };
}

export class PriceStream {
    private keys: { address: string; coin: string }[] = [];
    private socket: Socket | null = null;
    private streams = "";
    private attempt = 0;
    private retry: NodeJS.Timeout | undefined;
    private timers: NodeJS.Timeout[] = [];
    /** Per pair: when the stream last spoke, the last day's hourly closes, recent prices. */
    private heard = new Map<string, number>();
    private closes = new Map<string, number[]>();
    private recent = new Map<string, { at: number; price: number }[]>();

    constructor(
        private readonly store: WidgetStore,
        private readonly fetchJson: (url: string) => Promise<unknown>,
        private readonly open: (url: string) => Socket = (url) =>
            new WebSocket(url) as unknown as Socket,
        private readonly clock: () => number = Date.now,
    ) {}

    /** The crypto keys on the profile, by address and coin: stream what they show. */
    sync(keys: { address: string; coin: string }[]): void {
        this.keys = keys;
        const pairs = [...new Set(keys.map((key) => pairOf(key.coin)).filter(Boolean))].sort();
        const streams = pairs.map((pair) => `${pair!.toLowerCase()}@miniTicker`).join("/");
        if (streams === this.streams) return;
        this.streams = streams;
        this.stopTimers();
        this.connect();
        if (!pairs.length) return;
        // The day drawn, now and every hour; and a word for coins the stream is quiet about.
        for (const pair of pairs) void this.history(pair!);
        this.timers.push(
            setInterval(() => pairs.forEach((pair) => void this.history(pair!)), HISTORY_MS),
            setInterval(() => this.askQuiet(), QUIET_MS),
        );
        this.timers.forEach((timer) => timer.unref?.());
    }

    /** A price now, for a tap. */
    now(address: string): void {
        const key = this.keys.find((item) => item.address === address);
        const pair = key && pairOf(key.coin);
        if (pair) void this.ask(pair, key.coin);
    }

    stop(): void {
        this.streams = "";
        this.stopTimers();
        this.connect();
    }

    private stopTimers(): void {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }

    private connect(): void {
        clearTimeout(this.retry);
        const old = this.socket;
        this.socket = null;
        if (old) {
            old.onclose = null;
            old.close();
        }
        if (!this.streams) return;
        const socket = this.open(STREAM + this.streams);
        this.socket = socket;
        socket.onopen = () => (this.attempt = 0);
        socket.onmessage = (event) => {
            const tick = readTicker(typeof event.data === "string" ? JSON.parse(event.data) : null);
            if (tick) this.update(tick.symbol, tick.price, tick.change);
        };
        socket.onerror = () => {};
        socket.onclose = () => {
            if (this.socket !== socket) return;
            this.socket = null;
            const wait = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]!;
            this.retry = setTimeout(() => this.connect(), wait);
            this.retry.unref?.();
        };
    }

    private update(pair: string, price: number, change: number): void {
        const now = this.clock();
        this.heard.set(pair, now);
        // A price a few seconds apart over the last while, for the arrow.
        const recent = (this.recent.get(pair) ?? []).filter(
            (item) => now - item.at <= ARROW_MS * 1.5,
        );
        if (!recent.length || now - recent[recent.length - 1]!.at >= 5000)
            recent.push({ at: now, price });
        this.recent.set(pair, recent);
        const before = recent.filter((item) => now - item.at >= ARROW_MS).at(-1) ?? recent[0]!;
        const closes = this.closes.get(pair) ?? [];
        const next: WidgetState = {
            price,
            // As shown, to two places: a key wakes for what can be seen.
            change: Math.round(change * 100) / 100,
            previous: before.price,
            history: closes.length ? [...closes.slice(-24), price] : [price],
            checkedAt: now,
        };
        for (const key of this.keys)
            if (pairOf(key.coin) === pair) {
                const state = this.store.get(key.address);
                if (
                    state?.price !== price ||
                    state.change !== next.change ||
                    state.previous !== next.previous
                )
                    this.store.set(key.address, next, false);
            }
    }

    /** The last day's hourly closes: the chart. */
    private async history(pair: string): Promise<void> {
        try {
            const rows = await this.fetchJson(`${REST}/klines?symbol=${pair}&interval=1h&limit=25`);
            if (!Array.isArray(rows)) return;
            const closes = rows
                .map((row) => Number(Array.isArray(row) ? row[4] : NaN))
                .filter(Number.isFinite);
            if (closes.length) this.closes.set(pair, closes.slice(0, -1));
        } catch {
            // The stream's price alone draws a flat line until the next hour.
        }
    }

    private askQuiet(): void {
        const now = this.clock();
        for (const key of this.keys) {
            const pair = pairOf(key.coin);
            if (pair && now - (this.heard.get(pair) ?? 0) > QUIET_MS) void this.ask(pair, key.coin);
        }
    }

    /** A price asked for: Binance's ticker, else CoinGecko's. */
    private async ask(pair: string, coin: string): Promise<void> {
        try {
            const tick = readTicker(await this.fetchJson(`${REST}/ticker/24hr?symbol=${pair}`));
            if (tick) return this.update(pair, tick.price, tick.change);
        } catch {
            // Binance may be out of reach from here; CoinGecko then.
        }
        try {
            const body = await this.fetchJson(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coin}&price_change_percentage=24h`,
            );
            const first = Array.isArray(body) ? (body[0] as Record<string, unknown>) : undefined;
            const price = Number(first?.current_price);
            if (Number.isFinite(price) && price > 0)
                this.update(pair, price, Number(first?.price_change_percentage_24h) || 0);
        } catch {
            // Nothing to show but the last price.
        }
    }
}
