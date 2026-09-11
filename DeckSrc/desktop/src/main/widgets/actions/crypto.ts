import type { CryptoWidget } from "../../../shared/widgets/crypto";
import type { GestureHandler, WidgetAction } from "./widget-action";

const checkPrice: GestureHandler<CryptoWidget> = (context, _widget, key) => {
    context.feeds.now(key.address);
    return { ok: true, message: "Checking the price." };
};

/** A tap or a hold asks for the price at once. */
export class PriceAction implements WidgetAction<CryptoWidget> {
    readonly gestures = { tap: checkPrice, hold: checkPrice };
}
