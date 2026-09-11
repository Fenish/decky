import { spawn } from "node:child_process";
import type { Reply } from "../../../shared/api";
import type { SystemWidget } from "../../../shared/widgets/system";
import type { WidgetAction, WidgetActionContext, WidgetKey } from "./widget-action";

/** A tap opens Task Manager. */
export class TaskManagerAction implements WidgetAction<SystemWidget> {
    press(
        context: WidgetActionContext,
        _widget: SystemWidget,
        _key: WidgetKey,
        hold: boolean,
    ): Reply {
        if (hold) return { ok: true, message: "Tap to open Task Manager." };
        spawn("taskmgr.exe", [], { detached: true, stdio: "ignore" })
            .on("error", context.failed)
            .unref();
        return { ok: true, message: "Opening Task Manager." };
    }
}
