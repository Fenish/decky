/*---------------------------------------------------------------
 * Toggle keys whose action is an app's control (Discord's mute): their ON
 * and OFF follow the app, however it was switched - from the deck, the app
 * itself, or a keyboard shortcut. When an app says a control changed, every
 * such key takes its state, and a page shown with one gets its STATE.
 *--------------------------------------------------------------*/

import { keyAddress } from "../../shared/config";
import type { IntegrationService, IntegrationServices } from "../integrations/integration";
import type { PageSync } from "../pages/page-sync";
import type { Profile } from "../profile/profile";
import type { KeyStateStore } from "./key-state";

export class AppControls {
    constructor(
        private readonly profile: Profile,
        private readonly keyStates: KeyStateStore,
        private readonly pageSync: PageSync,
        private readonly integrations: IntegrationServices,
    ) {}

    /** Every app control key takes its app's state; pages that changed are shown so. */
    refresh(): void {
        const changed = new Set<string>();
        for (const page of this.profile.config.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                const action = key.action;
                if (action.kind !== "app" || key.behavior !== "toggle") continue;
                const service: IntegrationService = this.integrations[action.app];
                const on = service.controlState?.(action.control) ?? false;
                if (this.keyStates.follow(keyAddress(page.id, Number(cell)), on))
                    changed.add(page.id);
            }
        for (const pageId of changed) void this.pageSync.showToggles(pageId)?.catch(() => {});
    }
}
