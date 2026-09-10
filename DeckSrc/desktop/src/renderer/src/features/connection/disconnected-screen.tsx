import { lazy, Suspense, useCallback, useState } from "react";
import background from "../../assets/disconnected-obsidian-smooth.png";
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
    onEntered,
    reducedMotion,
    unknownDevices,
}: {
    checking: boolean;
    connected: boolean;
    onEntered: () => void;
    reducedMotion: boolean;
    /** Silent USB devices that could be a deck without Decky firmware. */
    unknownDevices?: UnknownDevice[];
}) {
    const waiting = !connected ? unknownDevices?.[0] : undefined;
    const [phase, setPhase] = useState<ConnectionAnimationPhase>("waiting");
    const phaseChanged = useCallback((next: ConnectionAnimationPhase) => setPhase(next), []);
    return (
        <main
            className={`disconnected-screen ${connected ? "is-entering" : ""} ${connected && phase === "zooming" ? "is-zooming" : ""} ${reducedMotion ? "reduce-motion" : ""}`}
            data-phase={connected ? phase : "waiting"}
            aria-label={connected ? "Opening Decky" : "Decky is offline"}
        >
            <img className="disconnected-backdrop" src={background} alt="" draggable={false} />
            <div className="disconnected-scene">
                <div className="disconnected-stage">
                    <div className="disconnected-shadow" aria-hidden="true" />
                    <Suspense fallback={null}>
                        <DisconnectedModel
                            connected={connected}
                            reducedMotion={reducedMotion}
                            onEntered={onEntered}
                            onPhase={phaseChanged}
                        />
                    </Suspense>
                </div>
                <div className="disconnected-connect">
                    <h1>
                        <strong>Decky</strong> is offline
                    </h1>
                    <p className="disconnected-help">
                        Plug it in with a USB data cable, or power it on to reconnect over Wi-Fi.
                    </p>
                    {/* The live region below says the same for screen readers. */}
                    <p className="disconnected-searching" aria-hidden="true">
                        <span className="searching-dot" />
                        Looking for Decky…
                    </p>
                </div>
            </div>
            {waiting && <FirstInstall key={waiting.path} device={waiting} />}
            <span className="connection-announcement" role="status">
                {connected
                    ? "Decky connected. Opening your workspace."
                    : checking
                      ? "Looking for Decky."
                      : "Waiting for Decky. Checking automatically every four seconds."}
            </span>
        </main>
    );
}
