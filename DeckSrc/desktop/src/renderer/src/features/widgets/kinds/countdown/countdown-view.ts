import type { CountdownWidget } from "../../../../../../shared/widgets/countdown";
import type { WidgetView } from "../widget-view";
import { countdownSettings } from "./countdown-settings";
import { drawCountdown } from "./draw-countdown";

export const countdownView: WidgetView<CountdownWidget> = {
    draw: drawCountdown,
    settings: countdownSettings,
};
