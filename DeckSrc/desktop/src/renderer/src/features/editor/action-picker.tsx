import { useState } from "react";
import type { ReactNode } from "react";
import { Blocks, ChevronLeft, ChevronRight, LayoutGrid, Search, Volume2 } from "lucide-react";
import type { Action } from "../../../../shared/config";
import type { IntegrationId } from "../../../../shared/integrations/integration";
import { INTEGRATIONS } from "../../../../shared/integrations/registry";
import { WIDGET_CHOICES } from "../../../../shared/widgets/registry";
import type { WidgetType } from "../../../../shared/widgets";
import { KeyIcon } from "../../components/key-icon";
import { AppCard } from "../integrations/app-card";
import { ACTION_KINDS } from "./actions";
import "../widgets/widgets.css";
/** The actions to pick from, in the order the picker lists them. */
export const ACTION_CHOICES: {
    kind: Exclude<Action["kind"], "widget" | "app">;
    label: string;
    icon: string;
}[] = (["hotkey", "program", "page", "macro", "website", "script"] as const).map((kind) => ({
    kind,
    label: ACTION_KINDS[kind].label,
    icon: ACTION_KINDS[kind].icon,
}));
/**
 * The picker's panels: actions; widgets and apps one step in; each app's
 * keys one step further (shared/integrations).
 */
export type PickerPanel = "actions" | "widgets" | "apps" | IntegrationId;
const APP_IDS = Object.keys(INTEGRATIONS) as IntegrationId[];

/** A panel as a Back button names it: "widgets", or an app by its name. */
export const panelName = (panel: PickerPanel): string =>
    Object.hasOwn(INTEGRATIONS, panel) ? INTEGRATIONS[panel as IntegrationId].name : panel;

/** The widgets that are no app's, and each app's: its page lists them. */
const choicesOf = (group: IntegrationId | undefined): WidgetType[] =>
    WIDGET_CHOICES.filter((item) => item.group === group).map((item) => item.type);

