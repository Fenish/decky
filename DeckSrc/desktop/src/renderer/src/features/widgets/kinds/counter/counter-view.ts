import type { CounterWidget } from "../../../../../../shared/widgets/counter";
import type { WidgetView } from "../widget-view";
import { counterHint, counterSettings } from "./counter-settings";
import { drawCounter } from "./draw-counter";

export const counterView: WidgetView<CounterWidget> = {
    draw: drawCounter,
    settings: counterSettings,
    hint: counterHint,
};
