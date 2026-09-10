import { ChevronRight, Folder, Home, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DeckConfig, DeckPage } from "../../../../shared/config";
export function PagesPanel({
    config,
    onOpen,
    onCreate,
    onRename,
    onDelete,
    onClose,
}: {
    config: DeckConfig;
    onOpen: (id: string) => void;
    onCreate: () => void;
    onRename: (page: DeckPage) => void;
    onDelete: (page: DeckPage) => void;
    onClose: () => void;
}) {
    return (
        <section className="utility-panel" aria-label="Pages">
            <header>
                <h2>Pages</h2>
                <button aria-label="Close pages" onClick={onClose}>
                    <X size={22} />
                </button>
            </header>
            <div className="page-list">
                {config.pages.map((page) => (
                    <div
                        className={`page-list-row ${page.id === config.activePageId ? "active" : ""}`}
                        key={page.id}
                    >
                        <button className="page-open" onClick={() => onOpen(page.id)}>
                            {page.parentId ? <Folder size={20} /> : <Home size={20} />}
                            <span>{page.name}</span>
                            <ChevronRight size={15} />
                        </button>
                        <button
                            title={`Rename ${page.name}`}
                            aria-label={`Rename ${page.name}`}
                            onClick={() => onRename(page)}
                        >
                            <Pencil size={15} />
                        </button>
                        {page.parentId && (
                            <button
                                title={`Delete ${page.name}`}
                                aria-label={`Delete ${page.name}`}
                                onClick={() => onDelete(page)}
                            >
                                <Trash2 size={15} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <button className="add-step" disabled={config.pages.length >= 64} onClick={onCreate}>
                <Plus size={18} />
                Create page
            </button>
        </section>
    );
}
