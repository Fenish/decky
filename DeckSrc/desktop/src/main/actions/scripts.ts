import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
const windowsRoot = process.env["SystemRoot"] ?? "C:\\Windows";
const POWERSHELL = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
export interface ScriptOptions {
    background: boolean;
    wait: boolean;
    timeoutMs?: number;
}
export function scriptArguments(path: string, background: boolean, wait = true): string[] {
    if (background) return ["-NoProfile", "-NonInteractive", "-File", path];
    const script = `$ErrorActionPreference='Stop'; $child=Start-Process -FilePath ${literal(POWERSHELL)} -ArgumentList @('-NoProfile','-File',${literal(`"${path}"`)}) -WindowStyle Normal ${wait ? "-Wait " : ""}-PassThru; ${wait ? "exit $child.ExitCode" : "exit 0"}`;
    return [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
    ];
}
export function runScript(
    path: string,
    options: ScriptOptions,
    signal: AbortSignal,
): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const detached = options.background && !options.wait;
        const child = spawn(POWERSHELL, scriptArguments(path, options.background, options.wait), {
            windowsHide: true,
            shell: false,
            stdio: "ignore",
            detached,
        });
        if (detached) {
            child.once("error", reject);
            child.once("spawn", () => {
                child.unref();
                resolve();
            });
            return;
        }
        // A visible independent script only waits for its launcher to confirm startup.
        // The script's lifetime is no longer owned by Decky after that launcher exits.
        const stop = (): void => {
            if (child.pid && child.exitCode === null)
                execFile(
                    join(windowsRoot, "System32", "taskkill.exe"),
                    ["/PID", String(child.pid), "/T", "/F"],
                    { windowsHide: true },
                    () => {},
                );
        };
        const abort = (): void => stop();
        signal.addEventListener("abort", abort, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (options.wait && options.timeoutMs && options.timeoutMs > 0)
            timer = setTimeout(() => {
                stop();
                reject(
                    new Error(`Script exceeded its ${options.timeoutMs! / 1000} second timeout.`),
                );
            }, options.timeoutMs);
        const cleanup = (): void => {
            if (timer) clearTimeout(timer);
            signal.removeEventListener("abort", abort);
        };
        child.once("error", (error) => {
            cleanup();
            reject(error);
        });
        child.once("exit", (code) => {
            cleanup();
            if (code === 0) resolve();
            else reject(new Error(`Script exited with code ${code}.`));
        });
        if (signal.aborted) stop();
    });
}
