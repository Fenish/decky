import type { IntegrationHealth } from "../integrations/integration";
import type { WidgetState } from "../widgets";
import type { WidgetKind } from "./widget-kind";

/**
 * OBS Studio's outputs as widgets: whether it records or streams, as OBS
 * says (src/main/integrations/obs/). Each output is a widget type made by
 * obsKind. A touch counts down OBS_ARM_S seconds before OBS is asked to
 * start or stop it; another touch meanwhile calls it off.
 */
export type ObsOutput = "record" | "stream";
/** The widget types that show an OBS output, and the output each shows. */
export const OBS_TYPES = { "obs-record": "record", "obs-stream": "stream" } as const;
export type ObsType = keyof typeof OBS_TYPES;
export type ObsWidget<T extends ObsType = ObsType> = { type: T };

export const OBS_ARM_S = 5;

/** How Decky reaches OBS: an app's standing (shared/integrations). */
export type ObsHealth = IntegrationHealth;

/** What OBS says of an output. */
export interface ObsState {
    health: ObsHealth;
    active: boolean;
    paused?: boolean;
    reconnecting?: boolean;
    /** How long it has run, in ms, as of `at` (epoch ms). */
    ms?: number;
    at?: number;
}

/** How long an output has run by `now`, in ms: its clock stops while paused. */
export function obsRunTime(obs: Omit<ObsState, "health">, now: number): number {
    if (!obs.active) return 0;
    const ms = obs.ms ?? 0;
    return obs.paused || obs.at === undefined ? ms : ms + Math.max(0, now - obs.at);
}

/** Whole seconds a touch's countdown has left at `now`; null with none. */
export function armedSeconds(state: WidgetState | undefined, now: number): number | null {
    const until = state?.arming?.until;
    return until === undefined || until <= now ? null : Math.ceil((until - now) / 1000);
}

/** What an OBS widget type says of itself in the widget picker. */
interface ObsName<T extends ObsType> {
    type: T;
    label: string;
    icon: string;
    words: string;
}

export function obsKind<T extends ObsType>({
    type,
    label,
    icon,
    words,
}: ObsName<T>): WidgetKind<ObsWidget<T>> {
    return {
        type,
        label,
        icon,
        words,
        group: "obs",
        defaults: () => ({ type }),
        valid: () => true,
        // Each second of a countdown, and of the time it has run.
        nextChange: (_widget, state, now) => {
            const until = state?.arming?.until;
            if (until !== undefined && until > now) return (until - now) % 1000 || 1000;
            const obs = state?.obs;
            if (!obs?.active || obs.paused) return null;
            return 1000 - (obsRunTime(obs, now) % 1000);
        },
    };
}

export const obsRecordKind = obsKind({
    type: "obs-record",
    label: "Recording",
    icon: "Circle",
    words: "obs record recording capture video rec",
});

export const obsStreamKind = obsKind({
    type: "obs-stream",
    label: "Streaming",
    icon: "Radio",
    words: "obs stream streaming live twitch youtube broadcast",
});
