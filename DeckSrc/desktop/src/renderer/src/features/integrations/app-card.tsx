import { useState } from "react";
import { Settings } from "lucide-react";
import type {
    IntegrationButton,
    IntegrationId,
    IntegrationStatus,
} from "../../../../shared/integrations/integration";
import { INTEGRATIONS } from "../../../../shared/integrations/registry";
import { errorText } from "../../app/error-text";
import { Dialog } from "../../components/dialog";
import { IntegrationStatusText, useIntegrationStatus } from "./integration-status";

/**
 * An app's connection in one line - how Decky stands with it, in brief - and
 * the button for that standing, as the app declares it: start the app while
 * it is closed, get it while it is missing, ask its permission, else its
 * settings (ConnectDialog). Beside a button that does something else, a small
 * one opens the settings, for an app that has any. It sits at the top of the
 * app's page in the picker and in its keys' editor.
 */
export function AppCard({ id }: { id: IntegrationId }) {
    const app = INTEGRATIONS[id];
    const [status, setStatus] = useIntegrationStatus(id);
    const [editing, setEditing] = useState(false);
    // What the app is being asked while it answers, said in the line.
    const [busy, setBusy] = useState("");
    // Why that did not work, until the next try.
    const [note, setNote] = useState("");
    const button = status && app.buttons[status.health];
    /** Ask the app something that takes a while: `saying` meanwhile, a note if it fails. */
    const ask = (saying: string, asked: () => Promise<{ ok: boolean; message: string }>): void => {
        setBusy(saying);
        setNote("");
        asked()
            .then((reply) => setNote(reply.ok ? "" : reply.message))
            .catch((error) => setNote(errorText(error)))
            .finally(() => setBusy(""));
    };
    const does: Record<IntegrationButton["does"], () => void> = {
        settings: () => setEditing(true),
        download: () => {
            window.deck.integrationDownload(id).catch((error) => setNote(errorText(error)));
        },
        open: () => ask(`Starting ${app.name}…`, () => window.deck.integrationOpen(id)),
        authorize: () =>
            ask(`Click Authorize in ${app.name}…`, () => window.deck.integrationAuthorize(id)),
    };
    return (
        <section className="app-card" aria-label={`${app.name} connection`}>
            <p
                className="app-status"
                data-health={(!busy && status?.health) || "checking"}
                role="status"
            >
                <span>
                    {busy ||
                        (status
                            ? app.brief[status.health](status.version)
                            : `Looking for ${app.name}…`)}
                </span>
            </p>
            {button && (
                <button
                    className={`button app-connect${button.does === "settings" || status.health === "ready" ? "" : " primary"}`}
                    disabled={!!busy}
                    onClick={does[button.does]}
                >
                    {button.label}
                </button>
            )}
            {button && button.does !== "settings" && app.fields.length > 0 && (
                <button
                    className="button app-gear"
                    aria-label={`${app.name} settings`}
                    title="Settings"
                    onClick={does.settings}
                >
                    <Settings size={15} />
                </button>
            )}
            {note && (
                <p className="app-note" role="alert">
                    {note}
                </p>
            )}
            {editing && (
                <ConnectDialog
                    id={id}
                    status={status}
                    onStatus={setStatus}
                    onClose={() => setEditing(false)}
                />
            )}
        </section>
    );
}

/**
 * An app's settings: how Decky stands with it and what to do about it, its
 * fields, and Save and connect, which closes the dialog once connected. A
 * secret is never shown again: left empty it keeps the one saved.
 */
function ConnectDialog({
    id,
    status,
    onStatus,
    onClose,
}: {
    id: IntegrationId;
    status: IntegrationStatus | null;
    onStatus: (status: IntegrationStatus) => void;
    onClose: () => void;
}) {
    const app = INTEGRATIONS[id];
    // What is typed; text fields show what is saved until then.
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const text = (key: string): string => typed[key] ?? status?.values[key] ?? "";
    const save = async (clearing?: string): Promise<void> => {
        setBusy(true);
        setMessage("");
        try {
            const values = Object.fromEntries(
                app.fields.map(({ key, secret }) => [
                    key,
                    secret ? (key === clearing ? "" : typed[key] || null) : text(key),
                ]),
            );
            const next = await window.deck.integrationSave(id, values);
            onStatus(next);
            setTyped({});
            if (next.health === "ready" && !clearing) onClose();
        } catch (error) {
            setMessage(errorText(error));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog title={`Connect ${app.name}`} onClose={onClose}>
            <IntegrationStatusText id={id} status={status} />
            <form
                className="app-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                {app.fields.map((field) => (
                    <label className="field" key={field.key}>
                        {field.label}
                        <input
                            aria-label={`${app.name} ${field.label.toLowerCase()}`}
                            type={field.secret ? "password" : "text"}
                            autoComplete="off"
                            maxLength={field.maxLength}
                            value={field.secret ? (typed[field.key] ?? "") : text(field.key)}
                            placeholder={
                                field.secret
                                    ? status?.saved[field.key]
                                        ? "Saved - type to replace"
                                        : "None"
                                    : field.placeholder
                            }
                            disabled={busy}
                            onChange={(event) =>
                                setTyped((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                }))
                            }
                        />
                        {field.secret && status?.saved[field.key] && (
                            <button
                                type="button"
                                className="app-clear"
                                disabled={busy}
                                onClick={() => void save(field.key)}
                            >
                                Clear the saved {field.label.toLowerCase()}
                            </button>
                        )}
                    </label>
                ))}
                <p className="app-help">{app.help}</p>
                {message && (
                    <p className="app-help app-message" role="alert">
                        {message}
                    </p>
                )}
                <div className="dialog-actions">
                    <button type="button" className="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="button primary" disabled={busy}>
                        {busy ? "Connecting…" : "Save and connect"}
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
