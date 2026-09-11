/*---------------------------------------------------------------
 * The view of every OBS output widget - recording, streaming - made by
 * obsView for the output the registry names. What differs is in OUTPUTS.
 * Its settings panel is OBS's connection card: how Decky stands with OBS,
 * so a key added without OBS on the PC says so at once, and where to fix it.
 *--------------------------------------------------------------*/

import { createElement } from "react";
import type { WidgetState } from "../../../../../../shared/widgets";
import { OBS_ARM_S } from "../../../../../../shared/widgets/obs";
import type { ObsOutput, ObsWidget } from "../../../../../../shared/widgets/obs";
import { AppCard } from "../../../integrations/app-card";
import type { WidgetView } from "../widget-view";
import { drawObs } from "./draw-obs";
import type { ObsFace } from "./draw-obs";

/** What each output's key shows, and says under its settings. */
const OUTPUTS: Record<ObsOutput, ObsFace & { what: string }> = {
    record: { glyph: "record", tag: "REC", what: "OBS records" },
    stream: { glyph: "broadcast", tag: "LIVE", what: "OBS streams" },
};

/** The view of an OBS widget showing `output`. OUTPUTS is read as it draws, never while modules load. */
export function obsView<W extends ObsWidget>(output: ObsOutput): WidgetView<W> {
    return {
        draw: (ctx, _widget, look, area, moment) =>
            drawObs(ctx, OUTPUTS[output], look, area, moment),
        settings: () => createElement(AppCard, { id: "obs" }),
        hint: () =>
            `Shows whether ${OUTPUTS[output].what}, and for how long, as OBS says - so it is right ` +
            `however you start it. Touch to start or stop: it counts down ${OBS_ARM_S} seconds ` +
            "first, and a second touch calls it off.",
        sample: (now): WidgetState => ({
            obs: { health: "ready", active: true, ms: 754_000, at: now },
        }),
    };
}
