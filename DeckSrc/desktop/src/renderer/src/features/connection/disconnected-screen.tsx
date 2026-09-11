import { lazy, Suspense, useCallback, useState } from "react";
import background from "../../assets/disconnected-obsidian-smooth.webp";
import "./disconnected-screen.css";
import type { UnknownDevice } from "../../../../shared/api";
import { FirstInstall } from "../firmware/first-install";
const DisconnectedModel = lazy(() =>
    import("./disconnected-model").then((m) => ({ default: m.DisconnectedModel })),
);
export type ConnectionAnimationPhase = "waiting" | "rotating" | "zooming";
export function DisconnectedScreen({
    checking,
    connected,
    booting = false,
    stuckPort,
    onEntered,
    reducedMotion,
    unknownDevices,
}: {
    checking: boolean;
    connected: boolean;
    /**
     * Connected, but the deck is still loading your pages and widgets: the
     * screen says so and opens only once it has.
     */
    booting?: boolean;
    /** A deck's USB bridge that stopped answering, which only a replug mends. */
    stuckPort?: string;
    onEntered: () => void;
    reducedMotion: boolean;
    /** Silent USB devices that could be a deck without Decky firmware. */
    unknownDevices?: UnknownDevice[];
}) {
    const waiting = !connected ? unknownDevices?.[0] : undefined;
    const entering = connected && !booting;
    const [phase, setPhase] = useState<ConnectionAnimationPhase>("waiting");
    const phaseChanged = useCallback((next: ConnectionAnimationPhase) => setPhase(next), []);
    return (
        <main
            className={`disconnected-screen ${entering ? "is-entering" : ""} ${booting ? "is-booting" : ""} ${entering && phase === "zooming" ? "is-zooming" : ""} ${reducedMotion ? "reduce-motion" : ""}`}
            data-phase={entering ? phase : "waiting"}
            aria-label={
                entering ? "Opening Decky" : booting ? "Decky is starting" : "Decky is offline"
            }
        >
            <img className="disconnected-backdrop" src={background} alt="" draggable={false} />
            <div className="disconnected-scene">
                <div className="disconnected-stage">
                    <div className="disconnected-shadow" aria-hidden="true" />
                    <Suspense fallback={null}>
                        <DisconnectedModel
                            connected={entering}
                            reducedMotion={reducedMotion}
                            onEntered={onEntered}
                            onPhase={phaseChanged}
                        />
                    </Suspense>
                </div>
                <div className="disconnected-connect">
                    {booting ? (
                        <>
                            <h1>
                                <strong>Decky</strong> is starting
                            </h1>
                            <p className="disconnected-help">
                                Loading your pages and widgets onto the deck. It opens here as soon
                                as they are ready.
                            </p>
                            <p className="disconnected-searching" aria-hidden="true">
                                <span className="searching-dot" />
                                Loading your pages…
                            </p>
                        </>
                    ) : stuckPort ? (
                        <>
                            <h1>
                                <strong>Decky</strong> stopped responding
                            </h1>
                            <p className="disconnected-help">
                                Its USB connection ({stuckPort}) stopped answering. Unplug the cable
                                from the deck and plug it back in.
                            </p>
                            <p className="disconnected-searching" aria-hidden="true">
                                <span className="searching-dot" />
                                Waiting for Decky…
                            </p>
                        </>
                    ) : (
                        <>
                            <h1>
                                <strong>Decky</strong> is offline
                            </h1>
                            <p className="disconnected-help">
                                Plug it in with a USB data cable, or power it on to reconnect over
                                Wi-Fi.
                            </p>
                            {/* The live region below says the same for screen readers. Not
                                while a device without Decky is offered: it has been found. */}
                            {!waiting && (
                                <p className="disconnected-searching" aria-hidden="true">
                                    <span className="searching-dot" />
                                    Looking for Decky…
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
            {waiting && <FirstInstall key={waiting.path} device={waiting} />}
            <span className="connection-announcement" role="status">
                {booting
                    ? "Decky connected. Loading your pages onto the deck."
                    : stuckPort && !connected
                      ? "Decky stopped responding. Unplug the cable and plug it back in."
                      : connected
                        ? "Decky connected. Opening your workspace."
                        : checking
                          ? "Looking for Decky."
                          : "Waiting for Decky. Checking automatically every four seconds."}
            </span>
        </main>
    );
}
