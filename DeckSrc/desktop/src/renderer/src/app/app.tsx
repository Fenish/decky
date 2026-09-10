import { useRef } from "react";
import { TitleBar } from "../components/title-bar";
import { DisconnectedScreen } from "../features/connection/disconnected-screen";
import { Dashboard, type DashboardHandle } from "../features/dashboard/dashboard";
import { AppUpdateScreen } from "../features/updates/app-update-screen";
import { useUpdates } from "../features/updates/use-updates";
import { useDecky } from "./use-decky";
import { transportOf } from "../../../shared/transport";
export function App() {
    const deck = useDecky();
    const dashboard = useRef<DashboardHandle>(null);
    const firmwareKey = deck.status.connected
        ? `${deck.status.identity.serial}:${deck.status.identity.protocol}:${deck.status.identity.firmwareVersion ?? ""}`
        : "offline";
    const updates = useUpdates(firmwareKey);
    // Settings, where updates are installed, only exists on the dashboard.
    const dashboardShown = deck.status.connected && deck.dashboardReady;
    return (
        <>
            <TitleBar
                connected={deck.status.connected}
                transport={deck.status.connected ? transportOf(deck.status.identity) : null}
                busy={deck.busy}
                notify={deck.notify}
                updates={updates.count}
                onUpdates={dashboardShown ? () => dashboard.current?.openUpdates() : undefined}
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
                    ref={dashboard}
                    hidden={!dashboardShown}
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
                    firmwareKey={firmwareKey}
                />
            )}
            <AppUpdateScreen />
        </>
    );
}
