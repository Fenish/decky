import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
    title,
    children,
    onClose,
}: {
    title: string;
    children: ReactNode;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);
    return (
        <dialog
            className="workspace-dialog"
            ref={ref}
            aria-label={title}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <button className="dialog-close" aria-label="Close dialog" onClick={onClose}>
                <X size={20} />
            </button>
            <h2>{title}</h2>
            {children}
        </dialog>
    );
}
