/**
 * A key that cycles through options - Discord's microphone, its output: the
 * option chosen and where it is among them, which its face shows (the name,
 * a dot for each), and a tap moving to the next (nextChoice). Any widget can
 * be one: its state's `choice`, drawn by the renderer's choice face.
 */
export interface Choice {
    /** Whether the options can be had now; false draws the key disabled. */
    reachable: boolean;
    /** The option chosen, as it is called. */
    name: string;
    /** Its place among them, from 0; -1 when none of them is chosen. */
    index: number;
    count: number;
}

/** The option after the one with id `current`, round again after the last; the first when none is. */
export function nextChoice<T extends { id: string }>(
    options: readonly T[],
    current: string,
): T | undefined {
    if (!options.length) return undefined;
    return options[(options.findIndex((option) => option.id === current) + 1) % options.length];
}

/** An option list as a key shows it: the chosen one's name and place, `reachable` or not. */
export function choiceOf(
    options: readonly { id: string; name: string }[],
    current: string,
    reachable: boolean,
): Choice {
    const index = options.findIndex((option) => option.id === current);
    return { reachable, name: options[index]?.name ?? "", index, count: options.length };
}
