import type { SpeedtestWidget } from "../../../../../../shared/widgets/speedtest";
import type { WidgetView } from "../widget-view";
import { drawSpeedtest, speedSample } from "./draw-speedtest";

export const speedtestView: WidgetView<SpeedtestWidget> = {
    draw: drawSpeedtest,
    sample: speedSample,
    hint: () =>
        "Tap the key to run a test against the nearest Speedtest.net server; tap again to stop it. It fills your line both ways for ten seconds each, so it moves real data.",
};
