import { useEffect, useState } from "react";
import { isWidgetKey, keyAddress } from "../../../../shared/config";
import type { DeckConfig } from "../../../../shared/config";
import { countdownEnd } from "../../../../shared/widgets";
import type { WidgetStates } from "../../../../shared/widgets";
import kalimba from "../../assets/sounds/kalimba.wav";

// One cycle of the kalimba, 2 s long, its tail faded to silence: looped, it
// plays every 2 s.
let sound: HTMLAudioElement | null = null;
function ring(on: boolean): void {
    if (on) {
        sound ??= Object.assign(new Audio(kalimba), { loop: true });
        if (sound.paused) void sound.play().catch(() => {});
    } else if (sound && !sound.paused) {
        sound.pause();
        sound.currentTime = 0;
    }
}

// A countdown that ended well before Decky started does not ring on start.
const LATE_MS = 60_000;

/**
 * Ring while any countdown with its sound on has ended, on any page, until a
 * tap on its key sets it back. The window lives on in the tray, so it rings
 * with Decky hidden too.
 */
export function useCountdownAlarms(config: DeckConfig, states: WidgetStates): void {
    const [opened] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const at = Date.now();
        const ends: number[] = [];
        for (const page of config.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                if (key.action.kind !== "widget" || !isWidgetKey(page, Number(cell))) continue;
                const end = countdownEnd(
                    key.action.widget,
                    states[keyAddress(page.id, Number(cell))],
                );
                if (end !== null && end >= opened - LATE_MS) ends.push(end);
            }
        ring(ends.some((end) => end <= at));
        const next = Math.min(...ends.filter((end) => end > at));
        if (!Number.isFinite(next)) return;
        const timer = setTimeout(() => setNow(Date.now()), next - at + 20);
        return () => clearTimeout(timer);
    }, [config, states, now, opened]);
    useEffect(() => () => ring(false), []);
}
