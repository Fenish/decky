/*---------------------------------------------------------------
 * The profile in use: saving changes to it, opening its pages and running
 * its keys. Every change goes through persist(), which brings toggle
 * states, widgets and what the deck holds in line with it.
 *--------------------------------------------------------------*/

import { dialog } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { duplicateKey, moveKey } from "../../shared/key-layout";
import type { KeyLocation } from "../../shared/key-layout";
import { BACK_CELL, retireWidgets, validateConfig } from "../../shared/config";
import type { DeckConfig, KeyStates } from "../../shared/config";
import type { Widget } from "../../shared/widgets";
import type { Reply } from "../../shared/api";
import type { IntegrationId } from "../../shared/integrations/integration";
import { toSendKeys } from "../actions/hotkeys";
import type { KeyStateStore } from "../actions/key-state";
import type { ActionRunner } from "../actions/runner";
import type { MainWindow } from "../app/main-window";
import { saveConfig } from "../config/store";
import type { DeckPages } from "../pages/deck-pages";
import type { PageSync } from "../pages/page-sync";
import type { IntegrationService } from "../integrations/integration";
import type { WidgetReadings } from "../widgets/readings";
import type { WidgetPresses } from "../widgets/presses";
import type { WidgetStore } from "../widgets/widget-state";
import type { Profile } from "./profile";

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

    constructor(
        private readonly profile: Profile,
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

    async exportProfile(): Promise<Reply> {
        const result = await dialog.showSaveDialog(this.window.browserWindow!, {
            defaultPath: "Decky-profile.json",
            filters: [{ name: "Decky profile", extensions: ["json"] }],
        });
        if (!result.filePath) return { ok: false, message: "Export cancelled." };
        await writeFile(result.filePath, JSON.stringify(this.profile.config, null, 2), "utf8");
        return { ok: true, message: "Profile exported." };
    }

    async importProfile(): Promise<DeckConfig | null> {
        const result = await dialog.showOpenDialog(this.window.browserWindow!, {
            properties: ["openFile"],
            filters: [{ name: "Decky profile", extensions: ["json"] }],
        });
        const path = result.filePaths[0];
        if (!path) return null;
        if ((await stat(path)).size > 24 * 1024 * 1024) throw new Error("Profile exceeds 24 MB.");
        const next: unknown = JSON.parse(await readFile(path, "utf8"));
        retireWidgets(next);
        validateConfig(next);
        const answer = await dialog.showMessageBox(this.window.browserWindow!, {
            type: "question",
            message: `Replace your pages with ${next.pages.length} imported pages?`,
            detail: "Imported keys can launch programs and scripts when pressed. Your current profile will be backed up automatically.",
            buttons: ["Cancel", "Import profile"],
            defaultId: 0,
            cancelId: 0,
        });
        if (answer.response !== 1) return null;
        await writeFile(
            `${this.profile.path}.before-import-${Date.now()}.json`,
            JSON.stringify(this.profile.config),
            "utf8",
        );
        return this.persist(next);
    }
}
