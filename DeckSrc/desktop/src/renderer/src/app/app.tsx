import { TitleBar } from "../components/title-bar";
import { DisconnectedScreen } from "../features/connection/disconnected-screen";
import { Dashboard } from "../features/dashboard/dashboard";
import { useDecky } from "./use-decky";
import { transportOf } from "../../../shared/transport";
export function App() {
    const deck = useDecky();
    return (
        <>
            <TitleBar
                connected={deck.status.connected}
                transport={deck.status.connected ? transportOf(deck.status.identity) : null}
                busy={deck.busy}
                notify={deck.notify}
            />
            {(!deck.status.connected || !deck.dashboardReady) && (
                <DisconnectedScreen
                    checking={deck.checking}
                    connected={deck.status.connected}
                    onEntered={deck.enteredDashboard}
                    reducedMotion={deck.config.reducedMotion}
                    unknownDevices={!deck.status.connected ? deck.status.unknownDevices : undefined}
                />
            )}
            {deck.everConnected && (
                <Dashboard
                    hidden={!deck.status.connected || !deck.dashboardReady}
                    config={deck.config}
                    loaded={deck.loaded}
                    busy={deck.busy}
                    pressedCell={deck.pressedCell}
                    keyStates={deck.keyStates}
                    save={deck.save}
                    navigate={deck.navigate}
                    sync={deck.sync}
                    notify={deck.notify}
                    message={deck.message}
                    clearMessage={deck.clearMessage}
                    onImport={deck.setConfig}
                    firmwareKey={
                        deck.status.connected
                            ? `${deck.status.identity.serial}:${deck.status.identity.protocol}:${deck.status.identity.firmwareVersion ?? ""}`
                            : "offline"
                    }
                />
            )}
        </>
    );
}
