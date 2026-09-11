import type { DeckConfig } from "../../shared/config";
import type { IntegrationServices } from "../integrations/integration";
import type { WidgetFeeds } from "./feeds";
import type { PingWatcher } from "./ping";

/**
 * Everything widgets read from outside Decky: pings; the PC's sound, what is
 * playing, its load and prices; and the apps Decky talks to (integrations).
 * Each follows the profile, reading only for the widgets on it.
 */
export class WidgetReadings {
    constructor(
        readonly pings: PingWatcher,
        readonly feeds: WidgetFeeds,
        readonly integrations: IntegrationServices,
    ) {}

    /** Start, change and stop what is read, to match the profile. */
    sync(config: DeckConfig): void {
        this.pings.sync(config);
        this.feeds.sync(config);
        for (const service of Object.values(this.integrations)) service.sync(config);
    }

    stop(): void {
        this.pings.stop();
        this.feeds.stop();
        for (const service of Object.values(this.integrations)) service.stop();
    }
}
