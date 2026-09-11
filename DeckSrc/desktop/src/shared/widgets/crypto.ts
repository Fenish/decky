import type { WidgetKind } from "./widget-kind";

/** A coin's price in US dollars, live (src/main/widgets/crypto-feed.ts). */
export type CryptoWidget = {
    type: "crypto";
    coin: string;
    style: "chart" | "ticker";
};

/** Coins to choose from: CoinGecko's id, the ticker, and its colour. */
export const COINS: { id: string; symbol: string; color: string }[] = [
    { id: "bitcoin", symbol: "BTC", color: "#f7931a" },
    { id: "ethereum", symbol: "ETH", color: "#8a92f2" },
    { id: "solana", symbol: "SOL", color: "#a77bff" },
    { id: "binancecoin", symbol: "BNB", color: "#f3ba2f" },
    { id: "ripple", symbol: "XRP", color: "#9fb2c8" },
    { id: "dogecoin", symbol: "DOGE", color: "#d4b44a" },
    { id: "cardano", symbol: "ADA", color: "#5b8def" },
    { id: "avalanche-2", symbol: "AVAX", color: "#ef5a5b" },
    { id: "the-open-network", symbol: "TON", color: "#2aa7e8" },
];

/** A price in dollars, shortened only when it would not fit: $76,904, $1.25M, $0.1234. */
export function formatPrice(price: number): string {
    const sign = "$";
    if (price >= 1_000_000)
        return (
            sign +
            new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 2,
            }).format(price)
        );
    if (price >= 1000) return sign + Math.round(price).toLocaleString("en-US");
    if (price >= 1) return sign + price.toFixed(2);
    return sign + price.toPrecision(4);
}

export const cryptoKind: WidgetKind<CryptoWidget> = {
    type: "crypto",
    label: "Crypto",
    icon: "Bitcoin",
    words: "bitcoin btc price coin",
    defaults: () => ({ type: "crypto", coin: "bitcoin", style: "chart" }),
    valid: (w) =>
        COINS.some((coin) => coin.id === w.coin) && (w.style === "chart" || w.style === "ticker"),
    // Prices are live, in dollars: a currency and an interval no longer mean anything.
    retire: (value) => {
        delete value.currency;
        delete value.interval;
    },
};
