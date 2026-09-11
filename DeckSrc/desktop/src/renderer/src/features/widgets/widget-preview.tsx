import { useEffect, useRef, useState } from "react";
import { nextChange } from "../../../../shared/widgets";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { drawWidget } from "./draw-widget";
import type { WidgetLook } from "./draw-widget";

const SIZE = 240;

/**
 * A widget as it looks right now, redrawn exactly when its picture next
 * changes - on the second, the minute or at midnight - rather than polling.
 */
export function WidgetPreview({
    widget,
    look,
    state,
}: {
    widget: Widget;
    look: WidgetLook;
    state: WidgetState | undefined;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [tick, setTick] = useState(0);
    const { background, color, label } = look;
    // A cover picture that finished loading draws the preview again.
    useEffect(() => {
        const loaded = (): void => setTick((value) => value + 1);
        window.addEventListener("decky-art", loaded);
        return () => window.removeEventListener("decky-art", loaded);
    }, []);
    useEffect(() => {
        const context = ref.current?.getContext("2d");
        if (!context) return;
        const now = Date.now();
        drawWidget(context, widget, { background, color, label }, SIZE, SIZE, { state, now });
        const wait = nextChange(widget, state, now);
        if (wait === null) return;
        const timer = setTimeout(() => setTick((value) => value + 1), wait + 5);
        return () => clearTimeout(timer);
    }, [widget, background, color, label, state, tick]);
    return (
        <canvas
            ref={ref}
            width={SIZE}
            height={SIZE}
            className="artwork-preview"
            aria-label={`${label || "Widget"} preview`}
        />
    );
}
