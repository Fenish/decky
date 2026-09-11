import { text } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

export type NoteSize = "small" | "medium" | "large";

export type NoteWidget = {
    type: "note";
    text: string;
    size: NoteSize;
};

export const noteKind: WidgetKind<NoteWidget> = {
    type: "note",
    label: "Note",
    icon: "StickyNote",
    words: "text memo",
    defaults: () => ({ type: "note", text: "Note", size: "medium" }),
    valid: (w) => text(w.text, 120) && ["small", "medium", "large"].includes(String(w.size)),
};
