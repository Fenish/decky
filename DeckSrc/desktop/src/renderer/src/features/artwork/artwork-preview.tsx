import { useEffect, useRef } from "react";
import type { KeyAppearance } from "../../../../shared/config";
import { renderKey } from "./artwork";
export function ArtworkPreview({ value }: { value: KeyAppearance }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const { label, icon, color, background, labelGap, artwork } = value;
    useEffect(() => {
        let live = true;
        void renderKey({ label, icon, color, background, labelGap, artwork }, 240, 240)
            .then((canvas) => {
                if (live) {
                    const context = ref.current?.getContext("2d");
                    context?.clearRect(0, 0, 240, 240);
                    context?.drawImage(canvas, 0, 0);
                }
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [label, icon, color, background, labelGap, artwork]);
    return (
        <canvas
            ref={ref}
            width={240}
            height={240}
            className="artwork-preview"
            aria-label={`${label || "Key"} artwork preview`}
        />
    );
}
