import { countdownEnd } from "../../../../../../shared/widgets/timer";
import type { TimerWidget } from "../../../../../../shared/widgets/timer";
import type { WidgetView } from "../widget-view";
import { drawTimer } from "./draw-timer";
import { timerPlace, timerWheel } from "./timer-deck-look";
import { timerHint, timerSettings } from "./timer-settings";

export const timerView: WidgetView<TimerWidget> = {
    draw: drawTimer,
    settings: timerSettings,
    hint: timerHint,
    deckLook: { build: timerWheel, place: timerPlace },
    // A countdown with its sound on rings from its end until a tap sets it back.
    alarm: countdownEnd,
};
