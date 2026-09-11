import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, FolderOpen, LoaderCircle } from "lucide-react";
import type { Step } from "../../../../shared/config";
import { matchPrograms, programDisplayName } from "../../../../shared/programs";
import type { InstalledProgram } from "../../../../shared/programs";
import "./program-picker.css";
type ProgramStep = Extract<Step, { kind: "program" }>;
interface PopupPosition {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
}
export function ProgramPicker({
    step,
    onChange,
    onError,
}: {
    step: ProgramStep;
    onChange: (step: ProgramStep) => void;
    onError: (message: string) => void;
}) {
    const [programs, setPrograms] = useState<InstalledProgram[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState(0);
    const [position, setPosition] = useState<PopupPosition | null>(null);
    const anchor = useRef<HTMLDivElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const id = useId();
    const query = step.name ?? programDisplayName(step.path);
    const results = useMemo(() => matchPrograms(programs, query), [programs, query]);
    const visible = results.slice(0, 80);
    useEffect(() => {
        if (!open) return;
        let live = true;
        void window.deck
            .listPrograms()
            .then((items) => {
                if (live) {
                    setPrograms(items);
                    setLoading(false);
                    setFailed(false);
                }
            })
            .catch((error) => {
                if (live) {
                    setLoading(false);
                    setFailed(true);
                    onError(String(error));
                }
            });
        const place = (): void => {
            const rect = anchor.current?.getBoundingClientRect();
            if (!rect || rect.width < 1) {
                setOpen(false);
                return;
            }
            const width = Math.min(Math.max(rect.width, 310), window.innerWidth - 24);
            const roomBelow = window.innerHeight - rect.bottom - 14;
            const height = Math.min(
                320,
                Math.max(140, roomBelow < 180 ? rect.top - 16 : roomBelow),
            );
            setPosition({
                left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
                top: roomBelow < 180 ? Math.max(10, rect.top - height - 6) : rect.bottom + 6,
                width,
                maxHeight: height,
            });
        };
        place();
        const observer = new ResizeObserver(place);
        if (anchor.current) observer.observe(anchor.current);
        const outside = (event: PointerEvent): void => {
            if (
                !anchor.current?.contains(event.target as Node) &&
                !popup.current?.contains(event.target as Node)
            )
                setOpen(false);
        };
        document.addEventListener("pointerdown", outside);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            live = false;
            observer.disconnect();
            document.removeEventListener("pointerdown", outside);
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open, onError]);
    useEffect(() => {
        if (open)
            popup.current
                ?.querySelector(`[data-index="${active}"]`)
                ?.scrollIntoView({ block: "nearest" });
    }, [active, open]);
    const choose = (program: InstalledProgram): void => {
        onChange({ kind: "program", path: program.path, name: program.name });
        setOpen(false);
    };
    const browse = async (): Promise<void> => {
        setOpen(false);
        try {
            const path = await window.deck.pickTarget("program");
            if (path) onChange({ kind: "program", path, name: programDisplayName(path) });
        } catch (error) {
            onError(String(error));
        }
    };
    const show = (): void => {
        setLoading(programs.length === 0);
        setActive(0);
        setOpen(true);
    };
    // The keys that work the list from the search field; any other key just types.
    const keys: Record<string, (event: KeyboardEvent<HTMLInputElement>) => void> = {
        Escape: (event) => {
            event.preventDefault();
            setOpen(false);
        },
        ArrowDown: (event) => {
            event.preventDefault();
            if (!open) show();
            else setActive((index) => Math.min(index + 1, Math.max(0, visible.length - 1)));
        },
        ArrowUp: (event) => {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
        },
        Enter: (event) => {
            if (open && visible[active]) {
                event.preventDefault();
                choose(visible[active]);
            }
        },
    };
    return (
        <div className="program-picker" ref={anchor}>
            <div className="control-field">
                <input
                    ref={input}
                    role="combobox"
                    aria-label="Search programs"
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls={open ? `${id}-list` : undefined}
                    aria-activedescendant={open && visible[active] ? `${id}-${active}` : undefined}
                    value={query}
                    placeholder="Search apps…"
                    title={step.path || "Search installed apps"}
                    onFocus={show}
                    onChange={(event) => {
                        onChange({ kind: "program", path: "", name: event.target.value });
                        setActive(0);
                        if (!open) show();
                    }}
                    onBlur={() => {
                        setTimeout(() => {
                            if (
                                !popup.current?.contains(document.activeElement) &&
                                !anchor.current?.contains(document.activeElement)
                            )
                                setOpen(false);
                        }, 0);
                    }}
                    onKeyDown={(event) => {
                        if (Object.hasOwn(keys, event.key)) keys[event.key]!(event);
                    }}
                />
                {step.path && <Check className="program-selected" size={14} />}
                <button
                    aria-label="Browse files"
                    title="Browse for a program"
                    onClick={() => void browse()}
                >
                    <FolderOpen size={18} />
                </button>
            </div>
            {open &&
                position &&
                createPortal(
                    <div
                        className="program-menu"
                        ref={popup}
                        style={position}
                        role="listbox"
                        id={`${id}-list`}
                        aria-label="Installed applications"
                    >
                        {loading ? (
                            <div className="program-menu-message">
                                <LoaderCircle className="spin" size={16} />
                                Loading apps…
                            </div>
                        ) : visible.length ? (
                            visible.map((program, index) => (
                                <button
                                    type="button"
                                    role="option"
                                    id={`${id}-${index}`}
                                    data-index={index}
                                    aria-selected={active === index}
                                    className={active === index ? "active" : ""}
                                    key={program.path}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => choose(program)}
                                >
                                    <ProgramIcon program={program} />
                                    <span>
                                        <strong>{program.name}</strong>
                                        <small>
                                            {program.source === "windows"
                                                ? "Windows app"
                                                : program.path}
                                        </small>
                                    </span>
                                </button>
                            ))
                        ) : (
                            <div className="program-menu-message">
                                {failed
                                    ? "App search unavailable. Use Browse."
                                    : "No matching apps"}
                            </div>
                        )}
                        {results.length > 80 && (
                            <div className="program-menu-footer">
                                {results.length} matches · keep typing
                            </div>
                        )}
                    </div>,
                    document.body,
                )}
        </div>
    );
}

function ProgramIcon({ program }: { program: InstalledProgram }) {
    const [icon, setIcon] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        void window.deck
            .programIcon(program.path)
            .then((value) => {
                if (live) setIcon(value);
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [program.path]);
    return icon ? (
        <img className="installed-program-icon" src={icon} alt="" draggable={false} />
    ) : (
        <span className="installed-program-initial" aria-hidden="true">
            {program.name.slice(0, 1).toLocaleUpperCase()}
        </span>
    );
}
