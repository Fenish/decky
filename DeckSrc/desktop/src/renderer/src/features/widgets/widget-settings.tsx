import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ReactNode } from "react";
import {
    COINS,
    defaultWidget,
    listOptions,
    validPingHost,
    WIDGET_CHOICES,
} from "../../../../shared/widgets";
import type {
    ClockStyle,
    NoteSize,
    Widget,
    WidgetState,
    WidgetType,
} from "../../../../shared/widgets";
import { sampleState } from "./samples";
import { drawWidget } from "./draw-widget";
import type { WidgetLook } from "./draw-widget";
import "./widgets.css";

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <div className="field">
            {label}
            <div className="behavior-selector" role="group" aria-label={label}>
                {options.map((option) => (
                    <button
                        key={option.value}
                        className={value === option.value ? "active" : ""}
                        aria-pressed={value === option.value}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Switch({
    label,
    on,
    onChange,
}: {
    label: string;
    on: boolean;
    onChange: (on: boolean) => void;
}) {
    return (
        <div className="script-mode">
            <span>{label}</span>
            <button
                type="button"
                role="switch"
                aria-label={label}
                aria-checked={on}
                className={`toggle ${on ? "on" : ""}`}
                onClick={() => onChange(!on)}
            >
                <span />
            </button>
        </div>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="field">
            {label}
            <input
                type="number"
                aria-label={label}
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
            />
        </label>
    );
}

/** One style, drawn live small, to pick by looking at it. */
function StyleChoice({
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
function StylePicker({
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

function timeZones(): string[] {
    try {
        return Intl.supportedValuesOf("timeZone");
    } catch {
        return ["UTC"];
    }
}

/**
 * The settings of one widget, which change with its type. Every change is
 * clamped to what the profile accepts, so saving never trips over a number.
 */
export function WidgetSettings({
    widget,
    look,
    onChange,
}: {
    widget: Widget;
    look: WidgetLook;
    onChange: (widget: Widget) => void;
}) {
    const zones = useMemo(() => timeZones(), []);
    const typeField = (
        <label className="field">
            Widget
            <select
                aria-label="Widget type"
                value={widget.type}
                onChange={(event) => onChange(defaultWidget(event.target.value as WidgetType))}
            >
                {WIDGET_CHOICES.map((choice) => (
                    <option key={choice.type} value={choice.type}>
                        {choice.label}
                    </option>
                ))}
            </select>
        </label>
    );
    let fields: ReactNode;
    let hint = "";
    switch (widget.type) {
        case "clock": {
            const styles: { value: ClockStyle; label: string }[] = [
                { value: "digital", label: "Digital" },
                { value: "analog", label: "Analog" },
                { value: "minimal", label: "Minimal" },
            ];
            fields = (
                <>
                    <div className="field">
                        Style
                        <div className="widget-styles" role="group" aria-label="Clock style">
                            {styles.map((style) => (
                                <StyleChoice
                                    key={style.value}
                                    widget={{ ...widget, style: style.value }}
                                    look={look}
                                    active={widget.style === style.value}
                                    label={style.label}
                                    onPick={() => onChange({ ...widget, style: style.value })}
                                />
                            ))}
                        </div>
                    </div>
                    <Segmented
                        label="Format"
                        value={widget.hour12 ? "12" : "24"}
                        options={[
                            { value: "24", label: "24-hour" },
                            { value: "12", label: "12-hour" },
                        ]}
                        onChange={(value) => onChange({ ...widget, hour12: value === "12" })}
                    />
                    <Switch
                        label="Show seconds"
                        on={widget.seconds}
                        onChange={(seconds) => onChange({ ...widget, seconds })}
                    />
                    {widget.style === "digital" && (
                        <Switch
                            label="Show date"
                            on={widget.date}
                            onChange={(date) => onChange({ ...widget, date })}
                        />
                    )}
                    <label className="field">
                        Time zone
                        <select
                            aria-label="Time zone"
                            value={widget.timeZone}
                            onChange={(event) =>
                                onChange({ ...widget, timeZone: event.target.value })
                            }
                        >
                            <option value="">This PC&apos;s time</option>
                            {zones.map((zone) => (
                                <option key={zone} value={zone}>
                                    {zone.replaceAll("_", " ").replaceAll("/", " / ")}
                                </option>
                            ))}
                        </select>
                    </label>
                </>
            );
            if (widget.seconds)
                hint =
                    "Seconds redraw the key every second, which keeps a USB connection a little busier.";
            break;
        }
        case "timer":
            fields = (
                <>
                    <Segmented
                        label="Mode"
                        value={widget.mode}
                        options={[
                            { value: "stopwatch", label: "Stopwatch" },
                            { value: "countdown", label: "Countdown" },
                        ]}
                        onChange={(mode) => onChange({ ...widget, mode })}
                    />
                    {widget.mode === "countdown" && (
                        <Switch
                            label="Set time on the deck"
                            on={widget.adjustable === true}
                            onChange={(adjustable) => onChange({ ...widget, adjustable })}
                        />
                    )}
                    {widget.mode === "countdown" && (
                        <Switch
                            label="Sound when it ends"
                            on={widget.sound !== false}
                            onChange={(sound) => onChange({ ...widget, sound })}
                        />
                    )}
                    {widget.mode === "countdown" && (
                        <div className="widget-row">
                            <NumberField
                                label="Minutes"
                                value={Math.floor(widget.seconds / 60)}
                                min={0}
                                max={1439}
                                onChange={(minutes) =>
                                    onChange({
                                        ...widget,
                                        seconds: clamp(
                                            minutes * 60 + (widget.seconds % 60),
                                            1,
                                            86_399,
                                        ),
                                    })
                                }
                            />
                            <NumberField
                                label="Seconds"
                                value={widget.seconds % 60}
                                min={0}
                                max={59}
                                onChange={(seconds) =>
                                    onChange({
                                        ...widget,
                                        seconds: clamp(
                                            Math.floor(widget.seconds / 60) * 60 + seconds,
                                            1,
                                            86_399,
                                        ),
                                    })
                                }
                            />
                        </div>
                    )}
                </>
            );
            hint =
                (widget.mode === "countdown" && widget.adjustable
                    ? "Swipe up or down on the key to set the time: 10 seconds a step up to a " +
                      "minute, then minutes up to an hour, then 5 minutes up to 3 hours. Tap " +
                      "starts or pauses; hold resets."
                    : "Tap the key to start or pause. Hold it to reset.") +
                (widget.mode === "countdown" && widget.sound !== false
                    ? " When it ends, a soft kalimba plays on this PC until you tap the key."
                    : "");
            break;
        case "pomodoro":
            fields = (
                <div className="widget-row">
                    <NumberField
                        label="Focus minutes"
                        value={widget.focus}
                        min={1}
                        max={180}
                        onChange={(focus) => onChange({ ...widget, focus })}
                    />
                    <NumberField
                        label="Break minutes"
                        value={widget.rest}
                        min={1}
                        max={180}
                        onChange={(rest) => onChange({ ...widget, rest })}
                    />
                </div>
            );
            hint = "Tap to start or pause. Hold to skip to the next focus or break.";
            break;
        case "countdown":
            fields = (
                <>
                    <label className="field">
                        Title
                        <input
                            aria-label="Countdown title"
                            maxLength={24}
                            placeholder="Optional"
                            value={widget.title}
                            onChange={(event) => onChange({ ...widget, title: event.target.value })}
                        />
                    </label>
                    <label className="field">
                        Date
                        <input
                            type="date"
                            aria-label="Countdown date"
                            value={widget.date}
                            onChange={(event) =>
                                event.target.value &&
                                onChange({ ...widget, date: event.target.value })
                            }
                        />
                    </label>
                </>
            );
            break;
        case "counter":
            fields = (
                <div className="widget-row">
                    <NumberField
                        label="Start at"
                        value={widget.start}
                        min={-999_999}
                        max={999_999}
                        onChange={(start) => onChange({ ...widget, start })}
                    />
                    <NumberField
                        label="Step"
                        value={widget.step}
                        min={1}
                        max={1000}
                        onChange={(step) => onChange({ ...widget, step })}
                    />
                </div>
            );
            hint = "Tap to count. Hold to go back to the start.";
            break;
        case "ping": {
            const valid = validPingHost(widget.host);
            fields = (
                <>
                    <label className="field">
                        Host
                        <input
                            aria-label="Ping host"
                            placeholder="google.com or 192.168.1.1"
                            maxLength={253}
                            value={widget.host}
                            onChange={(event) =>
                                onChange({ ...widget, host: event.target.value.trim() })
                            }
                        />
                    </label>
                    {!valid && (
                        <p className="firmware-error">
                            Use a name like google.com or an address like 192.168.1.1.
                        </p>
                    )}
                    <label className="field">
                        Ping every
                        <select
                            aria-label="Ping interval"
                            value={widget.interval}
                            onChange={(event) =>
                                onChange({ ...widget, interval: Number(event.target.value) })
                            }
                        >
                            {[5, 10, 30, 60].map((seconds) => (
                                <option key={seconds} value={seconds}>
                                    {seconds < 60 ? `${seconds} seconds` : "1 minute"}
                                </option>
                            ))}
                        </select>
                    </label>
                </>
            );
            hint =
                "How long the host takes to answer. Green under 100 ms, amber under 250 ms, " +
                "red when slower or there is no reply. Tap to ping now.";
            break;
        }
        case "note": {
            const sizes: { value: NoteSize; label: string }[] = [
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
            ];
            fields = (
                <>
                    <label className="field">
                        Text
                        <textarea
                            aria-label="Note text"
                            maxLength={120}
                            rows={3}
                            value={widget.text}
                            onChange={(event) => onChange({ ...widget, text: event.target.value })}
                        />
                    </label>
                    {!widget.text.trim() && (
                        <p className="firmware-error">Write something to show.</p>
                    )}
                    <Segmented
                        label="Size"
                        value={widget.size}
                        options={sizes}
                        onChange={(size) => onChange({ ...widget, size })}
                    />
                </>
            );
            break;
        }
        case "volume":
            fields = (
                <StylePicker
                    label="Style"
                    widget={widget}
                    look={look}
                    field="style"
                    options={[
                        { value: "arc", label: "Arc" },
                        { value: "bar", label: "Bar" },
                    ]}
                    onChange={onChange}
                />
            );
            hint =
                "Swipe up or down on the key to set the PC's volume; it follows your finger. " +
                "Tap to mute or unmute.";
            break;
        case "mic":
            hint =
                "Shows whether Windows has your microphone muted: red and struck through when it is. " +
                "Tap to mute or unmute.";
            break;
        case "media":
            fields = (
                <StylePicker
                    label="Style"
                    widget={widget}
                    look={look}
                    field="style"
                    options={[
                        { value: "cover", label: "Cover" },
                        { value: "card", label: "Card" },
                    ]}
                    onChange={onChange}
                />
            );
            hint =
                "What is playing in any app Windows knows of: Spotify, a browser, a game. " +
                "Tap to play or pause; hold for the next track.";
            break;
        case "system":
            fields = (
                <>
                    <StylePicker
                        label="Style"
                        widget={widget}
                        look={look}
                        field="style"
                        options={[
                            { value: "graph", label: "Graph" },
                            { value: "rings", label: "Rings" },
                        ]}
                        onChange={onChange}
                    />
                    <Segmented
                        label="Show"
                        value={widget.show}
                        options={[
                            { value: "cpu", label: "CPU" },
                            { value: "ram", label: "Memory" },
                            { value: "both", label: "Both" },
                        ]}
                        onChange={(show) => onChange({ ...widget, show })}
                    />
                    <Segmented
                        label="Update every"
                        value={String(widget.interval)}
                        options={[
                            { value: "1", label: "1 s" },
                            { value: "2", label: "2 s" },
                            { value: "5", label: "5 s" },
                        ]}
                        onChange={(interval) => onChange({ ...widget, interval: Number(interval) })}
                    />
                </>
            );
            hint = "Tap to open Task Manager.";
            break;
        case "crypto":
            fields = (
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
            hint =
                "Live prices in US dollars, a new one each second while it trades (Binance's " +
                "public market feed). The chart is the last 24 hours; the ticker's arrow is the " +
                "move over the last minute. Tap to check now.";
            break;
        case "dice": {
            const options = listOptions(widget.options);
            fields = (
                <>
                    <Segmented
                        label="Roll"
                        value={widget.mode}
                        options={[
                            { value: "die", label: "Dice" },
                            { value: "coin", label: "Coin" },
                            { value: "yesno", label: "Yes / No" },
                            { value: "list", label: "List" },
                        ]}
                        onChange={(mode) => onChange({ ...widget, mode })}
                    />
                    {widget.mode === "list" && (
                        <label className="field">
                            Choices
                            <input
                                aria-label="Choices"
                                maxLength={120}
                                placeholder="Pizza, Burger, Sushi"
                                value={widget.options}
                                onChange={(event) =>
                                    onChange({ ...widget, options: event.target.value })
                                }
                            />
                        </label>
                    )}
                    {widget.mode === "list" && options.length < 2 && (
                        <p className="firmware-error">
                            Give at least two choices, with commas between.
                        </p>
                    )}
                </>
            );
            hint =
                widget.mode === "list"
                    ? "Up to 8 choices of 14 characters. Tap to roll."
                    : "Tap to roll.";
            break;
        }
    }
    return (
        <div className="widget-settings">
            {typeField}
            {fields}
            {hint && <p className="widget-hint">{hint}</p>}
        </div>
    );
}
