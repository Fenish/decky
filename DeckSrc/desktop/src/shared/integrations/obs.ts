import type { Integration } from "./integration";

/** OBS Studio, through the WebSocket server built into OBS 28 and later. */
export const obsIntegration: Integration & { id: "obs" } = {
    id: "obs",
    name: "OBS Studio",
    icon: "brand:OBS Studio",
    fields: [
        { key: "address", label: "Address", placeholder: "localhost:4455", maxLength: 260 },
        { key: "password", label: "Password", secret: true, maxLength: 256 },
    ],
    brief: {
        ready: (version) => (version ? `Connected · OBS ${version}` : "Connected"),
        missing: () => "OBS isn't installed",
        closed: () => "OBS is closed",
        off: () => "WebSocket server off",
        denied: () => "Wrong password",
    },
    says: {
        ready: (version) => (version ? `Connected to OBS ${version}.` : "Connected to OBS."),
        missing: () =>
            "OBS Studio isn't installed on this PC. Install it from obsproject.com; OBS keys follow it once it opens.",
        closed: () => "OBS Studio is closed. OBS keys follow it once it opens.",
        off: () =>
            "OBS is open, but its WebSocket server is off. In OBS: Tools → WebSocket Server Settings → Enable WebSocket server.",
        denied: () =>
            "OBS refused the password. Copy it from OBS's WebSocket Server Settings (Show Connect Info).",
    },
    help: "In OBS: Tools → WebSocket Server Settings → Enable WebSocket server, then Show Connect Info for the port and password.",
    buttons: {
        ready: { label: "Edit", does: "settings" },
        closed: { label: "Open OBS", does: "open" },
        missing: { label: "Get OBS", does: "download" },
        off: { label: "Connect…", does: "settings" },
        denied: { label: "Connect…", does: "settings" },
    },
    download: "https://obsproject.com/download",
};
