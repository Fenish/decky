import type { WidgetKind } from "./widget-kind";

/** CPU and memory in use over the last minute, sampled every `interval` s. */
export type SystemWidget = {
    type: "system";
    show: "cpu" | "ram" | "both";
    style: "graph" | "rings";
    interval: number;
};

export const systemKind: WidgetKind<SystemWidget> = {
    type: "system",
    label: "System",
    icon: "Cpu",
    words: "cpu ram memory task manager",
    defaults: () => ({ type: "system", show: "both", style: "graph", interval: 2 }),
    valid: (w) =>
        ["cpu", "ram", "both"].includes(String(w.show)) &&
        (w.style === "graph" || w.style === "rings") &&
        [1, 2, 5].includes(Number(w.interval)),
};
