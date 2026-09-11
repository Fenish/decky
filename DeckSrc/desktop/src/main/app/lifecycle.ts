import { app } from "electron";

/**
 * Decky on its way out. Closing the window only hides it in the tray, so
 * quitting is a state of its own, which the window, the heartbeat and the
 * deck's events all ask about.
 */
export class Lifecycle {
    /** Quitting for real: closing the window no longer hides it. */
    quitting = false;
    // Set when Decky quits for its installer: the deck is left showing the update.
    restartingForUpdate = false;
    private closing = false;

    /**
     * Electron's before-quit. The first time, the quit waits: `stop` runs,
     * then `goodbye` gets up to 700 ms before Decky quits for real.
     */
    beforeQuit(event: Electron.Event, stop: () => void, goodbye: () => Promise<void>): void {
        if (this.closing) return;
        event.preventDefault();
        this.closing = true;
        this.quitting = true;
        stop();
        void Promise.race([
            goodbye(),
            new Promise<void>((resolve) => setTimeout(resolve, 700)),
        ]).finally(() => app.quit());
    }
}
