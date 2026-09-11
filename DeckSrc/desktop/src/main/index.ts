/*---------------------------------------------------------------
 * Decky's main process: its parts, built and wired together.
 *
 *   app/       the window, the tray and quitting
 *   deck/      the session with the deck, Wi-Fi setup, what the deck reports
 *   pages/     what the deck holds, and sending it pages
 *   widgets/   widget state and readings, live pictures, wheels, presses
 *   profile/   the profile: saving it, opening pages, running keys
 *   updates/   new releases, firmware installs, Decky updating itself
 *   ipc/       the channels the window calls
 *--------------------------------------------------------------*/

import { app, dialog } from "electron";
import { join } from "node:path";
import { KeyStateStore } from "./actions/key-state";
import { ActionRunner } from "./actions/runner";
import { Lifecycle } from "./app/lifecycle";
import { MainWindow } from "./app/main-window";
import { loadConfig } from "./config/store";
import { deckEventHandler } from "./deck/deck-events";
import { DeckSession } from "./deck/session";
import { WifiSetup } from "./deck/wifi-setup";
import { registerHandlers } from "./ipc/handlers";
import { DeckLog } from "./logging/deck-log";
import { DeckPages } from "./pages/deck-pages";
import { PageSync } from "./pages/page-sync";
import { Profile } from "./profile/profile";
import { Workspace } from "./profile/workspace";
import { WindowsHost } from "./system/windows-host";
import { Updates } from "./updates/updates";
import { DeckWheels } from "./widgets/deck-wheels";
import { WidgetFeeds } from "./widgets/feeds";
import { LiveKeys } from "./widgets/live-keys";
import { PingWatcher } from "./widgets/ping";
import { WidgetPresses } from "./widgets/presses";
import { WidgetStore } from "./widgets/widget-state";

app.setName("Decky");
app.setAppUserModelId("app.decky.desktop");

const lifecycle = new Lifecycle();
const window = new MainWindow(lifecycle);
const log = new DeckLog();
const session = new DeckSession(window, lifecycle, log);
const runner = new ActionRunner();
const keyStates = new KeyStateStore();
// Widget readings, set up once the app is ready; quitting stops them.
let readings: { pings: PingWatcher; feeds: WidgetFeeds } | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on("second-instance", () => window.restore());
    void app.whenReady().then(start);
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) =>
        lifecycle.beforeQuit(
            event,
            () => {
                session.stopHeartbeat();
                window.destroyTray();
                runner.cancel();
                readings?.pings.stop();
                readings?.feeds.stop();
            },
            () => session.goodbye(lifecycle.restartingForUpdate),
        ),
    );
}

async function start(): Promise<void> {
    const folder = app.getPath("userData");
    const profile = new Profile(join(folder, "decky.json"));
    await session.loadWifiPair(join(folder, "wifi-pair.json"));
    // Widget state (counts, running timers), saved beside the profile.
    const widgetStore = new WidgetStore(join(folder, "widgets.json"), (states) =>
        window.sendIfOpen("widgets:states", states),
    );
    await widgetStore.load();
    const pings = new PingWatcher(widgetStore);
    // Readings for widgets that show the PC and the web: load, volume, playing, prices.
    const feeds = new WidgetFeeds(widgetStore, new WindowsHost(folder));
    readings = { pings, feeds };
    try {
        profile.config = await loadConfig(
            profile.path,
            join(app.getPath("appData"), "deck-studio", "bindings.json"),
        );
    } catch (error) {
        dialog.showErrorBox("Decky configuration", String(error));
        app.quit();
        return;
    }
    widgetStore.reconcile(profile.config);
    pings.sync(profile.config);
    feeds.sync(profile.config);

    const pages = new DeckPages();
    const wheels = new DeckWheels(session, profile, pages, widgetStore, feeds);
    const live = new LiveKeys(session, profile, pages, wheels);
    const pageSync = new PageSync(session, profile, pages, live, wheels, keyStates, window);
    const presses = new WidgetPresses(profile, widgetStore, pings, feeds, wheels, window);
    const workspace = new Workspace(
        profile,
        pages,
        pageSync,
        presses,
        widgetStore,
        pings,
        feeds,
        keyStates,
        runner,
        window,
    );
    const updates = new Updates(session, pageSync, window, lifecycle);
    session.onReconnect = () => pageSync.forget();

    window.create();
    registerHandlers({
        window,
        session,
        wifi: new WifiSetup(session),
        updates,
        profile,
        workspace,
        pageSync,
        live,
        wheels,
        keyStates,
        widgetStore,
        runner,
    });
    updates.checkInBackground();
    session.startHeartbeat(
        () => pages.cacheInitialized,
        () => pageSync.resetDeviceCache(),
    );
    session.watchPorts();
    session.link.onNoise = (line) => log.write(line);
    session.link.onEvent = deckEventHandler({
        lifecycle,
        window,
        log,
        session,
        profile,
        pages,
        pageSync,
        wheels,
        presses,
        workspace,
    });
    await window.load();
}
