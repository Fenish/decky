/*---------------------------------------------------------------
 * The profile as it is now: pages, keys and settings, in memory. It is read
 * from the profile in use at start (config/store.ts, profiles.ts), and every
 * change goes through Workspace.persist().
 *--------------------------------------------------------------*/

import { createConfig, isWidgetKey } from "../../shared/config";
import type { DeckConfig } from "../../shared/config";
import type { Widget } from "../../shared/widgets";

export class Profile {
    config: DeckConfig = createConfig();

    /** `path` is the profile.json of the profile in use; switching moves it. */
    constructor(public path: string) {}

    /** The widget at a key of the profile as it is now, if it still is one. */
    currentWidget(pageId: string, cell: number): Widget | undefined {
        const page = this.config.pages.find((item) => item.id === pageId);
        const action = page?.keys[String(cell)]?.action;
        return page && isWidgetKey(page, cell) && action?.kind === "widget"
            ? action.widget
            : undefined;
    }
}
