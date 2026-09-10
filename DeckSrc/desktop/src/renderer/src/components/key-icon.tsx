import { icons } from "lucide-react";
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
export const ICON_NAMES = Object.keys(icons);
export function iconName(name: string): string {
    return aliases[name] ?? name;
}
export function iconLabel(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}
export function KeyIcon({ name, size = 24 }: { name: string; size?: number }) {
    const Icon = icons[iconName(name) as keyof typeof icons] ?? icons.Zap;
    return <Icon size={size} strokeWidth={1.65} />;
}
