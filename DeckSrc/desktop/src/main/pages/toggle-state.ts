import { BACK_CELL, keyAddress } from "../../shared/config";
import type { DeckPage, KeyStates } from "../../shared/config";

export function pageStateMask(page: DeckPage, states: KeyStates): number {
    let mask = 0;
    for (let cell = 0; cell < 15; cell++) {
        if (cell === BACK_CELL && page.parentId) continue;
        if (page.keys[cell]?.behavior === "toggle" && states[keyAddress(page.id, cell)])
            mask |= 1 << cell;
    }
    return mask;
}
