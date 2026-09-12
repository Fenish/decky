/*---------------------------------------------------------------
 * What is in a profile, said plainly enough to decide by: shown before a
 * .deckyprofile is imported and before another profile is switched to, so
 * nothing arrives unseen.
 *
 * The part that matters is what a key would run. A profile from someone else
 * can point keys at programs and carry scripts of its own, and importing it
 * writes those onto this PC - so every one of them is listed, by the same
 * table that decides what travels (ACTION_FILES).
 *--------------------------------------------------------------*/

import { integrationNamed } from "../../shared/integrations/registry";
import type { DeckConfig } from "../../shared/config";
import { actionFiles } from "../../shared/config";
import type { ProfileReport, ProfileRun } from "../../shared/api";
import { WIDGET_KINDS } from "../../shared/widgets/registry";
import type { WidgetType } from "../../shared/widgets";
import type { ProfileBundle } from "./bundle";

/** What is in a profile: its pages, its widgets, what it would run, what it carries. */
export function reportOf(
    bundle: Pick<ProfileBundle, "meta" | "profile" | "integrations" | "files" | "retired">,
): ProfileReport {
    const { profile } = bundle;
    const carried = new Set(bundle.files.map((file) => file.path));
    const widgets = new Map<string, number>();
    const runs: ProfileRun[] = [];
    let keys = 0;
    for (const page of profile.pages)
        for (const key of Object.values(page.keys)) {
            keys++;
            if (key.action.kind === "widget") {
                const type = key.action.widget.type;
                widgets.set(type, (widgets.get(type) ?? 0) + 1);
            }
            for (const file of actionFiles(key.action))
                if (!runs.some((run) => run.path === file.path))
                    runs.push({
                        path: file.path,
                        // A script travels with the profile; a program is
                        // wherever it is installed on the PC that opens it.
                        kind: file.carried ? "script" : "program",
                        carried: carried.has(file.path),
                    });
        }
    return {
        name: bundle.meta.name,
        madeAt: bundle.meta.madeAt,
        app: bundle.meta.app,
        pages: profile.pages.length,
        keys,
        widgets: [
            ...[...widgets].map(([type, count]) => ({
                type,
                label: WIDGET_KINDS[type as WidgetType]?.label ?? type,
                count,
                retired: false,
            })),
            // The ones this Decky no longer has: their keys will be dropped.
            ...(bundle.retired ?? []).map(({ type, count }) => ({
                type,
                label: type,
                count,
                retired: true,
            })),
        ].sort((a, b) => b.count - a.count),
        runs,
        apps: Object.entries(bundle.integrations).map(([id, values]) => {
            const app = integrationNamed(id);
            return {
                id,
                name: app?.name ?? id,
                settings: Object.values(values).filter((value) => value).length,
                // A password or token never travels; it is typed again here.
                secrets: (app?.fields ?? []).some((field) => field.secret),
            };
        }),
        files: {
            count: bundle.files.length,
            bytes: bundle.files.reduce(
                (sum, file) => sum + Math.ceil((file.body.length * 3) / 4),
                0,
            ),
        },
    };
}

/** The same, for a profile already on this PC: it carries no files of its own. */
export function reportOfProfile(
    name: string,
    config: DeckConfig,
    integrations: Record<string, Record<string, string>>,
): ProfileReport {
    return reportOf({
        meta: { name, madeAt: 0, app: "" },
        profile: config,
        integrations,
        files: [],
    });
}
