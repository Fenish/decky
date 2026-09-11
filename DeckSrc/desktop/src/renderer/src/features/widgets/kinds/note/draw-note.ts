import type { NoteWidget } from "../../../../../../shared/widgets/note";
import { FONT } from "../../canvas-kit";
import type { Area } from "../../canvas-kit";
import type { WidgetLook } from "../../draw-widget";

export function drawNote(
    ctx: CanvasRenderingContext2D,
    widget: NoteWidget,
    look: WidgetLook,
    area: Area,
): void {
    const share = { small: 0.13, medium: 0.17, large: 0.24 }[widget.size];
    const size = Math.round(Math.min(area.w, area.h) * share);
    ctx.fillStyle = look.color;
    ctx.font = `600 ${size}px ${FONT}`;
    const width = area.w * 0.86;
    const lines: string[] = [];
    for (const paragraph of widget.text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > width && line) {
                lines.push(line);
                line = word;
            } else line = next;
        }
        lines.push(line);
    }
    const height = size * 1.2;
    const fits = Math.max(1, Math.floor((area.h * 0.9) / height));
    const shown = lines.slice(0, fits);
    const start = area.y + area.h / 2 - ((shown.length - 1) * height) / 2;
    shown.forEach((line, index) =>
        ctx.fillText(line, area.x + area.w / 2, start + index * height, width),
    );
}
