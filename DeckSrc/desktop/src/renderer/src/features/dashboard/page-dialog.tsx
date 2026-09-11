import type { DeckConfig, DeckPage } from "../../../../shared/config";
import { Dialog } from "../../components/dialog";
export type PageDialog = { kind: "create" | "rename" | "delete"; page: DeckPage; forKey?: boolean };
/**
 * The profile without `page`, its subpages, or any key that opens one of
 * them, since the profile refuses a key that opens a missing page. If the page
 * on show goes, the deleted page's parent shows instead.
 */
export function withoutPage(
    config: DeckConfig,
    page: DeckPage,
): { config: DeckConfig; removed: Set<string> } {
    const removed = new Set([page.id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of config.pages)
            if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
                removed.add(item.id);
                changed = true;
            }
    }
    const pages = config.pages
        .filter((item) => !removed.has(item.id))
        .map((item) => ({
            ...item,
            keys: Object.fromEntries(
                Object.entries(item.keys).filter(
                    ([, key]) => key.action.kind !== "page" || !removed.has(key.action.pageId),
                ),
            ),
        }));
    return {
        config: {
            ...config,
            pages,
            activePageId: removed.has(config.activePageId)
                ? (page.parentId ?? "home")
                : config.activePageId,
        },
        removed,
    };
}
/** Asks for a new page's name or a new name for one, or confirms a delete. */
export function ManagePageDialog({
    dialog,
    name,
    onNameChange,
    onCommit,
    onClose,
}: {
    dialog: PageDialog;
    name: string;
    onNameChange: (name: string) => void;
    onCommit: () => Promise<void>;
    onClose: () => void;
}) {
    return (
        <Dialog
            title={
                dialog.kind === "create"
                    ? "Create page"
                    : dialog.kind === "rename"
                      ? "Rename page"
                      : `Delete ${dialog.page.name}?`
            }
            onClose={onClose}
        >
            {dialog.kind === "delete" ? (
                <>
                    <p>Its subpages and keys linking to them will also be removed.</p>
                    <div className="dialog-actions">
                        <button className="button" onClick={() => onClose()}>
                            Cancel
                        </button>
                        <button className="button danger" onClick={() => void onCommit()}>
                            Delete page
                        </button>
                    </div>
                </>
            ) : (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void onCommit();
                    }}
                >
                    <label className="field">
                        Page name
                        <input
                            autoFocus
                            maxLength={40}
                            value={name}
                            placeholder="OBS, Work, Music…"
                            onChange={(e) => onNameChange(e.target.value)}
                        />
                    </label>
                    <div className="dialog-actions">
                        <button type="button" className="button" onClick={() => onClose()}>
                            Cancel
                        </button>
                        <button type="submit" className="button primary" disabled={!name.trim()}>
                            {dialog.kind === "create" ? "Create page" : "Rename"}
                        </button>
                    </div>
                </form>
            )}
        </Dialog>
    );
}
