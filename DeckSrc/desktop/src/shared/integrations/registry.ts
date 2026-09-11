import type { Integration, IntegrationId } from "./integration";
import { discordIntegration } from "./discord";
import { obsIntegration } from "./obs";

/** Every integration, in the order the Apps page lists them. An id with no entry does not compile. */
export const INTEGRATIONS: { [I in IntegrationId]: Integration & { id: I } } = {
    obs: obsIntegration,
    discord: discordIntegration,
};

/** An app's control a key names, if the app has it. */
export function controlNamed(app: unknown, control: unknown) {
    const integration = integrationNamed(app);
    return integration &&
        typeof control === "string" &&
        Object.hasOwn(integration.controls ?? {}, control)
        ? integration.controls![control]
        : undefined;
}

/** The integration an id read from outside - the window - names, if it names one. */
export function integrationNamed(id: unknown): Integration | undefined {
    return typeof id === "string" && Object.hasOwn(INTEGRATIONS, id)
        ? INTEGRATIONS[id as IntegrationId]
        : undefined;
}
