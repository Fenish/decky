import { app } from "electron";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A log kept in `%APPDATA%/Decky/<name>`, for what otherwise leaves no trace:
 * deck.log, what the deck printed that was no reply - a crash report, a boot
 * banner - and why it last started, since its serial line is read by nothing
 * else; discord.log, how the link to Discord came and went, and what it said
 * of its devices, for a Discord that starts up oddly.
 */
export class LogFile {
    private bytes = 0;

    constructor(private readonly name: string) {}

    write(line: string): void {
        const text = `${new Date().toISOString()}  ${line}\n`;
        // A few hundred KB at most: then it starts over.
        const path = join(app.getPath("userData"), this.name);
        const write = this.bytes > 256 * 1024 ? writeFile(path, text) : appendFile(path, text);
        this.bytes = this.bytes > 256 * 1024 ? text.length : this.bytes + text.length;
        void write.catch(() => {});
    }
}
