/*---------------------------------------------------------------
 * The profile in use: saving changes to it, opening its pages and running
 * its keys. Every change goes through persist(), which brings toggle
 * states, widgets and what the deck holds in line with it.
 *--------------------------------------------------------------*/

import { app as electron, dialog } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { duplicateKey, moveKey } from "../../shared/key-layout";
import type { KeyLocation } from "../../shared/key-layout";
import { BACK_CELL, homePageId, validateConfig } from "../../shared/config";
import type { DeckConfig, KeyStates } from "../../shared/config";
import type { Widget } from "../../shared/widgets";
import type { Reply } from "../../shared/api";
import type { IntegrationId } from "../../shared/integrations/integration";
import { toSendKeys } from "../actions/hotkeys";
import type { KeyStateStore } from "../actions/key-state";
import type { ActionRunner } from "../actions/runner";
import type { MainWindow } from "../app/main-window";
import { saveConfig } from "../config/store";
import { INTEGRATIONS } from "../../shared/integrations/registry";
import {
    askedValues,
    saveIntegrationValues,
    travellingValues,
} from "../integrations/settings-store";
import type { ProfileReport } from "../../shared/api";
import {
    BUNDLE_MAX,
    packBundle,
    placeFiles,
    PROFILE_EXTENSION,
    readProfileFiles,
    unpackBundle,
} from "./bundle";
import type { ProfileBundle } from "./bundle";
import { reportOf, reportOfProfile } from "./report";
import type { DeckPages } from "../pages/deck-pages";
import type { PageSync } from "../pages/page-sync";
import type { IntegrationService } from "../integrations/integration";
import type { WidgetReadings } from "../widgets/readings";
import type { WidgetPresses } from "../widgets/presses";
import type { WidgetStore } from "../widgets/widget-state";
import { loadConfig } from "../config/store";
import type { Profile } from "./profile";
import type { ProfileEntry, Profiles } from "./profiles";

const location = (value: unknown): KeyLocation => {
    if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as KeyLocation).pageId !== "string" ||
        !Number.isInteger((value as KeyLocation).cell)
    )
        throw new Error("Invalid key position.");
    return value as KeyLocation;
};

export class Workspace {
    private saveQueue: Promise<unknown> = Promise.resolve();
    /** Each page opened, and the page it was opened from, for its Back; gone when Decky quits. */
    private readonly cameFrom = new Map<string, string>();
    /** The .deckyprofile last looked at, until it is kept or another is opened. */
    private waiting: ProfileBundle | null = null;
    /**
     * A profile opened with Decky and not yet answered. The window is told,
     * and can ask for it too: a file double-clicked while Decky was closed
     * arrives before the window is listening.
     */
    private offered: ProfileReport | null = null;

    constructor(
        private readonly profile: Profile,
        private readonly profiles: Profiles,
        private readonly pages: DeckPages,
        private readonly pageSync: PageSync,
        private readonly presses: WidgetPresses,
        private readonly widgetStore: WidgetStore,
        private readonly readings: WidgetReadings,
        private readonly keyStates: KeyStateStore,
        private readonly runner: ActionRunner,
        private readonly window: MainWindow,
    ) {}

    async persist(
        next: DeckConfig,
        afterReconcile?: (previous: KeyStates) => void,
    ): Promise<DeckConfig> {
        const { profile } = this;
        validateConfig(next);
        for (const page of next.pages)
            for (const key of Object.values(page.keys)) {
                const steps = key.action.kind === "macro" ? key.action.steps : [key.action];
                for (const step of steps)
                    if (step.kind === "hotkey" && toSendKeys(step.keys) === null)
                        throw new Error(
                            "Unsupported hotkey. Use Ctrl, Alt, Shift and a key; Windows-key combinations are not supported yet.",
                        );
            }
        if (
            JSON.stringify(
                profile.config.pages.find((p) => p.id === profile.config.activePageId),
            ) !== JSON.stringify(next.pages.find((p) => p.id === next.activePageId))
        )
            this.pages.deviceReady = false;
        const write = this.saveQueue.then(async () => {
            await saveConfig(profile.path, next);
            const previousStates = this.keyStates.snapshot();
            this.keyStates.reconcile(profile.config, next);
            afterReconcile?.(previousStates);
            this.widgetStore.reconcile(next);
            profile.config = next;
            this.readings.sync(next);
            this.runner.prepare(next);
            this.pageSync.prune(next);
            this.window.send("keys:states", this.keyStates.snapshot());
        });
        this.saveQueue = write.catch(() => {});
        await write;
        this.window.send("config:changed", profile.config);
        return profile.config;
    }

