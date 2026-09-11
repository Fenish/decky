import { useState } from "react";
import { Check, ChevronLeft, Play, Plus, Trash2, X } from "lucide-react";
import type { Action, DeckPage, KeyConfig } from "../../../../shared/config";
import { appearanceOf } from "../../../../shared/config";
import { ArtworkPreview } from "../artwork/artwork-preview";
import { WidgetPreview } from "../widgets/widget-preview";
import { WidgetSettings } from "../widgets/widget-settings";
import { defaultWidget, WIDGET_CHOICES } from "../../../../shared/widgets";
import type { WidgetState } from "../../../../shared/widgets";
import { AppearanceEditor } from "../artwork/appearance-editor";
import { ActionPicker, ACTION_CHOICES } from "./action-picker";
import type { PickerPanel } from "./action-picker";
import { defaultAction } from "./actions";
import { MacroEditor } from "./macro-editor";
import { StepFields } from "./step-fields";
export type EditorTab = "action" | "appearance";
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
                behavior:
                    next.kind === "page" || next.kind === "widget" ? "normal" : value.behavior,
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
                        aria-label={back === "widgets" ? "Back to widgets" : "Back to actions"}
                        title={back === "widgets" ? "Back to widgets" : "Back to actions"}
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
                            look={{
                                background: value.background ?? "#000000",
                                color: value.color,
                                label: value.label,
                            }}
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
                        const choice = ACTION_CHOICES.find((c) => c.kind === kind)!;
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
                    onWidget={(type) => {
                        const choice = WIDGET_CHOICES.find((c) => c.type === type)!;
                        setPickedIn("widgets");
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
                                disabled={
                                    value.action.kind === "page" || value.action.kind === "widget"
                                }
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
                                    <option value="widget">Widget</option>
                                </select>
                                {value.action.kind === "widget" ? (
                                    <WidgetSettings
                                        widget={value.action.widget}
                                        look={{
                                            background: value.background ?? "#000000",
                                            color: value.color,
                                            label: value.label,
                                        }}
                                        onChange={(widget) => action({ kind: "widget", widget })}
                                    />
                                ) : value.action.kind === "macro" ? (
                                    <MacroEditor
                                        steps={value.action.steps}
                                        reservedHotkeys={reservedHotkeys}
                                        onChange={(steps) => action({ kind: "macro", steps })}
                                        onError={onError}
                                    />
                                ) : value.action.kind === "page" ? (
                                    <div className="page-action-fields">
                                        <select
                                            aria-label="Destination page"
                                            value={value.action.pageId}
                                            onChange={(e) =>
                                                action({ kind: "page", pageId: e.target.value })
                                            }
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
                                ) : (
                                    <StepFields
                                        step={value.action}
                                        taken={reservedHotkeys}
                                        onChange={action}
                                        onError={onError}
                                    />
                                )}
                            </>
                        ) : (
                            <>
                                {value.behavior === "toggle" && (
                                    <div
                                        className="state-selector"
                                        role="group"
                                        aria-label="Edit toggle appearance"
                                    >
                                        <button
                                            aria-label="OFF appearance"
                                            className={appearanceState === "off" ? "active" : ""}
                                            onClick={() => setAppearanceState("off")}
                                        >
                                            OFF
                                        </button>
                                        <button
                                            aria-label="ON appearance"
                                            className={appearanceState === "on" ? "active" : ""}
                                            onClick={() => setAppearanceState("on")}
                                        >
                                            ON
                                        </button>
                                    </div>
                                )}
                                <AppearanceEditor
                                    showLabel={value.behavior === "toggle"}
                                    widget={value.action.kind === "widget"}
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
