import type { KeyLocation } from "../../../../shared/key-layout";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
    ChevronDown,
    ChevronRight,
    Copy,
    Layers,
    MousePointer2,
    Plus,
    Settings,
    X,
} from "lucide-react";
import type { DeckConfig, DeckPage, KeyConfig, KeyStates } from "../../../../shared/config";
import { BACK_CELL, displayedKey, keyAddress } from "../../../../shared/config";
import { hotkeysInUse } from "../../../../shared/hotkey-pool";
import background from "../../assets/dashboard-obsidian.png";
import { Dialog } from "../../components/dialog";
import { ArtworkPreview } from "../artwork/artwork-preview";
import { KeyEditor } from "../editor/key-editor";
import type { EditorTab } from "../editor/key-editor";
import { PagesPanel } from "./pages-panel";
import { SettingsPanel } from "./settings-panel";
import "./dashboard.css";
interface Selection {
    pageId: string;
    cell: number;
    value: KeyConfig | null;
    dirty: boolean;
}
type PageDialog = { kind: "create" | "rename" | "delete"; page: DeckPage; forKey?: boolean };
interface DashboardProps {
    hidden: boolean;
    config: DeckConfig;
    loaded: boolean;
    busy: boolean;
    pressedCell: number | null;
    keyStates: KeyStates;
    save: (config: DeckConfig) => Promise<void>;
    navigate: (id: string) => Promise<void>;
    sync: () => Promise<void>;
    notify: (message: string) => void;
    message: string;
    clearMessage: () => void;
    onImport: (config: DeckConfig) => void;
    /** Changes when the deck disconnects or comes back running other firmware. */
    firmwareKey: string;
}
/** What the title bar can ask of the dashboard. */
export interface DashboardHandle {
    /** Open Settings at the Updates section. */
    openUpdates(): void;
}
export const Dashboard = forwardRef<DashboardHandle, DashboardProps>(function Dashboard(
    {
        hidden,
        config,
        loaded,
        busy,
        pressedCell,
        keyStates,
        save,
        navigate,
        sync,
        notify,
        message,
        clearMessage,
        onImport,
        firmwareKey,
    }: DashboardProps,
    ref,
) {
    const [panel, setPanel] = useState<"key" | "pages" | "settings">("key");
    // Counts requests to bring the Updates section into view; Settings scrolls on each.
    const [revealUpdates, setRevealUpdates] = useState(0);
    const [panelOpen, setPanelOpen] = useState(false);
    const [previewOn, setPreviewOn] = useState(false);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [dragging, setDragging] = useState<KeyLocation | null>(null);
    const [dropCell, setDropCell] = useState<number | null>(null);
    const [layoutBusy, setLayoutBusy] = useState(false);
    const [tab, setTab] = useState<EditorTab>("action");
    const [pageDialog, setPageDialog] = useState<PageDialog | null>(null);
    const [pageName, setPageName] = useState("");
    const [pending, setPending] = useState<(() => void) | null>(null);
    const page = config.pages.find((item) => item.id === config.activePageId) ?? config.pages[0]!;
    const dirty = selection?.dirty ?? false;
    const folderClick = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (folderClick.current) clearTimeout(folderClick.current);
        },
        [],
    );
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent): void => {
            if (dirty) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const guard = (action: () => void): void => {
        if (dirty) setPending(() => action);
        else action();
    };
    const close = (): void => guard(() => setPanelOpen(false));
    useImperativeHandle(ref, () => ({
        openUpdates: () =>
            guard(() => {
                setPanel("settings");
                setPanelOpen(true);
                setRevealUpdates((count) => count + 1);
            }),
    }));
    const openPage = (id: string): void =>
        guard(() => {
            void navigate(id)
                .then(() => {
                    // The key editor belongs to the page being left; Pages and Settings stay open.
                    if (panel === "key") setPanelOpen(false);
                    setSelection(null);
                })
                .catch((e) => notify(String(e)));
        });
    const select = (cell: number): void => {
        if (cell === BACK_CELL && page.parentId) {
            openPage(page.parentId);
            return;
        }
        if (
            selection?.pageId === page.id &&
            selection.cell === cell &&
            panel === "key" &&
            panelOpen
        )
            return;
        guard(() => {
            setSelection({
                pageId: page.id,
                cell,
                value: page.keys[cell] ? structuredClone(page.keys[cell]) : null,
                dirty: false,
            });
            setPreviewOn(keyStates[keyAddress(page.id, cell)] ?? false);
            setTab("action");
            setPanel("key");
            setPanelOpen(true);
        });
    };
    const utility = (next: "pages" | "settings"): void =>
        guard(() => {
            setPanel(next);
            setPanelOpen(true);
        });
    const createPage = (forKey = false): void => {
        setPageName("");
        setPageDialog({ kind: "create", page, forKey });
    };
    const duplicate = (): void =>
        guard(() => {
            if (!selection || layoutBusy) return;
            setLayoutBusy(true);
            void window.deck
                .duplicateKey({ pageId: selection.pageId, cell: selection.cell })
                .then((result) => {
                    onImport(result.config);
                    const key = result.config.pages.find((item) => item.id === selection.pageId)!
                        .keys[result.cell]!;
                    setSelection({
                        pageId: selection.pageId,
                        cell: result.cell,
                        value: structuredClone(key),
                        dirty: false,
                    });
                    setPanel("key");
                    setPanelOpen(true);
                    notify("Key duplicated");
                })
                .catch((error) => notify(String(error)))
                .finally(() => setLayoutBusy(false));
        });
    const drop = async (from: KeyLocation, to: KeyLocation): Promise<void> => {
        setDragging(null);
        setDropCell(null);
        if (layoutBusy || dirty || (from.pageId === to.pageId && from.cell === to.cell)) return;
        const swapped = Boolean(config.pages.find((item) => item.id === to.pageId)?.keys[to.cell]);
        setLayoutBusy(true);
        try {
            const next = await window.deck.moveKey(from, to);
            onImport(next);
            setSelection((current) => {
                if (!current) return current;
                let target: KeyLocation | null = null;
                if (current.pageId === from.pageId && current.cell === from.cell) target = to;
                else if (swapped && current.pageId === to.pageId && current.cell === to.cell)
                    target = from;
                if (!target) return current;
                return {
                    ...target,
                    value:
                        next.pages.find((item) => item.id === target!.pageId)?.keys[target.cell] ??
                        null,
                    dirty: false,
                };
            });
            notify(swapped ? "Keys swapped" : "Key moved");
        } catch (error) {
            notify(String(error));
        } finally {
            setLayoutBusy(false);
        }
    };
    const updateKey = (value: KeyConfig): void =>
        setSelection((current) => (current ? { ...current, value, dirty: true } : null));
    const saveKey = async (value: KeyConfig): Promise<void> => {
        if (!selection) return;
        const target = selection;
        await save({
            ...config,
            pages: config.pages.map((item) =>
                item.id === target.pageId
                    ? { ...item, keys: { ...item.keys, [target.cell]: value } }
                    : item,
            ),
        });
        setSelection((current) =>
            current?.pageId === target.pageId &&
            current.cell === target.cell &&
            current.value === value
                ? { ...current, dirty: false }
                : current,
        );
    };
    const deleteKey = async (): Promise<void> => {
        if (!selection) return;
        const target = selection;
        await save({
            ...config,
            pages: config.pages.map((item) => {
                if (item.id !== target.pageId) return item;
                const keys = { ...item.keys };
                delete keys[target.cell];
                return { ...item, keys };
            }),
        });
        setSelection({ ...target, value: null, dirty: false });
        setTab("action");
    };
    const commitPage = async (): Promise<void> => {
        if (!pageDialog) return;
        try {
            if (pageDialog.kind === "delete") {
                const removed = new Set([pageDialog.page.id]);
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
                                ([, key]) =>
                                    key.action.kind !== "page" || !removed.has(key.action.pageId),
                            ),
                        ),
                    }));
                await save({
                    ...config,
                    pages,
                    activePageId: removed.has(config.activePageId)
                        ? (pageDialog.page.parentId ?? "home")
                        : config.activePageId,
                });
                if (selection && removed.has(selection.pageId)) setSelection(null);
            } else if (pageDialog.kind === "rename") {
                if (!pageName.trim()) return;
                await save({
                    ...config,
                    pages: config.pages.map((item) =>
                        item.id === pageDialog.page.id ? { ...item, name: pageName.trim() } : item,
                    ),
                });
            } else {
                if (!pageName.trim()) return;
                const id = `page-${crypto.randomUUID()}`;
                await save({
                    ...config,
                    pages: [
                        ...config.pages,
                        { id, name: pageName.trim(), parentId: pageDialog.page.id, keys: {} },
                    ],
                    activePageId: pageDialog.forKey ? config.activePageId : id,
                });
                if (pageDialog.forKey && selection?.value)
                    updateKey({ ...selection.value, action: { kind: "page", pageId: id } });
                else {
                    setPanelOpen(false);
                    setSelection(null);
                }
            }
            setPageDialog(null);
        } catch (error) {
            notify(String(error));
        }
    };
    return (
        <div
            className={`app-shell dashboard-shell ${config.reducedMotion ? "reduce-motion" : ""}`}
            hidden={hidden}
            data-entered={!hidden}
        >
            <img className="dashboard-backdrop" src={background} alt="" draggable={false} />
            <div className="dashboard-header-spacer" aria-hidden="true" />
            <main className={`floating-workspace ${panelOpen ? "editor-open" : ""}`}>
                <div className="floating-deck-group">
                    <section className="floating-deck" aria-label="Deck keys">
                        <div className="deck-toolbar">
                            <div className="page-select">
                                <select
                                    aria-label="Current page"
                                    value={page.id}
                                    disabled={!loaded}
                                    onChange={(e) => openPage(e.target.value)}
                                >
                                    {config.pages.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={18} />
                            </div>
                            <button
                                className="new-page-button"
                                aria-label="Create page"
                                title="Create page"
                                disabled={config.pages.length >= 64 || !loaded}
                                onClick={() => guard(() => createPage())}
                            >
                                <Plus size={25} />
                            </button>
                        </div>
                        <div className="key-grid">
                            {Array.from({ length: 15 }, (_, cell) => {
                                const toggled = keyStates[keyAddress(page.id, cell)] ?? false;
                                const editing =
                                    panelOpen &&
                                    panel === "key" &&
                                    selection?.pageId === page.id &&
                                    selection.cell === cell &&
                                    selection.value !== null;
                                const key = displayedKey(
                                    editing ? selection!.value! : page.keys[cell],
                                    editing && tab === "appearance" ? previewOn : toggled,
                                );
                                const back = cell === BACK_CELL && page.parentId !== null;
                                const selected =
                                    panelOpen &&
                                    panel === "key" &&
                                    selection?.pageId === page.id &&
                                    selection.cell === cell;
                                return (
                                    <button
                                        key={cell}
                                        className={`deck-key ${!key && !back ? "empty" : ""} ${selected ? "selected" : ""} ${toggled ? "toggled" : ""} ${pressedCell === cell ? "pressed" : ""} ${dropCell === cell ? "drop-target" : ""} ${dragging?.pageId === page.id && dragging.cell === cell ? "dragging" : ""}`}
                                        style={
                                            {
                                                "--key-color": key?.color ?? "#eee8da",
                                                "--key-background": key?.background ?? "#000000",
                                                "--key-label-gap": `${key?.labelGap ?? 8}px`,
                                            } as CSSProperties
                                        }
                                        disabled={!loaded || layoutBusy}
                                        draggable={Boolean(key) && !back && !layoutBusy}
                                        onDragStart={(event) => {
                                            if (dirty) {
                                                event.preventDefault();
                                                notify(
                                                    "Save or discard edits before moving a key.",
                                                );
                                                return;
                                            }
                                            if (folderClick.current)
                                                clearTimeout(folderClick.current);
                                            const source = { pageId: page.id, cell };
                                            setDragging(source);
                                            event.dataTransfer.setData(
                                                "application/x-decky-key",
                                                JSON.stringify(source),
                                            );
                                            event.dataTransfer.effectAllowed = "move";
                                        }}
                                        onDragEnd={() => {
                                            setDragging(null);
                                            setDropCell(null);
                                        }}
                                        onDragOver={(event) => {
                                            if (
                                                !back &&
                                                event.dataTransfer.types.includes(
                                                    "application/x-decky-key",
                                                )
                                            ) {
                                                event.preventDefault();
                                                event.dataTransfer.dropEffect = "move";
                                                setDropCell(cell);
                                            }
                                        }}
                                        onDragLeave={(event) => {
                                            if (
                                                !event.currentTarget.contains(
                                                    event.relatedTarget as Node,
                                                )
                                            )
                                                setDropCell(null);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            if (back) return;
                                            try {
                                                const source = JSON.parse(
                                                    event.dataTransfer.getData(
                                                        "application/x-decky-key",
                                                    ),
                                                ) as KeyLocation;
                                                void drop(source, { pageId: page.id, cell });
                                            } catch {
                                                setDragging(null);
                                                setDropCell(null);
                                            }
                                        }}
                                        aria-label={`Key ${cell + 1}: ${back ? "Back" : key ? key.label.trim() || "Unlabelled action" : "Unassigned"}`}
                                        aria-pressed={selected}
                                        onClick={(event) => {
                                            if (key?.action.kind === "page") {
                                                if (folderClick.current)
                                                    clearTimeout(folderClick.current);
                                                if (event.detail < 2)
                                                    folderClick.current = setTimeout(
                                                        () => select(cell),
                                                        300,
                                                    );
                                            } else select(cell);
                                        }}
                                        onDoubleClick={() => {
                                            if (folderClick.current)
                                                clearTimeout(folderClick.current);
                                            if (key?.action.kind === "page")
                                                openPage(key.action.pageId);
                                        }}
                                    >
                                        {key ? (
                                            <ArtworkPreview value={key} />
                                        ) : back ? (
                                            <ArtworkPreview
                                                value={{
                                                    label: "Back",
                                                    icon: "back",
                                                    color: "#eee8da",
                                                }}
                                            />
                                        ) : null}
                                        {key?.action.kind === "page" && (
                                            <ChevronRight size={13} className="folder-corner" />
                                        )}
                                        {key?.behavior === "toggle" && (
                                            <span className={`key-state ${toggled ? "on" : ""}`}>
                                                {toggled ? "ON" : "OFF"}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                    <nav className="deck-dock" aria-label="Workspace tools">
                        <button
                            aria-label="Edit keys"
                            title="Edit keys"
                            className={!panelOpen ? "active" : ""}
                            onClick={close}
                        >
                            <MousePointer2 size={24} />
                        </button>
                        <button
                            aria-label="Duplicate key"
                            title="Duplicate selected key"
                            disabled={
                                !panelOpen ||
                                panel !== "key" ||
                                !selection ||
                                !config.pages.find((item) => item.id === selection.pageId)?.keys[
                                    selection.cell
                                ] ||
                                layoutBusy
                            }
                            onClick={duplicate}
                        >
                            <Copy size={23} />
                        </button>
                        <button
                            aria-label="Manage pages"
                            title="Manage pages"
                            className={panelOpen && panel === "pages" ? "active" : ""}
                            onClick={() => utility("pages")}
                        >
                            <Layers size={24} />
                        </button>
                        <button
                            aria-label="Settings"
                            title="Settings"
                            className={panelOpen && panel === "settings" ? "active" : ""}
                            onClick={() => utility("settings")}
                        >
                            <Settings size={24} />
                        </button>
                    </nav>
                </div>
                <div className="editor-slot" aria-hidden={!panelOpen}>
                    {panel === "key" && selection ? (
                        <KeyEditor
                            key={`${selection.pageId}:${selection.cell}`}
                            value={selection.value}
                            previewOn={
                                tab === "appearance"
                                    ? previewOn
                                    : (keyStates[keyAddress(selection.pageId, selection.cell)] ??
                                      false)
                            }
                            onPreviewOnChange={setPreviewOn}
                            assigned={Boolean(
                                config.pages.find((item) => item.id === selection.pageId)?.keys[
                                    selection.cell
                                ],
                            )}
                            pages={config.pages}
                            pageId={selection.pageId}
                            reservedHotkeys={hotkeysInUse(config, selection)}
                            tab={tab}
                            onTab={setTab}
                            onChange={updateKey}
                            onClose={close}
                            onCreatePage={() => createPage(true)}
                            onSave={async (value) => {
                                await saveKey(value);
                                notify("Saved");
                            }}
                            onTest={async (value) => {
                                await saveKey(value);
                                const reply = await window.deck.runKey(
                                    selection.pageId,
                                    selection.cell,
                                );
                                const states = await window.deck.getKeyStates();
                                setPreviewOn(
                                    states[keyAddress(selection.pageId, selection.cell)] ?? false,
                                );
                                notify(reply.message);
                            }}
                            onRemove={deleteKey}
                            onError={notify}
                        />
                    ) : panel === "pages" ? (
                        <PagesPanel
                            config={config}
                            onOpen={openPage}
                            onCreate={() => createPage()}
                            onRename={(item) => {
                                setPageName(item.name);
                                setPageDialog({ kind: "rename", page: item });
                            }}
                            onDelete={(item) => setPageDialog({ kind: "delete", page: item })}
                            onClose={close}
                        />
                    ) : panel === "settings" ? (
                        <SettingsPanel
                            config={config}
                            busy={busy}
                            save={save}
                            onImport={(next) => {
                                onImport(next);
                                setSelection(null);
                            }}
                            sync={sync}
                            onClose={close}
                            notify={notify}
                            firmwareKey={firmwareKey}
                            revealUpdates={revealUpdates}
                        />
                    ) : null}
                </div>
            </main>
            {message && (
                <div className="toast" role="status">
                    <span>{message}</span>
                    <button aria-label="Dismiss notification" onClick={clearMessage}>
                        <X size={17} />
                    </button>
                </div>
            )}
            {!hidden && pending && (
                <Dialog title="Discard changes?" onClose={() => setPending(null)}>
                    <p>This key has unsaved changes.</p>
                    <div className="dialog-actions">
                        <button className="button" onClick={() => setPending(null)}>
                            Keep editing
                        </button>
                        <button
                            className="button primary"
                            onClick={() => {
                                setSelection((current) =>
                                    current
                                        ? {
                                              ...current,
                                              value:
                                                  config.pages.find(
                                                      (item) => item.id === current.pageId,
                                                  )?.keys[current.cell] ?? null,
                                              dirty: false,
                                          }
                                        : null,
                                );
                                setPending(null);
                                pending();
                            }}
                        >
                            Discard
                        </button>
                    </div>
                </Dialog>
            )}
            {!hidden && pageDialog && (
                <Dialog
                    title={
                        pageDialog.kind === "create"
                            ? "Create page"
                            : pageDialog.kind === "rename"
                              ? "Rename page"
                              : `Delete ${pageDialog.page.name}?`
                    }
                    onClose={() => setPageDialog(null)}
                >
                    {pageDialog.kind === "delete" ? (
                        <>
                            <p>Its subpages and keys linking to them will also be removed.</p>
                            <div className="dialog-actions">
                                <button className="button" onClick={() => setPageDialog(null)}>
                                    Cancel
                                </button>
                                <button className="button danger" onClick={() => void commitPage()}>
                                    Delete page
                                </button>
                            </div>
                        </>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void commitPage();
                            }}
                        >
                            <label className="field">
                                Page name
                                <input
                                    autoFocus
                                    maxLength={40}
                                    value={pageName}
                                    placeholder="OBS, Work, Music…"
                                    onChange={(e) => setPageName(e.target.value)}
                                />
                            </label>
                            <div className="dialog-actions">
                                <button
                                    type="button"
                                    className="button"
                                    onClick={() => setPageDialog(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="button primary"
                                    disabled={!pageName.trim()}
                                >
                                    {pageDialog.kind === "create" ? "Create page" : "Rename"}
                                </button>
                            </div>
                        </form>
                    )}
                </Dialog>
            )}
        </div>
    );
});
