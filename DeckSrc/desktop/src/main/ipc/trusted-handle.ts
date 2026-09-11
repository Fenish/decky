import { ipcMain } from "electron";
import type { MainWindow } from "../app/main-window";

export type Handle = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * Handle an IPC channel for Decky's own window only: a request from any other
 * page or frame is refused before `fn` sees it.
 */
export function trustedHandle(window: MainWindow): Handle {
    return (channel, fn) => {
        ipcMain.handle(channel, (event, ...args: unknown[]) => {
            if (
                event.sender !== window.browserWindow?.webContents ||
                event.senderFrame !== window.browserWindow.webContents.mainFrame
            )
                throw new Error("Untrusted sender.");
            return fn(...args);
        });
    };
}
