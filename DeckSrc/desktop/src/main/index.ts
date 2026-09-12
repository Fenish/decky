/*---------------------------------------------------------------
 * Decky's main process: its parts, built and wired together.
 *
 *   app/       the window, the tray and quitting
 *   deck/      the session with the deck, Wi-Fi setup, what the deck reports
 *   pages/     what the deck holds, and sending it pages
 *   widgets/   widget state and readings, live pictures, wheels, presses
 *   profile/   the profile: saving it, opening pages, running keys
 *   updates/   new releases, firmware installs, Decky updating itself
 *   discord/   Decky on Discord: Rich Presence, over Discord's local pipe
 *   ipc/       the channels the window calls
 *--------------------------------------------------------------*/

import { app, dialog } from "electron";
import { join } from "node:path";
import { AppControls } from "./actions/app-controls";
import { KeyStateStore } from "./actions/key-state";
import { ActionRunner } from "./actions/runner";
import { Lifecycle } from "./app/lifecycle";
import { startedHidden, startWithWindowsAtFirst } from "./app/auto-start";
import { MainWindow } from "./app/main-window";
import { loadConfig } from "./config/store";
import { deckEventHandler } from "./deck/deck-events";
import { RichPresence } from "./discord/presence";
import { DeckSession } from "./deck/session";
import { WifiSetup } from "./deck/wifi-setup";
import { registerHandlers } from "./ipc/handlers";
import { LogFile } from "./logging/log-file";
import { DeckPages } from "./pages/deck-pages";
import { PageSync } from "./pages/page-sync";
import { Profile } from "./profile/profile";
import { PROFILE_EXTENSION } from "./profile/bundle";
import { Profiles } from "./profile/profiles";
import { Workspace } from "./profile/workspace";
import { registerProfileType } from "./system/file-type";
import { WindowsHost } from "./system/windows-host";
import { Updates } from "./updates/updates";
import { DeckWheels } from "./widgets/deck-wheels";
import { WidgetFeeds } from "./widgets/feeds";
import type { IntegrationStatus } from "../shared/integrations/integration";
import type { IntegrationServices } from "./integrations/integration";
import { DISCORD_FINDER } from "./integrations/discord/discord-finder";
import { DiscordService } from "./integrations/discord/discord-service";
import { useSecretsFolder } from "./integrations/settings-store";
import { OBS_FINDER } from "./integrations/obs/obs-finder";
import { ObsService } from "./integrations/obs/obs-service";
import { WidgetReadings } from "./widgets/readings";
import { SpeedTester } from "./widgets/speedtest";
import { LiveKeys } from "./widgets/live-keys";
import { PingWatcher } from "./widgets/ping";
import { WidgetPresses } from "./widgets/presses";
import { WidgetStore } from "./widgets/widget-state";

app.setName("Decky");
app.setAppUserModelId("app.decky.desktop");

const lifecycle = new Lifecycle();
const window = new MainWindow(lifecycle);
const log = new LogFile("deck.log");
const discordLog = new LogFile("discord.log");
const session = new DeckSession(window, lifecycle, log);
const runner = new ActionRunner();
const keyStates = new KeyStateStore();
// Widget readings, set up once the app is ready; quitting stops them.
let readings: WidgetReadings | null = null;
// Decky on Discord, once ready; quitting lets it go.
let presence: RichPresence | null = null;

/**
 * A .deckyprofile opened with Decky - double-clicked, or dropped on it - from
 * the command line that started this Decky, or from the one that tried to
 * start a second. It waits here until the window and the deck are up, and is
 * then offered to be imported; nothing is written unless it is accepted.
 */
let openWith = profileFileIn(process.argv);
let offerFile: ((path: string) => void) | null = null;

function profileFileIn(argv: string[]): string {
    return argv.slice(1).find((arg) => arg.toLowerCase().endsWith(PROFILE_EXTENSION)) ?? "";
}

/** The file waiting to be offered, once there is somewhere to offer it. */
function offerWaiting(): void {
    if (!openWith || !offerFile) return;
    const path = openWith;
    openWith = "";
    offerFile(path);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on("second-instance", (_event, argv) => {
        window.restore();
        openWith = profileFileIn(argv) || openWith;
        offerWaiting();
    });
    void app.whenReady().then(start);
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", (event) =>
        lifecycle.beforeQuit(
            event,
            () => {
                session.stopHeartbeat();
                window.destroyTray();
                runner.stop();
                readings?.stop();
                presence?.stop();
            },
            () => session.goodbye(lifecycle.restartingForUpdate),
        ),
    );
}

