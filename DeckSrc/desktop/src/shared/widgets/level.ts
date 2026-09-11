import type { WidgetKind } from "./widget-kind";

/**
 * A sound level the deck turns under the finger, as an arc or a bar: the
 * PC's volume, the microphone's. Each widget type showing one is made by
 * levelKind, told its name and the device it turns.
 */
export type LevelStyle = "arc" | "bar";
/** The widget types that show a level. */
export type LevelType = "volume" | "mic";
export type LevelWidget<T extends LevelType = LevelType> = { type: T; style: LevelStyle };

/** Windows' default speaker and microphone. */
export type SoundDevice = "speaker" | "microphone";

/** What a level widget type says of itself in the widget picker. */
interface LevelName<T extends LevelType> {
    type: T;
    label: string;
    icon: string;
    words: string;
}

export function levelKind<T extends LevelType>({
    type,
    label,
    icon,
    words,
}: LevelName<T>): WidgetKind<LevelWidget<T>> {
    return {
        type,
        label,
        icon,
        words,
        defaults: () => ({ type, style: "arc" }),
        valid: (w) => w.style === "arc" || w.style === "bar",
        designs: (w) => (["arc", "bar"] as const).map((style) => ({ ...w, style })),
        deckTurned: () => "dial",
        fingerTurns: () => true,
    };
}