    /** The profiles there are, and which is in use. */
    profileList(): { active: string; profiles: ProfileEntry[] } {
        return { active: this.profiles.active.id, profiles: this.profiles.all() };
    }

    /**
     * Switch to another profile: its pages, what its widgets counted and the
     * apps it talks to all come from its own folder. What belongs to the deck
     * - its pairing, its firmware - is not a profile's and stays.
     */
    async useProfile(id: unknown): Promise<DeckConfig> {
        if (typeof id !== "string" || !this.profiles.has(id)) throw new Error("No such profile.");
        if (id === this.profiles.active.id) return this.profile.config;
        await this.profiles.use(id);
        this.profile.path = this.profiles.configPath();
        const config = await loadConfig(this.profile.path, "");
        await this.widgetStore.usePath(this.profiles.widgetsPath());
        await Promise.all(
            Object.entries(this.readings.integrations).map(([app, service]) =>
                service.usePath(this.profiles.integrationPath(app)),
            ),
        );
        // The deck holds the last profile's pages: everything is drawn again.
        this.pageSync.forget();
        await this.persist(config);
        this.window.send("profiles:changed", this.profileList());
        return this.profile.config;
    }

    /** A profile of its own, empty; the caller switches to it if it wants. */
    async addProfile(name: unknown): Promise<{ active: string; profiles: ProfileEntry[] }> {
        await this.profiles.add(typeof name === "string" ? name : "Profile");
        this.window.send("profiles:changed", this.profileList());
        return this.profileList();
    }

    async renameProfile(
        id: unknown,
        name: unknown,
    ): Promise<{ active: string; profiles: ProfileEntry[] }> {
        if (typeof id !== "string" || typeof name !== "string") throw new Error("No such profile.");
        await this.profiles.rename(id, name);
        this.window.send("profiles:changed", this.profileList());
        return this.profileList();
    }

    async removeProfile(id: unknown): Promise<{ active: string; profiles: ProfileEntry[] }> {
        if (typeof id !== "string") throw new Error("No such profile.");
        await this.profiles.remove(id);
        this.window.send("profiles:changed", this.profileList());
        return this.profileList();
    }

    /** Open a page - from a page key, or the window - remembering the one it was opened from. */
    async navigate(pageId: unknown): Promise<DeckConfig> {
        const from = this.profile.config.activePageId;
        const config = await this.show(pageId);
        if (pageId !== from) this.cameFrom.set(pageId as string, from);
        return config;
    }

    /**
     * A page's Back: the page it was opened from, as a person would expect
     * with a page reached from several; its parent when that is not known
     * (since Decky started) or is gone.
     */
    async back(pageId: unknown): Promise<DeckConfig> {
        const { pages } = this.profile.config;
        const page = pages.find((p) => p.id === pageId);
        if (!page?.parentId) throw new Error("Page not found.");
        const from = this.cameFrom.get(page.id);
        return this.show(from && pages.some((p) => p.id === from) ? from : page.parentId);
    }

    /** Home, with nothing behind it to go back to: where a deck that started again begins. */
    async home(): Promise<DeckConfig> {
        this.cameFrom.clear();
        return this.show(homePageId(this.profile.config));
    }

    private async show(pageId: unknown): Promise<DeckConfig> {
        const { profile } = this;
        if (typeof pageId !== "string" || !profile.config.pages.some((p) => p.id === pageId))
            throw new Error("Page not found.");
        this.pages.deviceReady = false;
        await this.persist({ ...profile.config, activePageId: pageId });
        return profile.config;
    }

