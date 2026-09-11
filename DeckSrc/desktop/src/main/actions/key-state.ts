import type { KeyLocation } from "../../shared/key-layout";
import { keyAddress } from "../../shared/config";
import type { DeckConfig, KeyConfig, KeyStates } from "../../shared/config";
/**
 * Toggle keys' states, for this session. A key's own toggle flips when its
 * action succeeds; a key with an app's control follows the app instead
 * (AppControls sets it).
 */
export class KeyStateStore {
    private states: KeyStates = {};
    snapshot(): KeyStates {
        return { ...this.states };
    }
    complete(pageId: string, cell: number, key: KeyConfig, succeeded: boolean): boolean {
        if (!succeeded || key.behavior !== "toggle") return false;
        // A page opens; an app's control follows the app.
        if (key.action.kind === "page" || key.action.kind === "app") return false;
        const address = keyAddress(pageId, cell);
        this.states[address] = !this.states[address];
        return true;
    }
    /** A key's state as its app says; whether that changed it. */
    follow(address: string, on: boolean): boolean {
        if ((this.states[address] ?? false) === on) return false;
        if (on) this.states[address] = true;
        else delete this.states[address];
        return true;
    }
    move(snapshot: KeyStates, from: KeyLocation, to: KeyLocation, swapped: boolean): void {
        const source = keyAddress(from.pageId, from.cell);
        const target = keyAddress(to.pageId, to.cell);
        if (source === target) return;
        if (snapshot[source] !== undefined) this.states[target] = snapshot[source];
        else delete this.states[target];
        if (swapped && snapshot[target] !== undefined) this.states[source] = snapshot[target];
        else delete this.states[source];
    }
    reconcile(previous: DeckConfig, next: DeckConfig): void {
        for (const page of previous.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                const replacement = next.pages.find((p) => p.id === page.id)?.keys[cell];
                if (
                    !replacement ||
                    replacement.behavior !== "toggle" ||
                    JSON.stringify(replacement.action) !== JSON.stringify(key.action)
                )
                    delete this.states[keyAddress(page.id, Number(cell))];
            }
    }
}
