import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, Play, Plus, Trash2, X } from "lucide-react";
import type { Action, DeckPage, KeyConfig, Step } from "../../../../shared/config";
import { appearanceOf } from "../../../../shared/config";
import { ArtworkPreview } from "../artwork/artwork-preview";
import { widgetLook } from "../widgets/draw-widget";
import { viewOf } from "../widgets/kinds/registry";
import { WidgetPreview } from "../widgets/widget-preview";
import { WidgetSettings } from "../widgets/widget-settings";
import { INTEGRATIONS } from "../../../../shared/integrations/registry";
import { defaultWidget, WIDGET_CHOICES } from "../../../../shared/widgets/registry";
import type { WidgetState } from "../../../../shared/widgets";
import { AppearanceEditor } from "../artwork/appearance-editor";
import { AppCard } from "../integrations/app-card";
import { ActionPicker, ACTION_CHOICES, panelName } from "./action-picker";
import type { PickerPanel } from "./action-picker";
import { ACTION_KINDS, defaultAction, stateNames } from "./actions";
import { MacroEditor } from "./macro-editor";
import { StepFields } from "./step-fields";
export type EditorTab = "action" | "appearance";
/** What the settings for one kind of action are drawn from. */
interface PanelProps<A extends Action> {
    /** The key being edited, with its action as that kind. */
    value: KeyConfig & { action: A };
    /** Gives the key a new action. */
    action: (next: Action) => void;
    pages: DeckPage[];
    reservedHotkeys: string[];
    onCreatePage: () => void;
    onError: (message: string) => void;
}
/** Every kind of step is set with the same fields. */
const stepPanel = ({ value, action, reservedHotkeys, onError }: PanelProps<Step>): ReactNode => (
    <StepFields step={value.action} taken={reservedHotkeys} onChange={action} onError={onError} />
);
/**
 * The settings under the Action type list, for each kind of action. Each is
 * drawn in place rather than as a component of its own, so a key changing from
 * one kind of step to another keeps the same fields.
 */
