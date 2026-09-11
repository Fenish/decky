import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Widget, WidgetState } from "../../../../shared/widgets";
import { sampleState } from "./samples";
import { drawWidget } from "./draw-widget";
import type { WidgetLook } from "./draw-widget";

/** One style, drawn live small, to pick by looking at it. */
export function StyleChoice({
    widget,
    look,
    active,
    label,
    onPick,
    state,
}: {
    widget: Widget;
    look: WidgetLook;
    active: boolean;
    label: string;
    onPick: () => void;
    /** Made-up readings, for widgets that show them. */
    state?: WidgetState;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        const context = ref.current?.getContext("2d");
        if (context) drawWidget(context, widget, { ...look, label: "" }, 96, 96, { state, now });
    }, [widget, look, now, state]);
    return (
        <button
            className={`widget-style ${active ? "active" : ""}`}
            aria-pressed={active}
            aria-label={`${label} style`}
            onClick={onPick}
        >
            <canvas ref={ref} width={96} height={96} />
            <span>{label}</span>
        </button>
    );
}

/**
 * A widget's styles side by side, each drawn with made-up readings; picking
 * one sets `field` to it.
 */
export function StylePicker({
    label,
    widget,
    look,
    field,
    options,
    onChange,
}: {
    label: string;
    widget: Widget;
    look: WidgetLook;
    field: string;
    options: { value: string; label: string }[];
    onChange: (widget: Widget) => void;
}) {
    const [now] = useState(() => Date.now());
    return (
        <div className="field">
            {label}
            <div
                className="widget-styles"
                role="group"
                aria-label={label}
                style={{ "--count": options.length } as CSSProperties}
            >
                {options.map((option) => {
                    const variant = { ...widget, [field]: option.value } as Widget;
                    return (
                        <StyleChoice
                            key={option.value}
                            widget={variant}
                            state={sampleState(variant, now)}
                            look={look}
                            active={(widget as Record<string, unknown>)[field] === option.value}
                            label={option.label}
                            onPick={() => onChange(variant)}
                        />
                    );
                })}
            </div>
        </div>
    );
}
