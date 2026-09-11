import type { Action, Step } from "../../../../shared/config";
import { nextFreeHotkey } from "../../../../shared/hotkey-pool";
import { defaultWidget, WIDGET_CHOICES } from "../../../../shared/widgets";
export const ACTION_LABELS: Record<Action["kind"], string> = {
    hotkey: "Hotkey",
    program: "Launch program",
    website: "Open website",
    script: "Run script",
    macro: "Macro",
    page: "Open page",
    delay: "Delay",
    widget: "Widget",
};
/**
 * A fresh step of one kind.
 *
 * @param taken Hotkeys already used elsewhere on the deck. A new hotkey starts
 *              auto-assigned, so it needs to know which combinations are gone.
 */
export function defaultStep(kind: Step["kind"], taken: string[] = []): Step {
    switch (kind) {
        case "hotkey":
            // Empty only once all 96 are in use; the editor then asks for one
            // by hand rather than saving a key that does nothing.
            return { kind, keys: nextFreeHotkey(taken) ?? "", auto: true };
        case "program":
            return { kind, path: "" };
        case "script":
            return { kind, path: "", background: true, wait: true, timeoutMs: 30000 };
        case "website":
            return { kind, url: "https://" };
        case "delay":
            return { kind, ms: 500 };
    }
}
export function defaultAction(kind: Action["kind"], pageId = "home", taken: string[] = []): Action {
    if (kind === "macro") return { kind, steps: [{ kind: "delay", ms: 500 }] };
    if (kind === "page") return { kind, pageId };
    if (kind === "widget") return { kind, widget: defaultWidget("clock") };
    return defaultStep(kind, taken);
}
export function actionSummary(action: Action): string {
    switch (action.kind) {
        case "hotkey":
            return action.keys;
        case "program":
        case "script":
            return action.path.split(/[\\/]/).pop() || "Choose a file";
        case "website":
            return action.url.replace(/^https?:\/\//, "");
        case "macro":
            return `${action.steps.length} steps`;
        case "page":
            return "Open page";
        case "delay":
            return `${action.ms} ms`;
        case "widget":
            return WIDGET_CHOICES.find((choice) => choice.type === action.widget.type)!.label;
    }
}
