/*---------------------------------------------------------------
 * Every widget type's view, as the renderer draws, sets up and turns it.
 * A type in the Widget union with no view here does not compile.
 *--------------------------------------------------------------*/

import type { Widget, WidgetType } from "../../../../../shared/widgets";
import { clockView } from "./clock/clock-view";
import { countdownView } from "./countdown/countdown-view";
import { counterView } from "./counter/counter-view";
import { cryptoView } from "./crypto/crypto-view";
import { diceView } from "./dice/dice-view";
import { mediaView } from "./media/media-view";
import { micView } from "./mic/mic-view";
import { noteView } from "./note/note-view";
import { pingView } from "./ping/ping-view";
import { pomodoroView } from "./pomodoro/pomodoro-view";
import { systemView } from "./system/system-view";
import { timerView } from "./timer/timer-view";
import { volumeView } from "./volume/volume-view";
import type { WidgetView } from "./widget-view";

type WidgetViews = { [T in WidgetType]: WidgetView<Extract<Widget, { type: T }>> };

export const WIDGET_VIEWS: WidgetViews = {
    clock: clockView,
    timer: timerView,
    pomodoro: pomodoroView,
    countdown: countdownView,
    media: mediaView,
    volume: volumeView,
    mic: micView,
    system: systemView,
    ping: pingView,
    crypto: cryptoView,
    counter: counterView,
    dice: diceView,
    note: noteView,
};

/** A widget's view. */
export function viewOf<W extends Widget>(widget: W): WidgetView<W> {
    return WIDGET_VIEWS[widget.type] as unknown as WidgetView<W>;
}
