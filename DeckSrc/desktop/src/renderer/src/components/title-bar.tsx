import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { WindowAction } from "../../../shared/api";
import type { Transport } from "../../../shared/transport";
import Logo from "../assets/logo-white.svg?react";
import "./title-bar.css";
export function TitleBar({
    connected,
    transport,
    busy,
    notify,
}: {
    connected: boolean;
    /** Which connection is in use: USB whenever the cable answers, otherwise Wi-Fi. */
    transport: Transport | null;
    busy: boolean;
    notify: (message: string) => void;
}) {
    const via = transport === "wifi" ? "Wi-Fi" : transport === "usb" ? "USB" : null;
    const [maximized, setMaximized] = useState(false);
    useEffect(() => {
        let live = true;
        void window.deck
            .getWindowState()
            .then((state) => {
                if (live) setMaximized(state.maximized);
            })
            .catch((error) => notify(String(error)));
        const off = window.deck.onWindowState((state) => setMaximized(state.maximized));
        return () => {
            live = false;
            off();
        };
    }, [notify]);
    const control = async (action: WindowAction): Promise<void> => {
        try {
            const state = await window.deck.windowAction(action);
            setMaximized(state.maximized);
        } catch (error) {
            notify(String(error));
        }
    };
    return (
        <header className="custom-titlebar">
            <div className="titlebar-brand">
                <Logo aria-hidden="true" />
                <span>Decky</span>
            </div>
            <div className="titlebar-drag" />
            <div
                className="titlebar-status"
                role="status"
                aria-label={busy ? "Syncing keys" : connected ? "Connected" : "Disconnected"}
                title={
                    busy
                        ? "Syncing keys"
                        : connected
                          ? `Connected${via ? ` over ${via}` : ""}`
                          : "Waiting for Decky"
                }
            >
                <span className={`${connected ? "online" : "offline"} ${busy ? "syncing" : ""}`} />
                {connected && via && <small className="titlebar-transport">{via}</small>}
            </div>
            <div className="window-controls">
                <button
                    aria-label="Minimize window"
                    title="Minimize"
                    onClick={() => void control("minimize")}
                >
                    <Minus size={17} />
                </button>
                <button
                    aria-label={maximized ? "Restore window" : "Maximize window"}
                    title={maximized ? "Restore" : "Maximize"}
                    onClick={() => void control("maximize")}
                >
                    {maximized ? <Copy size={14} /> : <Square size={14} />}
                </button>
                <button
                    className="window-close"
                    aria-label="Close window"
                    title="Close"
                    onClick={() => void control("close")}
                >
                    <X size={19} />
                </button>
            </div>
        </header>
    );
}