async function start(): Promise<void> {
    const folder = app.getPath("userData");
    // The profiles on this PC, and the one in use: everything a setup owns is
    // read from its folder (profiles.ts).
    const profiles = new Profiles(folder);
    await profiles.load();
    // A password or a token was typed on this PC and is the PC's: kept once,
    // beside the profiles, so switching never signs you out (settings-store).
    useSecretsFolder(folder);
    const profile = new Profile(profiles.configPath());
    await session.loadWifiPair(join(folder, "wifi-pair.json"));
    // Widget state (counts, running timers), saved in the profile's folder.
    const widgetStore = new WidgetStore(profiles.widgetsPath(), (states) =>
        window.sendIfOpen("widgets:states", states),
    );
    await widgetStore.load();
    const pings = new PingWatcher(widgetStore);
    // The Windows helper: sound and media for widgets, camera and screen capture for Discord.
    const host = new WindowsHost(folder);
    // Readings for widgets that show the PC and the web: load, volume, playing, prices.
    const feeds = new WidgetFeeds(widgetStore, host);
    // Toggle keys with an app's control follow the app (Discord's mute), once the pages are up.
    let appControls: AppControls | null = null;
    // The apps Decky talks to, each with its settings under integrations/.
    const reportApp = (status: IntegrationStatus): void =>
        window.sendIfOpen("integration:status", status);
    const appSettings = (id: string): string => profiles.integrationPath(id);
    const integrations: IntegrationServices = {
        obs: new ObsService(widgetStore, appSettings("obs"), OBS_FINDER, reportApp),
        discord: new DiscordService({
            store: widgetStore,
            settingsPath: appSettings("discord"),
            finder: DISCORD_FINDER,
            host,
            onStatus: reportApp,
            onControls: () => appControls?.refresh(),
            log: (line) => discordLog.write(line),
        }),
    };
    await Promise.all(Object.values(integrations).map((service) => service.load()));
    const widgetReadings = new WidgetReadings(
        pings,
        feeds,
        new SpeedTester(widgetStore),
        integrations,
    );
    readings = widgetReadings;
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
    widgetReadings.sync(profile.config);
    runner.prepare(profile.config);

    const pages = new DeckPages();
    const wheels = new DeckWheels(session, profile, pages, widgetStore);
    const trace = (line: string): void => log.write(line);
    const live = new LiveKeys(session, profile, pages, wheels, trace);
    const pageSync = new PageSync(session, profile, pages, live, wheels, keyStates, window, trace);
    appControls = new AppControls(profile, keyStates, pageSync, integrations);
    appControls.refresh();
    const presses = new WidgetPresses(profile, widgetStore, widgetReadings, wheels, window);
    const workspace = new Workspace(
        profile,
        profiles,
        pages,
        pageSync,
        presses,
        widgetStore,
        widgetReadings,
        keyStates,
        runner,
        window,
    );
    const updates = new Updates(session, pageSync, window, lifecycle);
    // A design picked on a key, once the touches stop: kept in the profile.
    presses.onDesign = (pageId, cell, widget) =>
        workspace.setWidget(pageId, cell, widget).catch(() => {});
    session.onReconnect = () => pageSync.forget();
    // Decky on Discord, when Settings turns it on: what is going on, from the parts that know.
    const richPresence = new RichPresence(
        join(folder, "presence.json"),
        {
            connected: () => session.status.connected,
            updating: () => updates.updating,
            outputs: () => integrations.obs.presenceOutputs(),
        },
        (status) => window.sendIfOpen("presence:status", status),
    );
    await richPresence.load();
    presence = richPresence;

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
        integrations,
        presence: richPresence,
    });
    updates.checkInBackground();
    session.startHeartbeat(
        () => pages.cacheInitialized,
        () => pageSync.resetDeviceCache(),
    );
    // A profile double-clicked in Explorer: looked inside, and offered to the
    // window once it is there to ask.
    offerFile = (path) => {
        void workspace.offerFile(path).catch((error: unknown) =>
            window.sendIfOpen("action:activity", {
                at: Date.now(),
                label: "Profile",
                ok: false,
                message: String(error),
            }),
        );
    };
    // On the first run of an installed Decky, it starts with Windows; after
    // that the switch in Settings has the say.
    void startWithWindowsAtFirst(folder);
    // Windows opens a .deckyprofile with this Decky. The installer says so
    // too; this keeps it true afterwards, and costs nothing when it already is.
    if (app.isPackaged && process.platform === "win32")
        void registerProfileType(
            process.execPath,
            join(process.resourcesPath, "profile.ico"),
        ).catch(() => {});
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
        presence: richPresence,
    });
    await window.load(startedHidden(process.argv));
    offerWaiting();
}
