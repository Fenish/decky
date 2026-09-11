export const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

export function Segmented<T extends string>({
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

export function Switch({
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

export function NumberField({
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
