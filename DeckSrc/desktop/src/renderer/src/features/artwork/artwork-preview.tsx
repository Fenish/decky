import { useEffect, useRef } from "react";
import type { KeyAppearance } from "../../../../shared/config";
import { renderKey } from "./artwork";
/** A key's picture as the deck shows it; `disabled` while the app it controls is out of reach. */
export function ArtworkPreview({
    value,
    disabled = false,
}: {
    value: KeyAppearance;
    disabled?: boolean;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const { label, icon, color, background, labelGap, iconSize, artwork } = value;
    useEffect(() => {
        let live = true;
        void renderKey(
            { label, icon, color, background, labelGap, iconSize, artwork },
            240,
            240,
            false,
            disabled,
        )
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
    }, [label, icon, color, background, labelGap, iconSize, artwork, disabled]);
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
