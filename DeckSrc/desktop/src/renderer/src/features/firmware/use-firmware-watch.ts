/*---------------------------------------------------------------
 * An install as the rest of the window sees it. Firmware is installed from
 * Settings, but the deck restarts into its bootloader while it is written -
 * so the dashboard goes and the Disconnected screen is what someone is
 * looking at. This lets that screen show how far the writing has got.
 *--------------------------------------------------------------*/

import { useEffect, useState } from "react";
import type { FirmwareProgress } from "../../../../shared/api";

/** The install now running, if one is; null once the deck is back. */
export function useFirmwareWatch(connected: boolean): FirmwareProgress | null {
    const [progress, setProgress] = useState<FirmwareProgress | null>(null);
    useEffect(() => window.deck.onFirmwareProgress(setProgress), []);
    // The deck answering again is the end of it, however it went.
    const [was, setWas] = useState(connected);
    if (connected !== was) {
        setWas(connected);
        if (connected) setProgress(null);
    }
    return progress;
}
