/*---------------------------------------------------------------
 * Integrations as main keeps them: each app's service links Decky to the
 * app, keeps the keys that show it current, and starts the app when asked.
 * What an app declares - its
 * name, its settings - is shared/integrations; each app has its folder here,
 * and a row in IntegrationServices.
 *--------------------------------------------------------------*/

import type { Reply } from "../../shared/api";
import type { DeckConfig } from "../../shared/config";
import type { IntegrationId, IntegrationStatus } from "../../shared/integrations/integration";
import type { DiscordService } from "./discord/discord-service";
import type { ObsService } from "./obs/obs-service";

export interface IntegrationService {
    readonly id: IntegrationId;
    /** Its settings, as saved on this PC. */
    load(): Promise<void>;
    /** Follow the profile: reach the app while any key shows it, and let go without. */
    sync(config: DeckConfig): void;
    status(): IntegrationStatus;
    /** Try the app now, as Settings asks. */
    check(): Promise<IntegrationStatus>;
    /** New settings from Settings: checked, saved, then tried. */
    save(values: unknown): Promise<IntegrationStatus>;
    /** Start the app from where it is installed; the link follows once it runs. */
    open(): Promise<Reply>;
    /** Ask the app's permission (its card's Authorize), for an app that needs it. */
    authorize?(): Promise<Reply>;
    /** A control's state (the app's `controls`), for toggle keys that follow it; null while unknown. */
    controlState?(control: string): boolean | null;
    /** A key with one of the app's controls pressed. */
    press?(control: string): Promise<Reply>;
    /** Something the window asks of the app by name: the voice channel you are in, say. */
    call?(name: string): Promise<unknown>;
    stop(): void;
}

/** Each integration's service, by id. */
export interface IntegrationServices extends Record<IntegrationId, IntegrationService> {
    obs: ObsService;
    discord: DiscordService;
}
