import type { PingWidget } from "../../../../../../shared/widgets/ping";
import type { WidgetView } from "../widget-view";
import { drawPing } from "./draw-ping";
import { pingHint, pingSettings } from "./ping-settings";

export const pingView: WidgetView<PingWidget> = {
    draw: drawPing,
    settings: pingSettings,
    hint: pingHint,
};
