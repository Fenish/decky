import { encodeLivePatch } from "../../../../../../shared/live-patch";
import { encodeWheelSpec, WHEEL_FEEL } from "../../../../../../shared/wheel-spec";
import { formatDuration } from "../../../../../../shared/widgets";
import type { WidgetState } from "../../../../../../shared/widgets";
import { timerSeconds, wheelValues } from "../../../../../../shared/widgets/timer";
import type { TimerWidget } from "../../../../../../shared/widgets/timer";
import { drawWidget, widgetArea } from "../../draw-widget";
import type { WidgetLook } from "../../draw-widget";
import { glyphs, picture, plain, rgb565 } from "../../wheel";
import type { DeckKey } from "../widget-view";
import { wheelFonts, wheelGeometry } from "./draw-timer";

function countdown(
    look: WidgetLook,
    widget: TimerWidget,
    width: number,
    height: number,
): Uint8Array {
    const values = wheelValues(widget);
    const area = widgetArea(look, width, height);
    const { row, center } = wheelGeometry(area);
    let fonts: [number, number] = [0, 0];
    const backdrop = picture(width, height, (ctx) => {
        // The base picture: background, caption and band, without the times.
        drawWidget(ctx, widget, look, width, height);
        fonts = wheelFonts(ctx, area, row);
    });
    const texts = values.map((seconds) => formatDuration(seconds * 1000));
    const chars = plain([...new Set(texts.join(""))].sort());
    return encodeWheelSpec({
        kind: "drum",
        row,
        center,
        clipTop: Math.round(area.y),
        clipBottom: Math.round(area.y + area.h),
        color: rgb565(look.color),
        feel: WHEEL_FEEL,
        backdrop: encodeLivePatch(null, backdrop, width, height),
        sizes: [glyphs(chars, fonts[0]), glyphs(chars, fonts[1])],
        labels: texts.map((text) => ({ size: text.length > 5 ? 1 : 0, text })),
    });
}

/** An adjustable countdown at rest: a drum of its times, each label one of them. */
export function timerWheel({ look, widget, width, height }: DeckKey<TimerWidget>): Uint8Array {
    return countdown(look, widget, width, height);
}

/** The times its labels stand for, and the one it will run. */
export function timerPlace(
    widget: TimerWidget,
    state: WidgetState | undefined,
): { values: number[]; index: number } {
    const values = wheelValues(widget);
    return { values, index: values.indexOf(timerSeconds(widget, state)) };
}
