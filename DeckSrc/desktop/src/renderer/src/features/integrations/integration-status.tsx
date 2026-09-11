import { useEffect, useMemo, useState } from "react";
import type { DeckConfig } from "../../../../shared/config";
import type {
    IntegrationHealth,
    IntegrationId,
    IntegrationStatus,
} from "../../../../shared/integrations/integration";
import { INTEGRATIONS } from "../../../../shared/integrations/registry";

type Healths = Partial<Record<IntegrationId, IntegrationHealth>>;

/** Each app's standing, with what was just heard of one: the same object when nothing changed. */
const hearing =
    (next: IntegrationStatus) =>
    (was: Healths): Healths =>
        was[next.id] === next.health ? was : { ...was, [next.id]: next.health };

/**
 * The apps keys control (`{ kind: "app" }`) that Decky cannot reach now: their
 * keys are drawn disabled. Each is asked for as the profile first names it,
 * and followed as it changes; one not heard of yet counts as reachable. The
 * same array while the same apps are down.
 */
export function useAppsDown(config: DeckConfig): readonly IntegrationId[] {
    const [health, setHealth] = useState<Healths>({});
    const controlled = [
        ...new Set(
            config.pages.flatMap((page) =>
                Object.values(page.keys).flatMap((key) =>
                    key.action.kind === "app" ? [key.action.app] : [],
                ),
            ),
        ),
    ]
        .sort()
        .join(",");
    useEffect(() => window.deck.onIntegrationStatus((next) => setHealth(hearing(next))), []);
    useEffect(() => {
        let live = true;
        for (const id of controlled ? (controlled.split(",") as IntegrationId[]) : [])
            window.deck
                .integrationStatus(id)
                .then((next) => {
                    if (live) setHealth(hearing(next));
                })
                .catch(() => {});
        return () => {
            live = false;
        };
    }, [controlled]);
    const down = (controlled ? (controlled.split(",") as IntegrationId[]) : [])
        .filter((id) => health[id] !== undefined && health[id] !== "ready")
        .join(",");
    return useMemo(() => (down ? (down.split(",") as IntegrationId[]) : []), [down]);
}

/**
 * How Decky stands with an app: asked for when shown - Decky tries the app
 * then - and as it changes; the setter takes a status a save answered with.
 */
export function useIntegrationStatus(
    id: IntegrationId,
): [IntegrationStatus | null, (status: IntegrationStatus) => void] {
    const [status, setStatus] = useState<IntegrationStatus | null>(null);
    useEffect(() => {
        let live = true;
        window.deck
            .integrationStatus(id)
            .then((next) => {
                if (live) setStatus(next);
            })
            .catch(() => {});
        const off = window.deck.onIntegrationStatus((next) => {
            if (next.id === id) setStatus(next);
        });
        return () => {
            live = false;
            off();
        };
    }, [id]);
    return [status, setStatus];
}

/** One line on how Decky stands with an app, its dot in the standing's colour. */
export function IntegrationStatusText({
    id,
    status,
}: {
    id: IntegrationId;
    status: IntegrationStatus | null;
}) {
    const app = INTEGRATIONS[id];
    return (
        <p className="app-status" data-health={status?.health ?? "checking"} role="status">
            {status ? app.says[status.health](status.version) : `Looking for ${app.name}…`}
        </p>
    );
}
