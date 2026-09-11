import { text } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/** A die, a coin, yes or no, or a pick from `options` (comma separated). */
export type DiceWidget = {
    type: "dice";
    mode: "die" | "coin" | "yesno" | "list";
    options: string;
};

/** A dice list's options: comma or line separated, blanks dropped, at most 8 of 14 characters. */
export function listOptions(options: string): string[] {
    return options
        .split(/[,\n]/)
        .map((option) => option.trim().slice(0, 14))
        .filter(Boolean)
        .slice(0, 8);
}

/** What a dice widget can land on, in order. */
export function diceFaces(widget: DiceWidget): string[] {
    switch (widget.mode) {
        case "die":
            return ["1", "2", "3", "4", "5", "6"];
        case "coin":
            return ["Heads", "Tails"];
        case "yesno":
            return ["Yes", "No"];
        case "list":
            return listOptions(widget.options);
    }
}

/**
 * A dice drum's labels, as indexes into its faces: the faces over and over,
 * so a roll can spin a few turns and land anywhere.
 */
export function diceLabels(widget: DiceWidget): number[] {
    const faces = diceFaces(widget).length;
    return Array.from({ length: Math.floor(120 / faces) * faces }, (_, i) => i % faces);
}

export const diceKind: WidgetKind<DiceWidget> = {
    type: "dice",
    label: "Dice",
    icon: "Dices",
    words: "die roll random coin decide",
    defaults: () => ({ type: "dice", mode: "die", options: "Pizza, Burger, Sushi" }),
    valid: (w) =>
        ["die", "coin", "yesno", "list"].includes(String(w.mode)) &&
        text(w.options, 120, true) &&
        (w.mode !== "list" || listOptions(String(w.options)).length >= 2),
    // What it throws, which a hold on its key flips through; a list only
    // where there is something to choose from.
    designs: (w) =>
        (["die", "coin", "yesno", "list"] as const)
            .filter((mode) => mode !== "list" || listOptions(w.options).length >= 2)
            .map((mode) => ({ ...w, mode })),
    // A die the deck throws; a coin, yes or no, or a list spins on a drum.
    deckTurned: (widget) => (widget.mode === "die" ? "die" : "drum"),
    // A die is not turned but thrown, by any touch.
    fingerTurns: (widget) => widget.mode !== "die",
};
