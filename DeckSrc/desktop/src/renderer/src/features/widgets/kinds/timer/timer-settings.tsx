import type { ReactNode } from "react";
import type { TimerWidget } from "../../../../../../shared/widgets/timer";
import { clamp, NumberField, Segmented, Switch } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

export function timerSettings({ widget, onChange }: SettingsProps<TimerWidget>): ReactNode {
    return (
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
                                seconds: clamp(minutes * 60 + (widget.seconds % 60), 1, 86_399),
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
}

export function timerHint(widget: TimerWidget): string {
    return (
        (widget.mode === "countdown" && widget.adjustable
            ? "Swipe up or down on the key to set the time: 10 seconds a step up to a " +
              "minute, then minutes up to an hour, then 5 minutes up to 3 hours. Tap " +
              "starts or pauses; hold resets."
            : "Tap the key to start or pause. Hold it to reset.") +
        (widget.mode === "countdown" && widget.sound !== false
            ? " When it ends, a soft kalimba plays on this PC until you tap the key."
            : "")
    );
}