function WidgetOptions({
    types,
    label = "Widgets",
    onWidget,
}: {
    types: WidgetType[];
    label?: string;
    onWidget: (type: WidgetType) => void;
}) {
    return (
        <div className="action-options" role="group" aria-label={label}>
            {WIDGET_CHOICES.filter((item) => types.includes(item.type)).map((item) => (
                <button key={item.type} onClick={() => onWidget(item.type)}>
                    <KeyIcon name={item.icon} size={24} />
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
}

/** An app's controls to pick, each by its ON look: Discord's Muted, Deafened. */
function ControlOptions({
    app,
    names,
    onControl,
}: {
    app: IntegrationId;
    names: string[];
    onControl: (app: IntegrationId, control: string) => void;
}) {
    const controls = INTEGRATIONS[app].controls ?? {};
    return (
        <div
            className="action-options"
            role="group"
            aria-label={`${INTEGRATIONS[app].name} controls`}
        >
            {names.map((name) => (
                <button key={name} onClick={() => onControl(app, name)}>
                    <KeyIcon name={controls[name]!.on.icon} size={24} />
                    <span>{controls[name]!.label}</span>
                </button>
            ))}
        </div>
    );
}

/** A row that opens a panel one step in: its icon, name, and what it holds if that needs saying. */
function Entry({
    icon,
    name,
    holds,
    onOpen,
}: {
    icon: ReactNode;
    name: string;
    holds?: string;
    onOpen: () => void;
}) {
    return (
        <button className="picker-entry" onClick={onOpen}>
            {icon}
            <span>
                {name}
                {holds && <small>{holds}</small>}
            </span>
            <ChevronRight size={18} />
        </button>
    );
}

interface PanelParts {
    onPanel: (panel: PickerPanel) => void;
    onWidget: (type: WidgetType) => void;
    onControl: (app: IntegrationId, control: string) => void;
}

/** Each panel past the first: its title, where Back goes, and what it lists. */
function panelOf(panel: Exclude<PickerPanel, "actions">): {
    title: string;
    back: PickerPanel;
    body: (parts: PanelParts) => ReactNode;
} {
    const panels: Record<"widgets" | "apps", ReturnType<typeof panelOf>> = {
        widgets: {
            title: "Widgets",
            back: "actions",
            body: ({ onWidget }) => (
                <WidgetOptions types={choicesOf(undefined)} onWidget={onWidget} />
            ),
        },
        apps: {
            title: "Apps",
            back: "actions",
            body: ({ onPanel }) => (
                <div className="apps-list" role="group" aria-label="Apps">
                    {APP_IDS.map((id) => (
                        <Entry
                            key={id}
                            icon={<KeyIcon name={INTEGRATIONS[id].icon} size={24} />}
                            name={INTEGRATIONS[id].name}
                            onOpen={() => onPanel(id)}
                        />
                    ))}
                </div>
            ),
        },
    };
    if (panel === "widgets" || panel === "apps") return panels[panel];
    const app = INTEGRATIONS[panel];
    return {
        title: app.name,
        back: "apps",
        // How Decky stands with it first - its keys wait on that - then its
        // keys: what it can switch, then its widgets.
        body: ({ onWidget, onControl }) => (
            <>
                <AppCard id={panel} />
                <hr className="picker-divider" />
                {app.controls && (
                    <ControlOptions
                        app={panel}
                        names={Object.keys(app.controls)}
                        onControl={onControl}
                    />
                )}
                {choicesOf(panel).length > 0 && (
                    <WidgetOptions types={choicesOf(panel)} label={app.name} onWidget={onWidget} />
                )}
            </>
        ),
    };
}

export function ActionPicker({
    panel,
    onPanel,
    onSelect,
    onWidget,
    onControl,
}: {
    panel: PickerPanel;
    onPanel: (panel: PickerPanel) => void;
    onSelect: (kind: Exclude<Action["kind"], "widget" | "app">) => void;
    onWidget: (type: WidgetType) => void;
    onControl: (app: IntegrationId, control: string) => void;
}) {
    const [query, setQuery] = useState("");
    if (panel !== "actions") {
        const { title, back, body } = panelOf(panel);
        return (
            <div className="action-picker">
                <div className="picker-heading">
                    <button
                        className="picker-back"
                        aria-label={`Back to ${panelName(back)}`}
                        onClick={() => onPanel(back)}
                    >
                        <ChevronLeft size={18} />
                        <span>Back</span>
                    </button>
                    <h3>{title}</h3>
                </div>
                {body({ onPanel, onWidget, onControl })}
            </div>
        );
    }
    const matches = (label: string): boolean => label.toLowerCase().includes(query.toLowerCase());
    const choices = ACTION_CHOICES.filter((item) => matches(item.label));
    // Searching finds widgets too, by name or what they are for ("music"),
    // without opening their panel: an app's under its name.
    const found = query
        ? WIDGET_CHOICES.filter((item) => matches(item.label) || matches(item.words))
        : [];
    // And apps' controls by name ("mute"), under their app's.
    const groups: {
        label: string;
        app?: IntegrationId;
        controls: string[];
        types: WidgetType[];
    }[] = [
        {
            label: "Widgets",
            controls: [],
            types: found.filter((item) => !item.group).map((item) => item.type),
        },
        ...APP_IDS.map((id) => ({
            label: INTEGRATIONS[id].name,
            app: id,
            controls: query
                ? Object.entries(INTEGRATIONS[id].controls ?? {})
                      .filter(([, control]) => matches(control.label) || matches(control.on.label))
                      .map(([name]) => name)
                : [],
            types: found.filter((item) => item.group === id).map((item) => item.type),
        })),
    ].filter((group) => group.types.length > 0 || group.controls.length > 0);
    const widgetsEntry = !query || matches("widgets");
    const appsEntry =
        !query || matches("apps") || APP_IDS.some((id) => matches(INTEGRATIONS[id].name));
    return (
        <div className="action-picker">
            <label className="action-search">
                <Search size={18} />
                <input
                    aria-label="Find an action"
                    placeholder="Find an action or widget"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </label>
            {choices.length > 0 && (
                <div className="action-options">
                    {choices.map((item) => (
                        <button key={item.kind} onClick={() => onSelect(item.kind)}>
                            <KeyIcon name={item.icon} size={24} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
            {widgetsEntry && (
                <Entry
                    icon={<LayoutGrid size={24} />}
                    name="Widgets"
                    holds="Clock, now playing, volume and more"
                    onOpen={() => onPanel("widgets")}
                />
            )}
            {appsEntry && (
                <Entry
                    icon={<Blocks size={24} />}
                    name="Apps"
                    holds={APP_IDS.map((id) => INTEGRATIONS[id].name).join(", ")}
                    onOpen={() => onPanel("apps")}
                />
            )}
            {groups.map((group) => (
                <div key={group.label}>
                    <p className="action-group-title">{group.label}</p>
                    {group.app && group.controls.length > 0 && (
                        <ControlOptions
                            app={group.app}
                            names={group.controls}
                            onControl={onControl}
                        />
                    )}
                    {group.types.length > 0 && (
                        <WidgetOptions
                            types={group.types}
                            label={group.label}
                            onWidget={onWidget}
                        />
                    )}
                </div>
            ))}
            {choices.length === 0 && groups.length === 0 && !widgetsEntry && !appsEntry && (
                <p className="empty-search">No matching actions</p>
            )}
            {!query && (
                <button className="soundpad-option" disabled>
                    <Volume2 size={22} />
                    <span>Soundpad</span>
                    <small>Soon</small>
                </button>
            )}
        </div>
    );
}
