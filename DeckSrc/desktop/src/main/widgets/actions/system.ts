import { spawn } from "node:child_process";
import type { SystemWidget } from "../../../shared/widgets/system";
import type { GestureHandler, WidgetAction } from "./widget-action";

const openTaskManager: GestureHandler<SystemWidget> = (context) => {
    spawn("taskmgr.exe", [], { detached: true, stdio: "ignore" })
        .on("error", context.failed)
        .unref();
    return { ok: true, message: "Opening Task Manager." };
};

/** A tap opens Task Manager. */
export class TaskManagerAction implements WidgetAction<SystemWidget> {
    readonly gestures = { tap: openTaskManager };
}
