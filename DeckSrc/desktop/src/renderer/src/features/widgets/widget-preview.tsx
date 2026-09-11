import { useEffect, useRef, useState } from "react";
import { sweepMoving } from "../../../../shared/sweep-spec";
import type { SweepArc } from "../../../../shared/sweep-spec";
import { nextChange } from "../../../../shared/widgets/registry";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { paintArc } from "./canvas-kit";
import { drawWidget } from "./draw-widget";
import type { WidgetLook } from "./draw-widget";

const SIZE = 240;

/**
 * A widget as it looks right now, as the deck shows it: its picture, redrawn
 * exactly when it next changes - on the second, the minute or at midnight -
 * and a ring's arc painted over it every frame while it moves, as the deck
 * moves it.
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
    const { background, color, label, icon, iconSize } = look;
    // A cover picture that finished loading draws the preview again.
    useEffect(() => {
        const loaded = (): void => setTick((value) => value + 1);
        window.addEventListener("decky-art", loaded);
        return () => window.removeEventListener("decky-art", loaded);
    }, []);
    useEffect(() => {
        const context = ref.current?.getContext("2d");
        if (!context) return;
        let frame = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const draw = (): void => {
            const now = Date.now();
            const sweeps: SweepArc[] = [];
            drawWidget(context, widget, { background, color, label, icon, iconSize }, SIZE, SIZE, {
                state,
                now,
                sweeps,
            });
            for (const arc of sweeps) paintArc(context, arc, now);
            if (sweeps.some((arc) => sweepMoving(arc.motion, now)))
                frame = requestAnimationFrame(draw);
            else {
                const wait = nextChange(widget, state, now);
                if (wait !== null) timer = setTimeout(draw, wait + 5);
            }
        };
        draw();
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
        };
    }, [widget, background, color, label, icon, iconSize, state, tick]);
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
