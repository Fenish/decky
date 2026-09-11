import { useMemo } from "react";
import { INTEGRATIONS } from "../../../../shared/integrations/registry";
import { defaultWidget, WIDGET_CHOICES } from "../../../../shared/widgets/registry";
import type { Widget, WidgetType } from "../../../../shared/widgets";
import type { WidgetLook } from "./draw-widget";
import { viewOf } from "./kinds/registry";
import "./widgets.css";

function timeZones(): string[] {
    try {
        return Intl.supportedValuesOf("timeZone");
    } catch {
        return ["UTC"];
    }
}

/**
 * The settings of one widget, which change with its type. Every change is
 * clamped to what the profile accepts, so saving never trips over a number.
 */
export function WidgetSettings({
    widget,
    look,
    onChange,
}: {
    widget: Widget;
    look: WidgetLook;
    onChange: (widget: Widget) => void;
}) {
    const zones = useMemo(() => timeZones(), []);
    // An app's widget changes only to another of that app's (OBS: recording,
    // streaming); any other widget, to any but an app's.
    const group = WIDGET_CHOICES.find((choice) => choice.type === widget.type)?.group;
    const typeField = (
        <label className="field">
            {group ? INTEGRATIONS[group].name : "Widget"}
            <select
                aria-label="Widget type"
                value={widget.type}
                onChange={(event) => onChange(defaultWidget(event.target.value as WidgetType))}
            >
                {WIDGET_CHOICES.filter((choice) => choice.group === group).map((choice) => (
                    <option key={choice.type} value={choice.type}>
                        {choice.label}
                    </option>
                ))}
            </select>
        </label>
    );
    // The type's fields are called for here, not mounted as a component of
    // their own: React then keeps what two types have in the same place when
    // the type changes, as the style tiles from Volume to Now playing.
    const view = viewOf(widget);
    const fields = view.settings?.({ widget, look, onChange, zones });
    const hint = view.hint?.(widget) ?? "";
    return (
        <div className="widget-settings">
            {typeField}
            {fields}
            {hint && <p className="widget-hint">{hint}</p>}
        </div>
    );
}