const ACTION_PANELS: {
    [K in Action["kind"]]: (props: PanelProps<Extract<Action, { kind: K }>>) => ReactNode;
} = {
    hotkey: stepPanel,
    program: stepPanel,
    website: stepPanel,
    script: stepPanel,
    delay: stepPanel,
    macro: ({ value, action, reservedHotkeys, onError }) => (
        <MacroEditor
            steps={value.action.steps}
            reservedHotkeys={reservedHotkeys}
            onChange={(steps) => action({ kind: "macro", steps })}
            onError={onError}
        />
    ),
    page: ({ value, action, pages, onCreatePage }) => (
        <div className="page-action-fields">
            <select
                aria-label="Destination page"
                value={value.action.pageId}
                onChange={(e) => action({ kind: "page", pageId: e.target.value })}
            >
                {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                        {page.name}
                    </option>
                ))}
            </select>
            <button className="add-step" onClick={onCreatePage}>
                <Plus size={18} />
                Create page
            </button>
        </div>
    ),
    // Which of the app's controls, and how Decky stands with the app.
    app: ({ value, action }) => {
        const integration = INTEGRATIONS[value.action.app];
        const states = stateNames(value.action);
        return (
            <div className="widget-settings">
                <label className="field">
                    Control
                    <select
                        aria-label={`${integration.name} control`}
                        value={value.action.control}
                        onChange={(e) => action({ ...value.action, control: e.target.value })}
                    >
                        {Object.entries(integration.controls ?? {}).map(([name, control]) => (
                            <option key={name} value={name}>
                                {control.label}
                            </option>
                        ))}
                    </select>
                </label>
                <AppCard id={value.action.app} />
                <p className="widget-hint">
                    As a toggle, it shows {states.on} or {states.off} as {integration.name} is,
                    however it was switched.
                </p>
            </div>
        );
    },
    widget: ({ value, action }) => (
        <WidgetSettings
            widget={value.action.widget}
            look={widgetLook(value)}
            onChange={(widget) => action({ kind: "widget", widget })}
        />
    ),
};
/** A widget's own part of the Appearance tab: its icon, if it draws one, and its looks. */
function widgetAppearance(
    value: KeyConfig,
    action: (next: Action) => void,
): { widgetIcon?: boolean; widgetOptions?: ReactNode } {
    if (value.action.kind !== "widget") return {};
    const { widget } = value.action;
    const view = viewOf(widget);
    return {
        widgetIcon: view.icon === true,
        widgetOptions: view.appearance?.({
            widget,
            look: widgetLook(value),
            onChange: (next) => action({ kind: "widget", widget: next }),
            zones: [],
        }),
    };
}
/** The settings for the key's action, by its kind. */
function actionPanel(props: PanelProps<Action>): ReactNode {
    const panel = ACTION_PANELS[props.value.action.kind] as (
        props: PanelProps<Action>,
    ) => ReactNode;
    return panel(props);
}
interface EditorProps {
    value: KeyConfig | null;
    assigned: boolean;
    previewOn: boolean;
    onPreviewOnChange: (on: boolean) => void;
    pages: DeckPage[];
    pageId: string;
    /** Hotkeys every other key already uses, so auto-assign can skip them. */
    reservedHotkeys: string[];
    tab: EditorTab;
    onTab: (tab: EditorTab) => void;
    onChange: (value: KeyConfig) => void;
    onClose: () => void;
    onCreatePage: () => void;
    onSave: (value: KeyConfig) => Promise<void>;
    onTest: (value: KeyConfig) => Promise<void>;
    onRemove: () => Promise<void>;
    onError: (message: string) => void;
    /** Undo the choice made in the picker: the key goes back to being new. */
    onBack: () => void;
    /** The selected key's running widget state, for its live preview. */
    widgetState?: WidgetState;
}
export function KeyEditor({
    value,
    assigned,
    previewOn,
    onPreviewOnChange,
    pages,
    pageId,
    reservedHotkeys,
    tab,
    onTab,
    onChange,
    onClose,
    onCreatePage,
    onSave,
    onTest,
    onRemove,
    onError,
    onBack,
    widgetState,
}: EditorProps) {
    const [saving, setSaving] = useState(false);
    // While a key is open here, Decky's card on Discord says it is being edited.
    useEffect(() => {
        void window.deck.presenceEditing(true).catch(() => {});
        return () => void window.deck.presenceEditing(false).catch(() => {});
    }, []);
    const [panel, setPanel] = useState<PickerPanel>("actions");
    // The picker panel an unsaved new key was chosen in: Back returns there.
    const [pickedIn, setPickedIn] = useState<PickerPanel | null>(null);
    const back = value && pickedIn && !assigned ? pickedIn : null;
    const appearanceState = previewOn ? "on" : "off";
    const setAppearanceState = (state: "off" | "on"): void => onPreviewOnChange(state === "on");
    const action = (next: Action): void => {
        if (value)
            onChange({
                ...value,
                action: next,
                behavior: ACTION_KINDS[next.kind].toggles ? value.behavior : "normal",
                label:
                    next.kind === "program" && next.path && value.label === "Program"
                        ? (next.name ?? value.label).slice(0, 40)
                        : value.label,
            });
    };
    const commit = async (test = false): Promise<void> => {
        if (!value) return;
        setSaving(true);
        try {
            await (test ? onTest(value) : onSave(value));
        } catch (error) {
            onError(String(error));
        } finally {
            setSaving(false);
        }
    };
    return (
        <section className="floating-editor" aria-label="Key editor">
            <header className="editor-heading">
                {back && (
                    <button
                        className="editor-back"
                        aria-label={`Back to ${panelName(back)}`}
                        title={`Back to ${panelName(back)}`}
                        onClick={() => {
                            setPanel(back);
                            setPickedIn(null);
                            onBack();
                        }}
                    >
                        <ChevronLeft size={20} />
                    </button>
                )}
                <div className="editor-preview">
                    {value?.action.kind === "widget" ? (
                        <WidgetPreview
                            widget={value.action.widget}
                            look={widgetLook(value)}
                            state={widgetState}
                        />
                    ) : (
                        value && (
                            <ArtworkPreview value={appearanceOf(value, appearanceState === "on")} />
                        )
                    )}
                </div>
                {value ? (
                    <input
                        className="key-name"
                        aria-label="Key title"
                        placeholder="Label (optional)"
                        maxLength={40}
                        value={value.label}
                        onChange={(e) => onChange({ ...value, label: e.target.value })}
                    />
                ) : (
                    <h2>New key</h2>
                )}
                <button
                    className="panel-close"
                    aria-label="Close editor"
                    title="Close editor"
                    onClick={onClose}
                >
                    <X size={22} />
                </button>
            </header>
            {!value ? (
                <ActionPicker
                    panel={panel}
                    onPanel={setPanel}
                    onSelect={(kind) => {
                        const choice = ACTION_KINDS[kind];
                        setPickedIn("actions");
                        onChange({
                            label: choice.label,
                            icon: choice.icon,
                            color: "#eee8da",
                            behavior: "normal",
                            action: defaultAction(
                                kind,
                                pages.find((p) => p.id !== pageId)?.id ?? "home",
                                reservedHotkeys,
                            ),
                        });
                    }}
                    onControl={(app, control) => {
                        const choice = INTEGRATIONS[app].controls![control]!;
                        setPickedIn(app);
                        // A toggle: OFF as the app is at rest, ON as the control declares.
                        onChange({
                            label: choice.label,
                            icon: choice.icon,
                            color: "#eee8da",
                            behavior: "toggle",
                            activeAppearance: { ...choice.on },
                            action: { kind: "app", app, control },
                        });
                    }}
                    onWidget={(type) => {
                        const choice = WIDGET_CHOICES.find((c) => c.type === type)!;
                        // An app's widget was picked on its page; any other on Widgets.
                        setPickedIn(choice.group ?? "widgets");
                        onChange({
                            label: "",
                            icon: choice.icon,
                            color: "#eee8da",
                            behavior: "normal",
                            action: { kind: "widget", widget: defaultWidget(type) },
                        });
                    }}
                />
            ) : (
                <>
                    <div className="editor-options">
                        <div
                            className="behavior-selector"
                            role="group"
                            aria-label="Button behavior"
                        >
                            <button
                                className={value.behavior !== "toggle" ? "active" : ""}
                                onClick={() => {
                                    onChange({ ...value, behavior: "normal" });
                                    setAppearanceState("off");
                                }}
                            >
                                Normal
                            </button>
                            <button
                                disabled={!ACTION_KINDS[value.action.kind].toggles}
                                className={value.behavior === "toggle" ? "active" : ""}
                                onClick={() =>
                                    onChange({
                                        ...value,
                                        behavior: "toggle",
                                        activeAppearance:
                                            value.activeAppearance ?? appearanceOf(value),
                                    })
                                }
                            >
                                Toggle
                            </button>
                        </div>
                        <div className="editor-tabs" role="tablist" aria-label="Key settings">
                            <button
                                role="tab"
                                aria-selected={tab === "action"}
                                className={tab === "action" ? "active" : ""}
                                onClick={() => onTab("action")}
                            >
                                {value.action.kind === "widget" ? "Widget" : "Action"}
                            </button>
                            <button
                                role="tab"
                                aria-selected={tab === "appearance"}
                                className={tab === "appearance" ? "active" : ""}
                                onClick={() => onTab("appearance")}
                            >
                                Appearance
                            </button>
                        </div>
                    </div>
                    <div className="editor-body">
                        {tab === "action" ? (
                            <>
                                <select
                                    className="action-kind"
                                    aria-label="Action type"
                                    value={value.action.kind}
                                    onChange={(e) =>
                                        action(
                                            defaultAction(
                                                e.target.value as Action["kind"],
                                                pages.find((p) => p.id !== pageId)?.id ?? "home",
                                                reservedHotkeys,
                                            ),
                                        )
                                    }
                                >
                                    {ACTION_CHOICES.map((item) => (
                                        <option key={item.kind} value={item.kind}>
                                            {item.label}
                                        </option>
                                    ))}
                                    <option value="widget">{ACTION_KINDS.widget.label}</option>
                                    {value.action.kind === "app" && (
                                        <option value="app">{ACTION_KINDS.app.label}</option>
                                    )}
                                </select>
                                {actionPanel({
                                    value,
                                    action,
                                    pages,
                                    reservedHotkeys,
                                    onCreatePage,
                                    onError,
                                })}
                            </>
                        ) : (
                            <>
                                {value.behavior === "toggle" && (
                                    <div
                                        className="state-selector"
                                        role="group"
                                        aria-label="Edit toggle appearance"
                                    >
                                        {(["off", "on"] as const).map((state) => (
                                            <button
                                                key={state}
                                                aria-label={`${stateNames(value.action)[state]} appearance`}
                                                className={
                                                    appearanceState === state ? "active" : ""
                                                }
                                                onClick={() => setAppearanceState(state)}
                                            >
                                                {stateNames(value.action)[state]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <AppearanceEditor
                                    showLabel={value.behavior === "toggle"}
                                    widget={value.action.kind === "widget"}
                                    {...widgetAppearance(value, action)}
                                    value={appearanceOf(value, appearanceState === "on")}
                                    onError={onError}
                                    change={(appearance) =>
                                        onChange(
                                            appearanceState === "on" && value.behavior === "toggle"
                                                ? { ...value, activeAppearance: appearance }
                                                : {
                                                      ...value,
                                                      ...appearance,
                                                      artwork: appearance.artwork,
                                                  },
                                        )
                                    }
                                />
                            </>
                        )}
                    </div>
                    <footer className="editor-footer">
                        <button
                            className="button test-button"
                            disabled={saving}
                            onClick={() => void commit(true)}
                        >
                            <Play size={19} />
                            Test
                        </button>
                        <button
                            className="button primary save-button"
                            aria-label="Save key"
                            disabled={saving}
                            onClick={() => void commit()}
                        >
                            <Check size={18} />
                            {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                            className="button remove-button"
                            aria-label="Clear this key"
                            title="Clear this key"
                            disabled={!assigned || saving}
                            onClick={() => void onRemove().catch((e) => onError(String(e)))}
                        >
                            <Trash2 size={20} />
                        </button>
                    </footer>
                </>
            )}
        </section>
    );
}
