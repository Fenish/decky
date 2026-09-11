import { icons } from "lucide-react";
import { BRAND_ICONS } from "./brand-icons";
const aliases: Record<string, string> = {
    Code2: "CodeXml",
    Home: "House",
    clock: "Clock",
    keyboard: "Keyboard",
    program: "AppWindow",
    website: "Globe",
    script: "CodeXml",
    macro: "Layers",
    page: "Folder",
    mic: "Mic",
    video: "Video",
    music: "Music2",
    monitor: "Monitor",
    play: "Play",
    zap: "Zap",
    volume: "Volume2",
    camera: "Camera",
    back: "ArrowLeft",
    coffee: "Coffee",
    headphones: "Headphones",
    radio: "Radio",
    plus: "Plus",
};
/** Every icon a key can have: Lucide's, then the brands' (brand-icons.ts). */
export const ICON_NAMES = [...Object.keys(icons), ...Object.keys(BRAND_ICONS)];
export function iconName(name: string): string {
    return aliases[name] ?? name;
}
export function iconLabel(name: string): string {
    const brand = BRAND_ICONS[name];
    if (brand) return brand.title;
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}
export function KeyIcon({ name, size = 24 }: { name: string; size?: number }) {
    // A brand's logo is solid: drawn a little smaller, it weighs as much as an outline icon.
    const brand = BRAND_ICONS[name];
    if (brand)
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label={brand.title}
                width={size}
                height={size}
                viewBox="-2 -2 28 28"
                fill="currentColor"
            >
                <path d={brand.path} />
            </svg>
        );
    const Icon = icons[iconName(name) as keyof typeof icons] ?? icons.Zap;
    return <Icon size={size} strokeWidth={1.65} />;
}
