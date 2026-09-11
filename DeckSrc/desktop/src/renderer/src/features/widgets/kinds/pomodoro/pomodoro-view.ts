import type { PomodoroWidget } from "../../../../../../shared/widgets/pomodoro";
import type { WidgetView } from "../widget-view";
import { drawPomodoro } from "./draw-pomodoro";
import { pomodoroHint, pomodoroSettings } from "./pomodoro-settings";

export const pomodoroView: WidgetView<PomodoroWidget> = {
    draw: drawPomodoro,
    settings: pomodoroSettings,
    hint: pomodoroHint,
};
