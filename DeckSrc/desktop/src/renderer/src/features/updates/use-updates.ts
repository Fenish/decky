import { useEffect, useState } from "react";
import type { FirmwareInfo } from "../../../../shared/api";

/**
 * What can be updated right now: Decky itself, the deck's firmware, or both.
 *
 * Re-read after every background check of GitHub, and whenever the deck
 * connects, disconnects or comes back on other firmware (`deckKey` changes).
 */
export function useUpdates(deckKey: string): { info: FirmwareInfo | null; count: number } {
    const [info, setInfo] = useState<FirmwareInfo | null>(null);
    useEffect(() => {
        let live = true;
        const load = (): void => {
            window.deck
                .firmwareInfo()
                .then((next) => {
                    if (live) setInfo(next);
                })
                .catch(() => {
                    /* The Updates section reports errors; the count just stays as it was. */
                });
        };
        load();
        const off = window.deck.onUpdatesChanged(load);
        return () => {
            live = false;
            off();
        };
    }, [deckKey]);
    const count = (info?.update ? 1 : 0) + (info?.appUpdate ? 1 : 0);
    return { info, count };
}
