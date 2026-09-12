/*---------------------------------------------------------------
 * Profiles: the setups on this PC, one in use. Switching to another, and
 * importing a .deckyprofile, both go the same way - what is in it is shown
 * first, and nothing happens until it is agreed to.
 *--------------------------------------------------------------*/

import { useCallback, useEffect, useState } from "react";
import {
    AlertTriangle,
    Check,
    Download,
    FileInput,
    Pencil,
    Plus,
    Terminal,
    Trash2,
    User,
    X,
} from "lucide-react";
import type { ProfileReport, ProfileSet } from "../../../../shared/api";

/** What the panel is doing: listing, or showing what is in something. */
type Looking =
    | { at: "list" }
    | { at: "profile"; id: string; name: string; report: ProfileReport }
    | { at: "file"; report: ProfileReport };

/** How long the bin stays armed before it forgets it was pressed. */
const ARM_MS = 4000;

const when = (at: number): string =>
    at ? new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";

/** Bytes as a person reads them. */
const size = (bytes: number): string =>
    bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function ProfilesPanel({
    offered,
    notify,
    onSwitched,
    onClose,
}: {
    /** A .deckyprofile opened with Decky, shown as soon as the panel opens. */
    offered: ProfileReport | null;
    notify: (message: string) => void;
    /** A profile was switched to: the dashboard takes the new pages. */
    onSwitched: () => void;
    onClose: () => void;
}) {
    const [set, setSet] = useState<ProfileSet>({ active: "", profiles: [] });
    const [looking, setLooking] = useState<Looking>({ at: "list" });
    const [busy, setBusy] = useState(false);
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
    // A profile takes two presses to delete: the bin arms, and a tick asks to
    // be sure. It disarms itself, so a stray press is never a deletion.
    const [arming, setArming] = useState<string | null>(null);
    const [calling, setCalling] = useState("");
    useEffect(() => {
        if (!arming) return;
        const timer = setTimeout(() => setArming(null), ARM_MS);
        return () => clearTimeout(timer);
    }, [arming]);

    const refresh = useCallback(() => {
        void window.deck
            .profiles()
            .then(setSet)
            .catch((error: unknown) => notify(String(error)));
    }, [notify]);
    useEffect(refresh, [refresh]);
    useEffect(() => window.deck.onProfiles(setSet), []);
    // A file opened with Decky: the panel shows what is in it, once. Closing
    // it goes back to the list rather than opening it again.
    const [answered, setAnswered] = useState<ProfileReport | null>(null);
    if (offered !== answered) {
        setAnswered(offered);
        if (offered) {
            setLooking({ at: "file", report: offered });
            setCalling(offered.name);
        }
    }

    /** Anything that may fail, with the panel held while it runs. */
    const run = async (what: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await what();
        } catch (error) {
            notify(String(error));
        } finally {
            setBusy(false);
        }
    };

    const inspect = (id: string, name: string): Promise<void> =>
        run(async () => {
            const report = await window.deck.inspectProfile(id);
            setLooking({ at: "profile", id, name, report });
        });

    const openFile = (): Promise<void> =>
        run(async () => {
            const report = await window.deck.inspectProfileFile();
            if (!report) return;
            setLooking({ at: "file", report });
            setCalling(report.name);
        });

    const switchTo = (id: string): Promise<void> =>
        run(async () => {
            await window.deck.useProfile(id);
            setLooking({ at: "list" });
            onSwitched();
        });

    const keep = (): Promise<void> =>
        run(async () => {
            const added = await window.deck.takeProfile(calling);
            // Straight to what was added, where the switch is one press away.
            setLooking({
                at: "profile",
                id: added.id,
                name: added.name,
                report: await window.deck.inspectProfile(added.id),
            });
            notify(`${added.name} added.`);
        });

    const exportOne = (id: string): void =>
        void window.deck
            .exportConfig(id)
            .then((reply) => notify(reply.message))
            .catch((error: unknown) => notify(String(error)));

    if (looking.at !== "list") {
        const { report } = looking;
        const mine = looking.at === "profile";
        return (
            <section className="utility-panel" aria-label="Profile contents">
                <header>
                    <h2>{report.name}</h2>
                    <button
                        aria-label="Back to profiles"
                        onClick={() => setLooking({ at: "list" })}
                    >
                        <X size={22} />
                    </button>
                </header>
                <div className="profile-report">
                    <p className="profile-summary">
                        {report.pages} page{report.pages === 1 ? "" : "s"}, {report.keys} key
                        {report.keys === 1 ? "" : "s"}
                        {report.madeAt ? ` · exported ${when(report.madeAt)}` : ""}
                        {report.app ? ` by Decky ${report.app}` : ""}
                    </p>
                    {report.widgets.length > 0 && (
                        <div className="profile-part">
                            <h3>Widgets</h3>
                            <ul>
                                {report.widgets.map((widget) => (
                                    <li key={widget.type} className={widget.retired ? "gone" : ""}>
                                        <span>
                                            {widget.count} × {widget.label}
                                        </span>
                                        {widget.retired && (
                                            <em>
                                                <AlertTriangle size={13} /> no longer in Decky,
                                                these keys are dropped
                                            </em>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {report.runs.length > 0 && (
                        <div className="profile-part">
                            <h3>What its keys run</h3>
                            <ul>
                                {report.runs.map((run) => (
                                    <li key={run.path}>
                                        <span title={run.path}>
                                            <Terminal size={13} /> {run.path}
                                        </span>
                                        <em>
                                            {run.kind === "program"
                                                ? "program on this PC"
                                                : run.carried
                                                  ? "script, carried"
                                                  : "script, not carried"}
                                        </em>
                                    </li>
                                ))}
                            </ul>
                            {!mine && (
                                <p className="profile-warning">
                                    <AlertTriangle size={14} /> A profile can point keys at programs
                                    and bring scripts of its own. Import one only from someone you
                                    trust.
                                </p>
                            )}
                        </div>
                    )}
                    {report.apps.some((app) => app.settings || app.secrets) && (
                        <div className="profile-part">
                            <h3>Apps</h3>
                            <ul>
                                {report.apps.map((app) => (
                                    <li key={app.id}>
                                        <span>{app.name}</span>
                                        <em>
                                            {app.settings
                                                ? `${app.settings} setting${app.settings === 1 ? "" : "s"}`
                                                : "not set up"}
                                            {app.secrets ? " · password typed again here" : ""}
                                        </em>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {report.files.count > 0 && (
                        <p className="profile-summary">
                            Carries {report.files.count} file
                            {report.files.count === 1 ? "" : "s"}, {size(report.files.bytes)}.
                        </p>
                    )}
                </div>
                {mine ? (
                    <button
                        className="add-step"
                        disabled={busy || looking.id === set.active}
                        onClick={() => void switchTo(looking.id)}
                    >
                        <Check size={18} />
                        {looking.id === set.active ? "In use" : `Switch to ${looking.name}`}
                    </button>
                ) : (
                    <>
                        <label className="profile-name">
                            Call it
                            <input
                                aria-label="Name for the imported profile"
                                value={calling}
                                maxLength={40}
                                placeholder={report.name}
                                onChange={(event) => setCalling(event.target.value)}
                            />
                        </label>
                        <button className="add-step" disabled={busy} onClick={() => void keep()}>
                            <Plus size={18} />
                            Add as a profile
                        </button>
                    </>
                )}
            </section>
        );
    }

    return (
        <section className="utility-panel" aria-label="Profiles">
            <header>
                <h2>Profiles</h2>
                <button aria-label="Close profiles" onClick={onClose}>
                    <X size={22} />
                </button>
            </header>
            {arming && (
                <p className="profile-warning">
                    <AlertTriangle size={14} /> Deleting a profile also removes the scripts it
                    brought with it. Press the tick to be sure.
                </p>
            )}
            <div className="page-list">
                {set.profiles.map((item) => (
                    <div
                        className={`page-list-row ${item.id === set.active ? "active" : ""}`}
                        key={item.id}
                    >
                        {renaming?.id === item.id ? (
                            <input
                                autoFocus
                                aria-label={`Name for ${item.name}`}
                                value={renaming.name}
                                maxLength={40}
                                onChange={(event) =>
                                    setRenaming({ id: item.id, name: event.target.value })
                                }
                                onBlur={() => {
                                    const { id, name } = renaming;
                                    setRenaming(null);
                                    void run(async () => {
                                        setSet(await window.deck.renameProfile(id, name));
                                    });
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                    if (event.key === "Escape") setRenaming(null);
                                }}
                            />
                        ) : (
                            <button
                                className="page-open"
                                disabled={busy}
                                onClick={() => void inspect(item.id, item.name)}
                            >
                                <User size={20} />
                                <span>{item.name}</span>
                                <small>
                                    {item.id === set.active ? "in use" : when(item.usedAt)}
                                </small>
                            </button>
                        )}
                        <button
                            title={`Export ${item.name}`}
                            aria-label={`Export ${item.name}`}
                            onClick={() => exportOne(item.id)}
                        >
                            <Download size={15} />
                        </button>
                        <button
                            title={`Rename ${item.name}`}
                            aria-label={`Rename ${item.name}`}
                            onClick={() => setRenaming({ id: item.id, name: item.name })}
                        >
                            <Pencil size={15} />
                        </button>
                        {item.id !== set.active && set.profiles.length > 1 && (
                            <button
                                className={arming === item.id ? "arming" : ""}
                                title={
                                    arming === item.id
                                        ? `Delete ${item.name} for good`
                                        : `Delete ${item.name}`
                                }
                                aria-label={
                                    arming === item.id
                                        ? `Confirm deleting ${item.name}`
                                        : `Delete ${item.name}`
                                }
                                onClick={() => {
                                    if (arming !== item.id) {
                                        setArming(item.id);
                                        return;
                                    }
                                    setArming(null);
                                    void run(async () => {
                                        setSet(await window.deck.removeProfile(item.id));
                                    });
                                }}
                            >
                                {arming === item.id ? <Check size={15} /> : <Trash2 size={15} />}
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <div className="settings-actions profile-actions">
                <button
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            setSet(await window.deck.addProfile("New profile"));
                        })
                    }
                >
                    <Plus size={19} />
                    Add profile
                </button>
                <button disabled={busy} onClick={() => void openFile()}>
                    <FileInput size={19} />
                    Import
                </button>
            </div>
        </section>
    );
}
