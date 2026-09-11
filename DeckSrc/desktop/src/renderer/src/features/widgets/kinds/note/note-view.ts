import type { NoteWidget } from "../../../../../../shared/widgets/note";
import type { WidgetView } from "../widget-view";
import { drawNote } from "./draw-note";
import { noteSettings } from "./note-settings";

export const noteView: WidgetView<NoteWidget> = {
    draw: drawNote,
    settings: noteSettings,
};
