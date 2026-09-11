import type { Action, Step } from "../../../../shared/config";
import { nextFreeHotkey } from "../../../../shared/hotkey-pool";
import { defaultWidget, WIDGET_CHOICES } from "../../../../shared/widgets/registry";
/** What the editor knows of one kind of action. */
export interface ActionKind<A extends Action> {
    /** Its name where it is picked: the picker, the Action type list, a macro's steps. */
    label: string;
    /** What a key with it does, in a few words. */
    title: string;
    /** Its KeyIcon name, in the picker and beside a macro step. */
    icon: string;
    /** Whether its key can be a toggle; a key that opens a page or shows a widget cannot. */
    toggles: boolean;
    /** A fresh one; `taken` are the hotkeys in use, `pageId` the page to open. */
    fresh: (taken: string[], pageId: string) => A;
    /** What it is set to, in a few words. */
    summary: (action: A) => string;
}
/** A kind of step: made fresh from the hotkeys in use alone. */
interface StepKind<S extends Step> extends ActionKind<S> {
    fresh: (taken: string[]) => S;
}
const fileName = (path: string): string => path.split(/[\\/]/).pop() || "Choose a file";
/**
 * Every kind of step, in the order a macro offers them. A kind in the Step
 * union with no entry here does not compile.
 */
export const STEP_KINDS: { [K in Step["kind"]]: StepKind<Extract<Step, { kind: K }>> } = {
    hotkey: {
        label: "Hotkey",
        title: "Hotkey",
        icon: "keyboard",
        toggles: true,
        // Empty only once all 96 are in use; the editor then asks for one
        // by hand rather than saving a key that does nothing.
        fresh: (taken) => ({ kind: "hotkey", keys: nextFreeHotkey(taken) ?? "", auto: true }),
        summary: (step) => step.keys,
    },
    program: {
        label: "Program",
        title: "Launch program",
        icon: "program",
        toggles: true,
        fresh: () => ({ kind: "program", path: "" }),
        summary: (step) => fileName(step.path),
    },
    website: {
        label: "Website",
        title: "Open website",
        icon: "website",
        toggles: true,
        fresh: () => ({ kind: "website", url: "https://" }),
        summary: (step) => step.url.replace(/^https?:\/\//, ""),
    },
    script: {
        label: "Script",
        title: "Run script",
        icon: "script",
        toggles: true,
        fresh: () => ({ kind: "script", path: "", background: true, wait: true, timeoutMs: 30000 }),
        summary: (step) => fileName(step.path),
    },
    delay: {
        label: "Delay",
        title: "Delay",
        icon: "clock",
        toggles: true,
        fresh: () => ({ kind: "delay", ms: 500 }),
        summary: (step) => `${step.ms} ms`,
    },
};
/**
 * Every kind of action: the steps, and what only a key can do. A kind in the
 * Action union with no entry here does not compile.
 */
export const ACTION_KINDS: { [K in Action["kind"]]: ActionKind<Extract<Action, { kind: K }>> } = {
    ...STEP_KINDS,
    macro: {
        label: "Macro",
        title: "Macro",
        icon: "macro",
        toggles: true,
        fresh: () => ({ kind: "macro", steps: [{ kind: "delay", ms: 500 }] }),
        summary: (action) => `${action.steps.length} steps`,
    },
    page: {
        label: "Page",
        title: "Open page",
        icon: "page",
        toggles: false,
        fresh: (_taken, pageId) => ({ kind: "page", pageId }),
        summary: () => "Open page",
    },
    widget: {
        label: "Widget",
        title: "Widget",
        // A widget key takes its widget's own icon; this is the picker's Widgets entry's.
        icon: "LayoutGrid",
        toggles: false,
        fresh: () => ({ kind: "widget", widget: defaultWidget("clock") }),
        summary: (action) =>
            WIDGET_CHOICES.find((choice) => choice.type === action.widget.type)!.label,
    },
};
/**
 * A fresh step of one kind.
 *
 * @param taken Hotkeys already used elsewhere on the deck. A new hotkey starts
 *              auto-assigned, so it needs to know which combinations are gone.
 */
export function defaultStep(kind: Step["kind"], taken: string[] = []): Step {
    return STEP_KINDS[kind].fresh(taken);
}
export function defaultAction(kind: Action["kind"], pageId = "home", taken: string[] = []): Action {
    return ACTION_KINDS[kind].fresh(taken, pageId);
}
export function actionSummary(action: Action): string {
    const summary = ACTION_KINDS[action.kind].summary as (action: Action) => string;
    return summary(action);
}
