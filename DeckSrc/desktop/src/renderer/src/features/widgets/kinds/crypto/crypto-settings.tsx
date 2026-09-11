import type { ReactNode } from "react";
import { COINS } from "../../../../../../shared/widgets/crypto";
import type { CryptoWidget } from "../../../../../../shared/widgets/crypto";
import { StylePicker } from "../../style-picker";
import type { SettingsProps } from "../widget-view";

export function cryptoSettings({ widget, look, onChange }: SettingsProps<CryptoWidget>): ReactNode {
    return (
        <>
            <StylePicker
                label="Style"
                widget={widget}
                look={look}
                field="style"
                options={[
                    { value: "chart", label: "Chart" },
                    { value: "ticker", label: "Ticker" },
                ]}
                onChange={onChange}
            />
            <label className="field">
                Coin
                <select
                    aria-label="Coin"
                    value={widget.coin}
                    onChange={(event) => onChange({ ...widget, coin: event.target.value })}
                >
                    {COINS.map((coin) => (
                        <option key={coin.id} value={coin.id}>
                            {coin.symbol}
                        </option>
                    ))}
                </select>
            </label>
        </>
    );
}

export function cryptoHint(): string {
    return (
        "Live prices in US dollars, a new one each second while it trades (Binance's " +
        "public market feed). The chart is the last 24 hours; the ticker's arrow is the " +
        "move over the last minute. Tap to check now."
    );
}
