import { runScript } from "./scripts";
import { dirname, join } from "node:path";
import { validProgramTarget } from "../../shared/programs";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { shell } from "electron";
import { setTimeout as delay } from "node:timers/promises";
import { HotkeySender } from "./hotkeys";
import { isStep, validWebsite } from "../../shared/config";
import type { Action, DeckConfig, Step } from "../../shared/config";
import type { Reply } from "../../shared/api";
export class ActionRunner {
    private keyboard = new HotkeySender();
    private controllers = new Set<AbortController>();
    /** Stop the actions running; the keystroke helper stays ready. */
    cancel(): void {
        for (const controller of this.controllers) controller.abort();
    }
    /** Quitting: stop the actions running, and the keystroke helper. */
    stop(): void {
        this.cancel();
        this.keyboard.stop();
    }
    /**
     * Ready for the profile's keys before the first press: where any key
     * sends a hotkey, the keystroke helper starts now rather than on that
     * press (about half a second).
     */
    prepare(config: DeckConfig): void {
        const steps = config.pages
            .flatMap((page) => Object.values(page.keys))
            .flatMap(({ action }) => (action.kind === "macro" ? action.steps : [action]));
        if (steps.some((step) => step.kind === "hotkey")) this.keyboard.start();
    }
    async run(action: Action): Promise<Reply> {
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            // Pages, widgets and app controls are the workspace's to handle.
            const steps = action.kind === "macro" ? action.steps : isStep(action) ? [action] : null;
            if (!steps) throw new Error("This key is not run by the action runner.");
            for (const step of steps) {
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
        const run = this.steps[step.kind] as (step: Step, signal: AbortSignal) => Promise<void>;
        await run(step, signal);
    }
    /** How each kind of step runs. */
    private readonly steps: {
        [K in Step["kind"]]: (
            step: Extract<Step, { kind: K }>,
            signal: AbortSignal,
        ) => Promise<void>;
    } = {
        delay: async (step, signal) => {
            await delay(step.ms, undefined, { signal });
        },
        hotkey: async (step, signal) => {
            const error = this.keyboard.send(step.keys);
            if (error) throw new Error(error);
            await delay(100, undefined, { signal });
        },
        website: async (step) => {
            if (!validWebsite(step.url))
                throw new Error("Only HTTP and HTTPS websites are supported.");
            await shell.openExternal(step.url);
        },
        program: async (step) => {
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
        },
        script: async (step, signal) => {
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
        },
    };
}
