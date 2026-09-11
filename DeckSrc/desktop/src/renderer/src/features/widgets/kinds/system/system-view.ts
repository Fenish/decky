import type { SystemWidget } from "../../../../../../shared/widgets/system";
import { wave } from "../../samples";
import type { WidgetView } from "../widget-view";
import { drawSystem } from "./draw-system";
import { systemHint, systemSettings } from "./system-settings";

export const systemView: WidgetView<SystemWidget> = {
    draw: drawSystem,
    settings: systemSettings,
    hint: systemHint,
    sample: () => ({
        cpu: wave(60, 30, 12, 1).map(Math.round),
        ram: wave(60, 62, 3, 2).map(Math.round),
    }),
};
