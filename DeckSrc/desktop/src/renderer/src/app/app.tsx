import { useRef } from "react";
import { TitleBar } from "../components/title-bar";
import { DisconnectedScreen } from "../features/connection/disconnected-screen";
import { Dashboard, type DashboardHandle } from "../features/dashboard/dashboard";
import { SnakeScreen } from "../features/game/snake-screen";
import { AppUpdateScreen } from "../features/updates/app-update-screen";
import { useFirmwareWatch } from "../features/firmware/use-firmware-watch";
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
    // Firmware being written: the deck is in its bootloader, so the screen
    // below is where it can be watched.
    const updating = useFirmwareWatch(deck.status.connected);
    // Settings, where updates are installed, only exists on the dashboard.
    const dashboardShown = deck.status.connected && deck.dashboardReady;
    return (
        <>
            <TitleBar
                connected={deck.status.connected}
                transport={deck.status.connected ? transportOf(deck.status.identity) : null}
                busy={deck.busy}
                notify={deck.notify}
                reducedMotion={deck.config.reducedMotion}
                updates={updates.count}
                onUpdates={dashboardShown ? () => dashboard.current?.openUpdates() : undefined}
            />
            {(!deck.status.connected || !deck.dashboardReady) && (
                <DisconnectedScreen
                    checking={deck.checking}
                    connected={deck.status.connected}
                    booting={deck.booting}
                    updating={updating}
                    stuckPort={!deck.status.connected ? deck.status.stuckPort : undefined}
                    onEntered={deck.enteredDashboard}
                    reducedMotion={deck.config.reducedMotion}
                    unknownDevices={!deck.status.connected ? deck.status.unknownDevices : undefined}
                />
            )}
            {deck.playing !== null && (
                <SnakeScreen
                    score={deck.playing}
                    onStop={() => void window.deck.stopGame().catch(() => {})}
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
                    widgetStates={deck.widgetStates}
                    appsDown={deck.appsDown}
                    save={deck.save}
                    navigate={deck.navigate}
                    goBack={deck.back}
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
