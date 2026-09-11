import { runScript } from "./scripts";
import { dirname, join } from "node:path";
import { validProgramTarget } from "../../shared/programs";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { shell } from "electron";
import { setTimeout as delay } from "node:timers/promises";
import { HotkeySender } from "./hotkeys";
import { validWebsite } from "../../shared/config";
import type { Action, Step } from "../../shared/config";
import type { Reply } from "../../shared/api";
export class ActionRunner {
    private keyboard = new HotkeySender();
    private controllers = new Set<AbortController>();
    cancel(): void {
        for (const controller of this.controllers) controller.abort();
        this.keyboard.stop();
    }
    async run(action: Action): Promise<Reply> {
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            if (action.kind === "page") throw new Error("Page actions are handled by navigation.");
            if (action.kind === "widget") throw new Error("Widgets handle their own presses.");
            for (const step of action.kind === "macro" ? action.steps : [action]) {
                controller.signal.throwIfAborted();
                await this.step(step, controller.signal);
            }
            return {
                ok: true,
                message:
                    action.kind === "script" && action.wait === false
                        ? "Script launched independently."
                        : "Action completed.",
            };
        } catch (error) {
            return {
                ok: false,
                message: controller.signal.aborted
                    ? "Action stopped."
                    : error instanceof Error
                      ? error.message
                      : "Action failed.",
            };
        } finally {
            this.controllers.delete(controller);
        }
    }
    private async step(step: Step, signal: AbortSignal): Promise<void> {
        if (step.kind === "delay") {
            await delay(step.ms, undefined, { signal });
            return;
        }
        if (step.kind === "hotkey") {
            const error = this.keyboard.send(step.keys);
            if (error) throw new Error(error);
            await delay(100, undefined, { signal });
            return;
        }
        if (step.kind === "website") {
            if (!validWebsite(step.url))
                throw new Error("Only HTTP and HTTPS websites are supported.");
            await shell.openExternal(step.url);
            return;
        }
        if (step.kind === "program") {
            if (!validProgramTarget(step.path))
                throw new Error("Select a program before running this key.");
            if (/\.lnk$/i.test(step.path)) {
                await access(step.path);
                const error = await shell.openPath(step.path);
                if (error) throw new Error(error);
                return;
            }
            const appId = step.path.startsWith("app:") ? step.path.slice(4) : null;
            if (!appId) await access(step.path);
            await new Promise<void>((resolve, reject) => {
                const executable = appId
                    ? join(process.env["SystemRoot"] ?? "C:\\Windows", "explorer.exe")
                    : step.path;
                const child = spawn(executable, appId ? [`shell:AppsFolder\\${appId}`] : [], {
                    detached: true,
                    stdio: "ignore",
                    shell: false,
                    windowsHide: true,
                    ...(!appId ? { cwd: dirname(step.path) } : {}),
                });
                child.once("error", reject);
                child.once("spawn", () => {
                    child.unref();
                    resolve();
                });
            });
            return;
        }
        await access(step.path);
        await runScript(
            step.path,
            {
                background: step.background !== false,
                wait: step.wait !== false,
                timeoutMs: step.timeoutMs ?? 30000,
            },
            signal,
        );
    }
}
