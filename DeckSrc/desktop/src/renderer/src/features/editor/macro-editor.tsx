import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import type { Step } from "../../../../shared/config";
import { KeyIcon } from "../../components/key-icon";
import { defaultStep, STEP_KINDS } from "./actions";
import { StepFields } from "./step-fields";
/** Every kind of step, in STEP_KINDS' order. */
const TYPES = Object.keys(STEP_KINDS) as Step["kind"][];
export function MacroEditor({
    steps,
    reservedHotkeys,
    onChange,
    onError,
}: {
    steps: Step[];
    /** Hotkeys every other key already uses. */
    reservedHotkeys: string[];
    onChange: (steps: Step[]) => void;
    onError: (message: string) => void;
}) {
    const [adding, setAdding] = useState(false);
    // A step must also avoid the hotkeys of its siblings in this macro, which
    // are not saved yet and so are not in the deck-wide list.
    const takenBy = (except: number | null): string[] => [
        ...reservedHotkeys,
        ...steps.flatMap((step, i) => (i !== except && step.kind === "hotkey" ? [step.keys] : [])),
    ];
    const move = (from: number, to: number): void => {
        if (from === to || from < 0 || from >= steps.length || to < 0 || to >= steps.length) return;
        const next = [...steps];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item!);
        onChange(next);
    };
    return (
        <div className="macro-sequence">
            {steps.map((step, index) => (
                <div
                    className="sequence-step"
                    key={index}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        const source = Number(e.dataTransfer.getData("decky/macro-step"));
                        if (Number.isInteger(source)) move(source, index);
                    }}
                >
                    <span
                        className="step-grip"
                        draggable
                        onDragStart={(e) =>
                            e.dataTransfer.setData("decky/macro-step", String(index))
                        }
                        title="Drag to reorder"
                    >
                        <GripVertical size={16} />
                    </span>
                    <div className="step-type">
                        <KeyIcon name={STEP_KINDS[step.kind].icon} size={19} />
                        <select
                            aria-label={`Step ${index + 1} type`}
                            value={step.kind}
                            onChange={(e) =>
                                onChange(
                                    steps.map((value, i) =>
                                        i === index
                                            ? defaultStep(
                                                  e.target.value as Step["kind"],
                                                  takenBy(index),
                                              )
                                            : value,
                                    ),
                                )
                            }
                        >
                            {TYPES.map((kind) => (
                                <option value={kind} key={kind}>
                                    {STEP_KINDS[kind].label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <StepFields
                        compact
                        step={step}
                        taken={takenBy(index)}
                        onChange={(next) =>
                            onChange(steps.map((value, i) => (i === index ? next : value)))
                        }
                        onError={onError}
                    />
                    <div className="step-order">
                        <button
                            title="Move step up"
                            aria-label={`Move step ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => move(index, index - 1)}
                        >
                            <ArrowUp size={12} />
                        </button>
                        <button
                            title="Move step down"
                            aria-label={`Move step ${index + 1} down`}
                            disabled={index === steps.length - 1}
                            onClick={() => move(index, index + 1)}
                        >
                            <ArrowDown size={12} />
                        </button>
                    </div>
                    <button
                        className="step-remove"
                        title="Remove step"
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => onChange(steps.filter((_, i) => i !== index))}
                    >
                        <X size={17} />
                    </button>
                </div>
            ))}
            {adding ? (
                <div className="add-step-types">
                    {TYPES.map((kind) => (
                        <button
                            key={kind}
                            onClick={() => {
                                onChange([...steps, defaultStep(kind, takenBy(null))]);
                                setAdding(false);
                            }}
                        >
                            {STEP_KINDS[kind].label}
                        </button>
                    ))}
                </div>
            ) : (
                <button
                    className="add-step"
                    disabled={steps.length >= 32}
                    onClick={() => setAdding(true)}
                >
                    <Plus size={19} />
                    Add step
                </button>
            )}
        </div>
    );
}
