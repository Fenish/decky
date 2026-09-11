/*---------------------------------------------------------------
 * The pages the deck holds, as this app knows them: what each was last sent
 * or confirmed as this session, and the one on screen. Live pictures and
 * sliding text on them are kept by LiveKeys, wheels by DeckWheels.
 *--------------------------------------------------------------*/

import type { DeckConfig } from "../../shared/config";

export interface PageRecord {
    signature: number;
    frames: Buffer[];
    toggles: string;
}

export class DeckPages {
    // Pages the deck holds, as sent or confirmed this session. `toggles` names the ON
    // artwork that went with them, cell and CRC-32 of each.
    readonly uploaded = new Map<string, PageRecord>();
    displayed: { pageId: string; signature: number; frames: Buffer[] } | null = null;
    /**
     * Whether the deck shows the active page as the profile has it now. Its
     * presses, wheels and widget pictures wait for it.
     */
    deviceReady = false;
    /** Whether every page was loaded onto the deck this session, after HELLO. */
    cacheInitialized = false;

    /** Nothing the deck holds is known any more. */
    forget(): void {
        this.cacheInitialized = false;
        this.deviceReady = false;
        this.displayed = null;
        this.uploaded.clear();
    }

    /** Forget pages the profile no longer has. */
    prune(config: DeckConfig): void {
        for (const id of this.uploaded.keys())
            if (!config.pages.some((page) => page.id === id)) this.uploaded.delete(id);
    }
}