    async runKey(pageId: unknown, cell: unknown): Promise<Reply> {
        if (
            typeof pageId !== "string" ||
            !Number.isInteger(cell) ||
            Number(cell) < 0 ||
            Number(cell) >= 15
        )
            throw new Error("Invalid key.");
        const page = this.profile.config.pages.find((p) => p.id === pageId);
        if (!page) throw new Error("Page not found.");
        if (Number(cell) === BACK_CELL && page.parentId) {
            await this.back(page.id);
            return { ok: true, message: "Back" };
        }
        const key = page.keys[String(cell)];
        if (!key) return { ok: false, message: "Assign an action to this key first." };
        if (key.action.kind === "widget")
            return this.presses.useWidget(page.id, Number(cell), key.action.widget, "tap");
        const reply =
            key.action.kind === "page"
                ? (await this.navigate(key.action.pageId), { ok: true, message: "Page opened." })
                : key.action.kind === "app"
                  ? await this.pressControl(key.action.app, key.action.control)
                  : await this.runner.run(key.action);
        if (this.keyStates.complete(page.id, Number(cell), key, reply.ok)) {
            const display = this.pageSync.showToggles(page.id);
            const displayReply = display && (await display);
            if (displayReply && !displayReply.ok)
                this.window.send("action:activity", {
                    at: Date.now(),
                    label: key.label,
                    ok: false,
                    message: displayReply.message,
                });
        }
        this.window.send("action:activity", { at: Date.now(), label: key.label, ...reply });
        return reply;
    }

    /** A key with an app's control: the app switches it, and its toggle follows (AppControls). */
    private async pressControl(app: IntegrationId, control: string): Promise<Reply> {
        const service: IntegrationService = this.readings.integrations[app];
        return (
            (await service.press?.(control)) ?? { ok: false, message: "That app has no controls." }
        );
    }

    /** A widget's own settings from the deck - a design picked on its key - saved. */
    async setWidget(pageId: string, cell: number, widget: Widget): Promise<void> {
        const { config } = this.profile;
        const page = config.pages.find((item) => item.id === pageId);
        const key = page?.keys[String(cell)];
        if (!page || !key || key.action.kind !== "widget" || key.action.widget.type !== widget.type)
            return;
        await this.persist({
            ...config,
            pages: config.pages.map((item) =>
                item.id === pageId
                    ? {
                          ...item,
                          keys: {
                              ...item.keys,
                              [cell]: { ...key, action: { kind: "widget", widget } },
                          },
                      }
                    : item,
            ),
        });
    }

    /** Move a key onto another cell, or swap it with the key there (keys:move). */
    async move(source: unknown, target: unknown): Promise<DeckConfig> {
        const from = location(source),
            to = location(target);
        const result = moveKey(this.profile.config, from, to);
        return this.persist(result.config, (states) => {
            this.keyStates.move(states, from, to, result.swapped);
            this.widgetStore.move(from, to, result.swapped);
        });
    }

    /** A copy of a key on a free cell of its page (keys:duplicate). */
    async duplicate(source: unknown): Promise<{ config: DeckConfig; cell: number }> {
        const result = duplicateKey(this.profile.config, location(source));
        return { config: await this.persist(result.config), cell: result.cell };
    }

    /**
     * The profile in use as one file: its pages, what the apps it talks to
     * are set to, and the scripts its keys run. Nothing secret goes in
     * (bundle.ts); a script too large or gone is named in the reply.
     */
    /**
     * Any profile as one file - not only the one in use: its pages, what the
     * apps it talks to are set to, and the scripts its keys run. Nothing
     * secret goes in (bundle.ts); a script gone or too large is named in the
     * reply.
     */
    async exportProfile(id?: unknown): Promise<Reply> {
        const which =
            typeof id === "string" && this.profiles.has(id) ? id : this.profiles.active.id;
        const entry = this.profiles.all().find((item) => item.id === which)!;
        const result = await dialog.showSaveDialog(this.window.browserWindow!, {
            defaultPath: `${entry.name.replace(/[<>:"/\\?*|]/g, "-")}${PROFILE_EXTENSION}`,
            filters: [{ name: "Decky profile", extensions: [PROFILE_EXTENSION.slice(1)] }],
        });
        if (!result.filePath) return { ok: false, message: "Export cancelled." };
        // The one in use is freshest in memory; another is read from its folder.
        const config =
            which === this.profiles.active.id
                ? this.profile.config
                : await loadConfig(this.profiles.configPath(which), "");
        const { files, missing } = await readProfileFiles(config);
        const integrations: Record<string, Record<string, string>> = {};
        for (const app of Object.values(INTEGRATIONS))
            integrations[app.id] = await travellingValues(
                this.profiles.integrationPath(app.id, which),
                app,
            );
        const bytes = packBundle({
            meta: { name: entry.name, madeAt: Date.now(), app: appVersion() },
            profile: config,
            integrations,
            files,
        });
        await writeFile(result.filePath, bytes);
        return {
            ok: true,
            message: missing.length
                ? `${entry.name} exported, without ${missing.length} file(s) that are gone or too large.`
                : `${entry.name} exported.`,
        };
    }

