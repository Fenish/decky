import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import script from "./windows-host.ps1?raw";

/** A line the helper writes by itself: the volume or a mute changed. */
export interface HostEvent {
    event: string;
    [field: string]: unknown;
}

/**
 * Decky's Windows helper (windows-host.ps1): the volume, the microphone and
 * what is playing, which Node cannot reach. One PowerShell for as long as it
 * is needed, started on the first request and again after it exits; each
 * request is a JSON line, answered by id. Lines with no id are events.
 */
export class WindowsHost {
    private child: ChildProcessWithoutNullStreams | null = null;
    private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
    private next = 1;
    private buffer = "";
    private readonly listeners = new Set<(event: HostEvent) => void>();
    private readonly waiting = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
    >();
    /** Counts the helper's starts: what it was asked to do, a new one has not been. */
    run = 0;

    constructor(private readonly folder: string) {}

    /** Hear the helper's events. */
    on(listener: (event: HostEvent) => void): void {
        this.listeners.add(listener);
    }

    private async start(): Promise<ChildProcessWithoutNullStreams> {
        // PowerShell cannot read a script from inside the app's archive.
        const path = join(this.folder, "windows-host.ps1");
        await writeFile(path, script, "utf8");
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path],
            { windowsHide: true },
        );
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            this.buffer += chunk;
            let end: number;
            while ((end = this.buffer.indexOf("\n")) >= 0) {
                const line = this.buffer.slice(0, end).trim();
                this.buffer = this.buffer.slice(end + 1);
                if (line) this.answer(line);
            }
        });
        child.stderr.resume();
        child.on("exit", () => {
            this.child = null;
            for (const [id, waiter] of this.waiting) {
                clearTimeout(waiter.timer);
                waiter.reject(new Error("The Windows helper stopped."));
                this.waiting.delete(id);
            }
        });
        child.on("error", () => {});
        this.child = child;
        this.run++;
        return child;
    }

    private answer(line: string): void {
        let reply: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string };
        try {
            reply = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof reply.event === "string") {
            for (const listener of this.listeners) listener(reply as HostEvent);
            return;
        }
        const waiter = reply.id === undefined ? undefined : this.waiting.get(reply.id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.waiting.delete(reply.id!);
        if (reply.ok) waiter.resolve(reply.result);
        else waiter.reject(new Error(reply.error ?? "The Windows helper refused."));
    }

    /** Ask the helper: `op` with its fields, answered within `timeoutMs`. */
    async request<T>(
        op: string,
        fields: Record<string, unknown> = {},
        timeoutMs = 6000,
    ): Promise<T> {
        if (process.platform !== "win32") throw new Error("Only Windows has these.");
        if (!this.child) {
            this.starting ??= this.start().finally(() => (this.starting = null));
            await this.starting;
        }
        const id = this.next++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                reject(new Error("The Windows helper did not answer."));
            }, timeoutMs);
            this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
            this.child!.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
        });
    }

    stop(): void {
        this.child?.kill();
        this.child = null;
    }
}
