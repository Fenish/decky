import type { DeckConfig } from "../../shared/config";
import type { DeckStatus, Warmup } from "../../shared/api";
import { decodeWheelSpec } from "../../shared/wheel-spec";
import { isWidgetKey } from "../../shared/config";

/**
 * While the deck loads: every page's widget pictures as they are now, and the
 * looks of the keys it turns, sent ahead - what `warmup` holds that is valid.
 */
export function warmupItems(
    warmup: unknown,
    status: DeckStatus,
    config: DeckConfig,
    validSlide: (slide: unknown) => boolean,
): Warmup {
    const none: Warmup = { widgets: [], looks: [] };
    if (!status.connected || !status.identity.warm || typeof warmup !== "object" || !warmup)
        return none;
    const { widgets, looks } = warmup as Record<string, unknown>;
    const bytes = status.identity.keyWidth * status.identity.keyHeight * 2;
    const pageOf = (id: unknown) => config.pages.find((page) => page.id === id);
    return {
        widgets: (Array.isArray(widgets) ? widgets.slice(0, 64 * 15) : []).filter(
            (item): item is Warmup["widgets"][number] => {
                const page = pageOf(item?.pageId);
                return (
                    !!page &&
                    Number.isInteger(item.cell) &&
                    item.cell >= 0 &&
                    item.cell <= 14 &&
                    isWidgetKey(page, item.cell) &&
                    item.frame instanceof Uint8Array &&
                    item.frame.length === bytes &&
                    validSlide(item.slide)
                );
            },
        ),
        looks: (Array.isArray(looks) ? looks.slice(0, 32) : []).filter(
            (item): item is Warmup["looks"][number] =>
                !!pageOf(item?.pageId) &&
                item.spec instanceof Uint8Array &&
                item.spec.length > 0 &&
                item.spec.length <= 48 * 1024 &&
                decodeWheelSpec(
                    item.spec,
                    status.connected ? status.identity.keyWidth : 0,
                    status.connected ? status.identity.keyHeight : 0,
                ) !== null,
        ),
    };
}
