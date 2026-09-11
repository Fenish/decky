/*---------------------------------------------------------------
 * Taps in a row on a key: a double or a triple tap. After each tap on a
 * widget that tells taps apart, the key waits TAP_GAP_MS for another before
 * acting on how many came; at the most it knows, it acts at once. A widget
 * that tells none apart acts on its tap straight away.
 *--------------------------------------------------------------*/

import { TAPS } from "./actions/widget-action";
import type { Gesture } from "./actions/widget-action";
import { HOLD_MS, TAP_GAP_MS } from "./widget-state";

interface Run {
    count: number;
    /** When its last tap lifted. */
    lifted: number;
    /** Until it acts; null while a finger is down on the key. */
    timer: ReturnType<typeof setTimeout> | null;
}

export class TapRuns {
    private readonly runs = new Map<string, Run>();

    /** A finger landed on the key: a run there waits for it to lift. */
    pressed(address: string): void {
        const run = this.runs.get(address);
        if (!run?.timer) return;
        clearTimeout(run.timer);
        run.timer = null;
    }

    /** The press was a hold or a swipe: the taps just before it are dropped. */
    broken(address: string): void {
        const run = this.runs.get(address);
        if (run?.timer) clearTimeout(run.timer);
        this.runs.delete(address);
    }

    /**
     * A tap lifted. `known` is how many taps in a row its widget tells apart
     * (1 for none); `act` gets the gesture when the run is over.
     */
    tapped(address: string, known: number, act: (gesture: Gesture) => void): void {
        const now = Date.now();
        const run = this.runs.get(address);
        this.broken(address);
        // Only a tap soon after goes on with a run, so a press never let go
        // (the deck gone) leaves none behind.
        const fresh = run !== undefined && now - run.lifted <= TAP_GAP_MS + HOLD_MS;
        const count = (fresh ? run.count : 0) + 1;
        if (count >= known) {
            act(TAPS[known - 1]!);
            return;
        }
        const next: Run = { count, lifted: now, timer: null };
        next.timer = setTimeout(() => {
            this.runs.delete(address);
            act(TAPS[count - 1]!);
        }, TAP_GAP_MS);
        this.runs.set(address, next);
    }
}
