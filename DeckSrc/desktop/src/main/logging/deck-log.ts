import { app } from "electron";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What the deck printed that was no reply - a crash report, a boot banner -
 * and why it last started, kept in `%APPDATA%/Decky/deck.log`. A deck that
 * reboots mid-session otherwise leaves no trace: its crash report goes to the
 * serial line, which nothing reads.
 */
export class DeckLog {
    private bytes = 0;

    write(line: string): void {
        const text = `${new Date().toISOString()}  ${line}\n`;
        // A few hundred KB at most: then it starts over.
        const path = join(app.getPath("userData"), "deck.log");
        const write = this.bytes > 256 * 1024 ? writeFile(path, text) : appendFile(path, text);
        this.bytes = this.bytes > 256 * 1024 ? text.length : this.bytes + text.length;
        void write.catch(() => {});
    }
}
