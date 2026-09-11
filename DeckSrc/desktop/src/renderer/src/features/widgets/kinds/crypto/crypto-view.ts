import type { CryptoWidget } from "../../../../../../shared/widgets/crypto";
import { wave } from "../../samples";
import type { WidgetView } from "../widget-view";
import { cryptoHint, cryptoSettings } from "./crypto-settings";
import { drawCrypto } from "./draw-crypto";

export const cryptoView: WidgetView<CryptoWidget> = {
    draw: drawCrypto,
    settings: cryptoSettings,
    hint: cryptoHint,
    sample: () => ({
        price: 76_904,
        change: 1.42,
        previous: 76_800,
        history: wave(25, 76_000, 500, 1),
    }),
};