    /**
     * Look inside a .deckyprofile: the file is read and held, and what is in
     * it goes to the window to be shown. Nothing is written until the window
     * asks for it (takeProfile). `path` comes from a file opened with Decky;
     * without one, the window is asking to choose a file.
     */
    async inspectFile(path?: unknown): Promise<ProfileReport | null> {
        let file = typeof path === "string" ? path : "";
        if (!file) {
            const result = await dialog.showOpenDialog(this.window.browserWindow!, {
                properties: ["openFile"],
                filters: [{ name: "Decky profile", extensions: [PROFILE_EXTENSION.slice(1)] }],
            });
            file = result.filePaths[0] ?? "";
        }
        if (!file) return null;
        if ((await stat(file)).size > BUNDLE_MAX) throw new Error("That profile is too large.");
        const bundle = unpackBundle(await readFile(file));
        this.waiting = bundle;
        return reportOf(bundle);
    }

    /**
     * A .deckyprofile opened with Decky: looked inside, kept for the window,
     * and offered as soon as there is a window to offer it to.
     */
    async offerFile(path: string): Promise<void> {
        this.offered = await this.inspectFile(path);
        if (this.offered) this.window.sendIfOpen("profiles:offer", this.offered);
    }

    /** The profile waiting to be answered, if one was opened with Decky. */
    waitingProfile(): ProfileReport | null {
        return this.offered;
    }

    /** What another profile of your own holds, before switching to it. */
    async inspectProfile(id: unknown): Promise<ProfileReport> {
        if (typeof id !== "string" || !this.profiles.has(id)) throw new Error("No such profile.");
        const entry = this.profiles.all().find((item) => item.id === id)!;
        const config =
            id === this.profiles.active.id
                ? this.profile.config
                : await loadConfig(this.profiles.configPath(id), "");
        const integrations: Record<string, Record<string, string>> = {};
        for (const app of Object.values(INTEGRATIONS))
            integrations[app.id] = await travellingValues(
                this.profiles.integrationPath(app.id, id),
                app,
            );
        return reportOfProfile(entry.name, config, integrations);
    }

    /**
     * Keep the profile last looked at: it becomes one of your own, under
     * `name` or the one it came with, with its scripts in its own folder and
     * its keys pointing at them there. It never touches the profile in use -
     * the window offers to switch afterwards.
     */
    async takeProfile(name?: unknown): Promise<{ id: string; name: string }> {
        const bundle = this.waiting;
        if (!bundle) throw new Error("Open a profile first.");
        const entry = await this.profiles.add(
            typeof name === "string" && name.trim() ? name : bundle.meta.name,
        );
        const { config } = await placeFiles(bundle, this.profiles.filesFolder(entry.id));
        await saveConfig(this.profiles.configPath(entry.id), config);
        for (const app of Object.values(INTEGRATIONS)) {
            const values = askedValues(app, {}, bundle.integrations[app.id] ?? {});
            if (values)
                await saveIntegrationValues(
                    this.profiles.integrationPath(app.id, entry.id),
                    app,
                    values,
                );
        }
        this.waiting = null;
        this.offered = null;
        this.window.send("profiles:changed", this.profileList());
        return { id: entry.id, name: entry.name };
    }
}

/** Which Decky made a profile, for the file to say. */
function appVersion(): string {
    try {
        return electron.getVersion();
    } catch {
        return "";
    }
}
