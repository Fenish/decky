import type { ClockWidget } from "../../../../../../shared/widgets/clock";
import type { WidgetView } from "../widget-view";
import { clockHint, clockSettings } from "./clock-settings";
import { drawClock } from "./draw-clock";

export const clockView: WidgetView<ClockWidget> = {
    draw: drawClock,
    settings: clockSettings,
    hint: clockHint,
};
