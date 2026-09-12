/*---------------------------------------------------------------
 * Every IPC channel the window can call (src/preload/index.ts names them
 * for the renderer), each handed to the part that does the work. Arguments
 * arrive as the renderer sent them and are checked where they are used.
 *--------------------------------------------------------------*/

import { dialog, shell } from "electron";
import { validateConfig } from "../../shared/config";
import { autoStart, setAutoStart } from "../app/auto-start";
import type { KeyStateStore } from "../actions/key-state";
import type { ActionRunner } from "../actions/runner";
import type { MainWindow } from "../app/main-window";
import type { DeckSession } from "../deck/session";
import type { WifiSetup } from "../deck/wifi-setup";
import type { RichPresence } from "../discord/presence";
import { INTEGRATIONS, integrationNamed } from "../../shared/integrations/registry";
import type { IntegrationId } from "../../shared/integrations/integration";
import type { IntegrationService, IntegrationServices } from "../integrations/integration";
import type { PageSync } from "../pages/page-sync";
import type { Profile } from "../profile/profile";
import type { Workspace } from "../profile/workspace";
import { getProgramIcon, listPrograms } from "../programs/catalog";
import { cancelAppUpdate } from "../updates/app-update";
import type { Updates } from "../updates/updates";
import type { DeckWheels } from "../widgets/deck-wheels";
import type { LiveKeys } from "../widgets/live-keys";
import type { WidgetStore } from "../widgets/widget-state";
import { trustedHandle } from "./trusted-handle";

/** What a key's program or script is picked from. */
const TARGETS = {
    program: { title: "Choose a program", name: "Programs", extensions: ["exe", "lnk"] },
    script: {
        title: "Choose a PowerShell script",
        name: "PowerShell scripts",
        extensions: ["ps1"],
    },
};

export interface HandlerParts {
    window: MainWindow;
    session: DeckSession;
    wifi: WifiSetup;
    updates: Updates;
    profile: Profile;
    workspace: Workspace;
    pageSync: PageSync;
    live: LiveKeys;
    wheels: DeckWheels;
    keyStates: KeyStateStore;
    widgetStore: WidgetStore;
    runner: ActionRunner;
    integrations: IntegrationServices;
    presence: RichPresence;
}

export function registerHandlers(parts: HandlerParts): void {
    const { window, session, wifi, updates, profile, workspace, pageSync } = parts;
    const { live, wheels, keyStates, widgetStore, runner, integrations, presence } = parts;
    const handle = trustedHandle(window);

    // The deck: its status, pages and widget keys.
    handle("app:autostart", () => autoStart());
    handle("app:setAutostart", (on) => setAutoStart(on));
    handle("deck:status", () => session.check());
    handle("game:stop", () => session.serial(() => session.link.command("GAME off", 2000)));
    handle("page:sync", (pageId, frames, toggleFrames) =>
        pageSync.syncPage(pageId, frames, toggleFrames),
    );
    handle("pages:cache", (pages, warmup) => pageSync.cachePages(pages, warmup));
    handle("deck:live", (pageId, cell, frame, overlays) =>
        live.queue(pageId, cell, frame, overlays),
    );
    handle("deck:wheel", (pageId, cell, spec, values, index) =>
        wheels.queue(pageId, cell, spec, values, index),
    );

    // The profile, and pressing its keys.
    handle("config:get", () => profile.config);
    handle("config:save", (value) => {
        validateConfig(value);
        return workspace.persist(value);
    });
    handle("profiles:list", () => workspace.profileList());
    handle("profiles:use", (id) => workspace.useProfile(id));
    handle("profiles:add", (name) => workspace.addProfile(name));
    handle("profiles:rename", (id, name) => workspace.renameProfile(id, name));
    handle("profiles:remove", (id) => workspace.removeProfile(id));
    handle("config:export", (id) => workspace.exportProfile(id));
    // Importing is two steps: look inside, then keep it.
    handle("profiles:inspectFile", (path) => workspace.inspectFile(path));
    handle("profiles:inspect", (id) => workspace.inspectProfile(id));
    handle("profiles:take", (name) => workspace.takeProfile(name));
    handle("profiles:waiting", () => workspace.waitingProfile());
    handle("page:navigate", (pageId) => workspace.navigate(pageId));
    handle("page:back", (pageId) => workspace.back(pageId));
    handle("keys:move", (source, target) => workspace.move(source, target));
    handle("keys:duplicate", (source) => workspace.duplicate(source));
    handle("keys:states", () => keyStates.snapshot());
    handle("widgets:states", () => widgetStore.snapshot());
    handle("action:run", (pageId, cell) => workspace.runKey(pageId, cell));
    handle("action:cancel", () => runner.cancel());

    // Choosing what a key runs.
    handle("programs:list", listPrograms);
    handle("programs:icon", getProgramIcon);
    handle("target:pick", async (kind) => {
        if (kind !== "program" && kind !== "script") throw new Error("Invalid target type.");
        const { title, name, extensions } = TARGETS[kind];
        const result = await dialog.showOpenDialog(window.browserWindow!, {
            title,
            properties: ["openFile"],
            filters: [{ name, extensions }],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    // Wi-Fi.
    handle("wifi:status", () => wifi.status());
    handle("wifi:scan", () => wifi.scan());
    handle("wifi:join", (ssid, password) => wifi.join(ssid, password));
    handle("wifi:forget", () => wifi.forget());

    // Apps Decky talks to (integrations): how it stands with each, its settings,
    // starting it, and where to get it (its declaration's own https page).
    const app = (id: unknown): IntegrationService => {
        if (!integrationNamed(id)) throw new Error("Unknown app.");
        return integrations[id as IntegrationId];
    };
    handle("integration:status", (id) => app(id).check());
    handle("integration:save", (id, values) => app(id).save(values));
    handle("integration:open", (id) => app(id).open());
    handle("integration:download", (id) => shell.openExternal(INTEGRATIONS[app(id).id].download));
    handle("integration:authorize", async (id) => {
        const service = app(id);
        if (!service.authorize) throw new Error("That app asks for no permission.");
        return service.authorize();
    });
    handle("integration:call", async (id, name) => {
        const service = app(id);
        if (!service.call || typeof name !== "string")
            throw new Error("That app has nothing to ask.");
        return service.call(name);
    });

    // Decky on Discord: on or off, and a key being edited in the app.
    handle("presence:status", () => presence.status());
    handle("presence:set", (enabled) => presence.setEnabled(enabled));
    handle("presence:editing", (editing) => presence.setEditing(editing));

    // Updates to the firmware and to Decky.
    handle("firmware:info", () => updates.firmwareInfo());
    handle("firmware:check", async () => {
        await updates.checkForUpdates();
        return updates.firmwareInfo();
    });
    handle("firmware:probe", (path) => updates.probe(path));
    handle("firmware:install", (request) => updates.installFirmware(request));
    handle("app-update:install", () => updates.installApp());
    handle("app-update:cancel", () => cancelAppUpdate());
    handle("app-update:download", () => updates.openDownload());

    // The title bar.
    handle("window:state", () => window.state());
    handle("window:control", (action) => window.control(action));
}
