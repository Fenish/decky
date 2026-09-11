import type { Reply } from "../../../shared/api";
import type { CryptoWidget } from "../../../shared/widgets/crypto";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** A tap or a hold asks for the price at once. */
export class PriceAction implements WidgetAction<CryptoWidget> {
    press(context: WidgetActionContext, _widget: CryptoWidget, key: WidgetKey): Reply {
        context.feeds.now(key.address);
        return { ok: true, message: "Checking the price." };
    }
}
