import { ProgramPicker } from "./program-picker";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { FolderOpen, Keyboard } from "lucide-react";
import type { Step } from "../../../../shared/config";
import { inPool, nextFreeHotkey, normalizeHotkey } from "../../../../shared/hotkey-pool";
/** Fields for each kind of step, each taking its step as that kind. */
type FieldsByKind = { [K in Step["kind"]]: (step: Extract<Step, { kind: K }>) => ReactNode };
export function StepFields({
    step,
    onChange,
    onError,
    compact = false,
    taken = [],
}: {
    step: Step;
    onChange: (step: Step) => void;
    onError: (message: string) => void;
    compact?: boolean;
    /** Hotkeys used everywhere else on the deck, for auto-assign to avoid. */
    taken?: string[];
}) {
    const input = useRef<HTMLInputElement>(null);
    const [recording, setRecording] = useState(false);
    const browse = async (kind: "program" | "script"): Promise<void> => {
        try {
            const path = await window.deck.pickTarget(kind);
            if (path) onChange({ kind, path });
        } catch (error) {
            onError(String(error));
        }
    };
    // Built here rather than beside the component: the hotkey fields use its
    // ref, and React's rules forbid handing a ref to a function while rendering.
    // Each is drawn in place, so a step that changes kind keeps this state.
    const fields: FieldsByKind = {
        program: (step) => <ProgramPicker step={step} onChange={onChange} onError={onError} />,
        hotkey: (step) => {
            const auto = step.auto === true;
            const setAuto = (on: boolean): void => {
                if (!on) {
                    // The assigned combination stays as a starting point, so turning
                    // auto off never leaves the key with nothing to send.
                    setRecording(false);
                    onChange({ ...step, auto: false });
                    return;
                }
                // Keep what the key already has if auto-assign could have chosen it
                // and nobody else is using it; re-toggling must not move a key the
                // user has already set up in another application.
                const used = new Set(taken.map(normalizeHotkey));
                const keep =
                    step.keys !== "" && inPool(step.keys) && !used.has(normalizeHotkey(step.keys));
                const keys = keep ? step.keys : nextFreeHotkey(taken);
                if (keys === null) {
                    onError("All 96 automatic keys (F13–F24) are in use. Choose one yourself.");
                    return;
                }
                onChange({ ...step, keys, auto: true });
            };
            return (
                <div className="hotkey-fields">
                    <div className="script-mode hotkey-mode">
                        <span>Auto-assign key</span>
                        <button
                            type="button"
                            role="switch"
                            aria-label="Auto-assign key"
                            aria-checked={auto}
                            className={`toggle ${auto ? "on" : ""}`}
                            onClick={() => setAuto(!auto)}
                        >
                            <span />
                        </button>
                    </div>
                    {auto ? (
                        // The combination itself is not shown: it is the app's to
                        // choose and the user never needs to read it. Discord and
                        // OBS both record a shortcut by listening for it, so the way
                        // to bind this key is to start recording there and press Test.
                        !compact && (
                            <p className="script-detached-note">
                                A free key is reserved for this button. To bind it, start recording
                                the shortcut in the other app, then press Test.
                            </p>
                        )
                    ) : (
                        <div className={`control-field ${recording ? "recording" : ""}`}>
                            <input
                                ref={input}
                                aria-label={compact ? "Step hotkey" : "Key combination"}
                                value={recording ? "Press a shortcut…" : step.keys}
                                placeholder="Ctrl + Shift + M"
                                onChange={(e) => {
                                    if (!recording) onChange({ ...step, keys: e.target.value });
                                }}
                                onBlur={() => setRecording(false)}
                                onKeyDown={(e) => {
                                    if (!recording) return;
                                    e.preventDefault();
                                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
                                    if (e.metaKey) {
                                        onError("Windows-key combinations are not supported yet.");
                                        setRecording(false);
                                        return;
                                    }
                                    onChange({
                                        ...step,
                                        keys: [
                                            e.ctrlKey ? "Ctrl" : "",
                                            e.altKey ? "Alt" : "",
                                            e.shiftKey ? "Shift" : "",
                                            e.key === " "
                                                ? "Space"
                                                : e.key.length === 1
                                                  ? e.key.toUpperCase()
                                                  : e.key,
                                        ]
                                            .filter(Boolean)
                                            .join("+"),
                                    });
                                    setRecording(false);
                                }}
                            />
                            <button
                                title="Record shortcut"
                                aria-label="Record shortcut"
                                onClick={() => {
                                    setRecording(true);
                                    input.current?.focus();
                                }}
                            >
                                <Keyboard size={18} />
                            </button>
                        </div>
                    )}
                </div>
            );
        },
        website: (step) => (
            <input
                className="standalone-field"
                aria-label="Website URL"
                type="url"
                placeholder="https://example.com"
                value={step.url}
                onChange={(e) => onChange({ ...step, url: e.target.value })}
            />
        ),
        delay: (step) => (
            <div className="control-field delay-field">
                <input
                    aria-label="Wait milliseconds"
                    type="number"
                    min={50}
                    max={30000}
                    step={50}
                    value={step.ms}
                    onChange={(e) => onChange({ ...step, ms: Number(e.target.value) })}
                />
                <span>ms</span>
            </div>
        ),
        script: (step) => (
            <div className="script-fields">
                <div className="control-field">
                    <input
                        aria-label="PowerShell script"
                        placeholder="Choose a .ps1"
                        value={step.path}
                        onChange={(e) => onChange({ ...step, path: e.target.value })}
                    />
                    <button
                        title="Browse files"
                        aria-label="Browse files"
                        onClick={() => void browse(step.kind)}
                    >
                        <FolderOpen size={18} />
                    </button>
                </div>
                <div className="script-mode">
                    <span>Run in background</span>
                    <button
                        type="button"
                        role="switch"
                        aria-label="Run in background"
                        aria-checked={step.background !== false}
                        className={`toggle ${step.background !== false ? "on" : ""}`}
                        onClick={() => onChange({ ...step, background: step.background === false })}
                    >
                        <span />
                    </button>
                </div>
                <div className="script-mode">
                    <span>Wait for completion</span>
                    <button
                        type="button"
                        role="switch"
                        aria-label="Wait for completion"
                        aria-checked={step.wait !== false}
                        className={`toggle ${step.wait !== false ? "on" : ""}`}
                        onClick={() => onChange({ ...step, wait: step.wait === false })}
                    >
                        <span />
                    </button>
                </div>
                {step.wait !== false ? (
                    <label className="script-timeout">
                        Timeout (seconds)
                        <input
                            aria-label="Script timeout seconds"
                            type="number"
                            min={0}
                            max={2147483}
                            step={1}
                            placeholder="Unlimited"
                            value={
                                (step.timeoutMs ?? 30000) > 0
                                    ? (step.timeoutMs ?? 30000) / 1000
                                    : ""
                            }
                            onChange={(event) =>
                                onChange({
                                    ...step,
                                    timeoutMs: event.target.value
                                        ? Number(event.target.value) * 1000
                                        : 0,
                                })
                            }
                        />
                    </label>
                ) : (
                    <p className="script-detached-note">
                        Runs independently. Other actions continue immediately.
                    </p>
                )}
            </div>
        ),
    };
    const draw = fields[step.kind] as (step: Step) => ReactNode;
    return draw(step);
}
