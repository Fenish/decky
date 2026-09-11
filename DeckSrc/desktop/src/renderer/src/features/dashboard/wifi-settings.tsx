import { useEffect, useRef, useState } from "react";
import { LockKeyhole, RefreshCw, Wifi } from "lucide-react";
import type { WifiNetwork, WifiStatus } from "../../../../shared/api";
import { errorText } from "../../app/error-text";

export function WifiSettings() {
    const [status, setStatus] = useState<WifiStatus | null>(null);
    const [networks, setNetworks] = useState<WifiNetwork[]>([]);
    const [selected, setSelected] = useState<WifiNetwork | null>(null);
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState("");
    // Errors only. Joining shows on its button and a joined network in the green line.
    const [message, setMessage] = useState("");
    const [scanned, setScanned] = useState(false);
    const mounted = useRef(true);
    const connecting = useRef(false);
    const joinStarted = useRef(0);
    const joiningSsid = useRef("");
    const refresh = async (): Promise<void> => {
        const next = await window.deck.wifiStatus();
        if (!mounted.current) return;
        setStatus(next);
        // A question about forgetting a network only stands while there is one.
        if (next.state !== "connected")
            setBusy((current) => (current === "confirm-forget" ? "" : current));
        if (connecting.current) {
            if (next.state === "connected" && next.ssid === joiningSsid.current) {
                connecting.current = false;
                setBusy("");
                setPassword("");
                // Joined: the network list and password form have done their job.
                setSelected(null);
                setNetworks([]);
                setScanned(false);
            } else if (Date.now() - joinStarted.current > 28000) {
                connecting.current = false;
                setBusy("");
                setMessage("Could not connect. Check the password and try again.");
            }
        }
    };
    useEffect(() => {
        mounted.current = true;
        let live = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async (): Promise<void> => {
            try {
                await refresh();
            } catch (error) {
                if (mounted.current) setMessage(errorText(error));
            }
            if (live) timer = setTimeout(() => void poll(), 2000);
        };
        void poll();
        return () => {
            mounted.current = false;
            live = false;
            clearTimeout(timer);
        };
    }, []);
    const scan = async (): Promise<void> => {
        setBusy("scan");
        setMessage("");
        try {
            const results = await window.deck.wifiScan();
            if (mounted.current) {
                setNetworks(results);
                setScanned(true);
            }
        } catch (error) {
            if (mounted.current) setMessage(errorText(error));
        } finally {
            if (mounted.current) setBusy("");
        }
    };
    const connect = async (): Promise<void> => {
        if (!selected) return;
        joiningSsid.current = selected.ssid;
        setBusy("join");
        setMessage("");
        try {
            const reply = await window.deck.wifiJoin(
                selected.ssid,
                selected.security === "open" ? "" : password,
            );
            if (!mounted.current) return;
            setPassword("");
            if (!reply.ok) {
                setBusy("");
                setMessage(reply.message);
                return;
            }
            connecting.current = true;
            joinStarted.current = Date.now();
            await refresh();
        } catch (error) {
            if (mounted.current) {
                setBusy("");
                setMessage(errorText(error));
            }
        }
    };
    const forget = async (): Promise<void> => {
        setBusy("forget");
        setMessage("");
        try {
            const reply = await window.deck.wifiForget();
            if (!mounted.current) return;
            if (!reply.ok) setMessage(reply.message);
            else {
                setSelected(null);
                setNetworks([]);
                setScanned(false);
            }
            await refresh();
        } catch (error) {
            if (mounted.current) setMessage(errorText(error));
        } finally {
            if (mounted.current) setBusy("");
        }
    };
    const available = status?.available && status.transport === "usb";
    // Forget appears once the deck is on a network, not while it is still joining one.
    const connected = available && status.state === "connected";
    return (
        <section className="wifi-settings" aria-label="Wireless settings">
            <div className="wifi-heading">
                <h3>
                    <Wifi size={18} /> Wireless
                </h3>
                <span>
                    {status?.transport === "wifi"
                        ? "Using Wi-Fi"
                        : status?.transport === "usb"
                          ? "Using USB"
                          : ""}
                </span>
            </div>
            <p className="wifi-help">
                Choose a 2.4 GHz network. Keep your PC on the same local network; Decky still needs
                USB power.
            </p>
            {status?.cacheStorage === "none" && (
                <p className="wifi-help">
                    Insert a microSD card and restart Decky to keep artwork between power cycles.
                </p>
            )}
            {!status ? (
                <p className="wifi-help">Checking connection…</p>
            ) : !status.available ? (
                <p className="wifi-help">
                    Connect Decky by USB with the wireless firmware installed to set up Wi-Fi.
                </p>
            ) : (
                <>
                    {status.state === "connected" && (
                        <div className="wifi-connected">
                            <span className="status-dot" /> Connected to{" "}
                            <strong>{status.ssid}</strong>
                        </div>
                    )}
                    {connected &&
                        (busy === "confirm-forget" ? (
                            <div className="wifi-forget" role="alert">
                                <p className="wifi-help">
                                    Forget {status.ssid || "the saved network"}? Decky will need the
                                    password to join again.
                                </p>
                                <div className="firmware-actions">
                                    <button
                                        className="button primary"
                                        onClick={() => void forget()}
                                    >
                                        Forget
                                    </button>
                                    <button className="button" onClick={() => setBusy("")}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                className="button wifi-wide"
                                disabled={!!busy}
                                onClick={() => {
                                    setMessage("");
                                    setBusy("confirm-forget");
                                }}
                            >
                                {busy === "forget"
                                    ? "Forgetting…"
                                    : `Forget ${status.ssid || "saved Wi-Fi"}`}
                            </button>
                        ))}
                    {status.encrypted === false && (
                        <p className="wifi-help">
                            This firmware cannot encrypt Wi-Fi, so Decky will not use it. Update the
                            deck&apos;s firmware below.
                        </p>
                    )}
                    {status.transport === "wifi" ? (
                        <p className="wifi-help">
                            Connect the USB cable to change or forget networks.
                        </p>
                    ) : (
                        <>
                            <button
                                className="button wifi-wide"
                                disabled={!available || !!busy}
                                onClick={() => void scan()}
                            >
                                <RefreshCw size={16} className={busy === "scan" ? "spin" : ""} />
                                {busy === "scan" ? "Scanning…" : "Find Wi-Fi networks"}
                            </button>
                            {networks.length > 0 && (
                                <div
                                    className="wifi-networks"
                                    role="listbox"
                                    aria-label="Wi-Fi networks"
                                >
                                    {networks.map((network) => (
                                        <button
                                            key={network.ssid}
                                            role="option"
                                            aria-selected={selected?.ssid === network.ssid}
                                            disabled={!!busy || network.security === "enterprise"}
                                            onClick={() => {
                                                setSelected(network);
                                                setPassword("");
                                                setMessage("");
                                            }}
                                        >
                                            <Wifi size={17} />
                                            <span>{network.ssid}</span>
                                            {network.security !== "open" && (
                                                <LockKeyhole size={13} />
                                            )}
                                            <small>
                                                {network.security === "enterprise"
                                                    ? "Enterprise"
                                                    : network.rssi > -60
                                                      ? "Strong"
                                                      : network.rssi > -75
                                                        ? "Fair"
                                                        : "Weak"}
                                            </small>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {scanned && !networks.length && (
                                <p className="wifi-help">
                                    No networks found. Move closer to your router and scan again.
                                </p>
                            )}
                            {selected && (
                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        void connect();
                                    }}
                                >
                                    {selected.security !== "open" && (
                                        <label className="field">
                                            Wi-Fi password
                                            <input
                                                type="password"
                                                autoComplete="off"
                                                maxLength={63}
                                                value={password}
                                                disabled={!!busy}
                                                onChange={(event) =>
                                                    setPassword(event.target.value)
                                                }
                                            />
                                        </label>
                                    )}
                                    <button
                                        className="button primary wifi-wide"
                                        disabled={
                                            !!busy ||
                                            (selected.security !== "open" && password.length < 8)
                                        }
                                    >
                                        {busy === "join"
                                            ? "Connecting…"
                                            : `Connect to ${selected.ssid}`}
                                    </button>
                                </form>
                            )}
                        </>
                    )}
                </>
            )}
            {message && (
                <p className="wifi-message" role="alert">
                    {message}
                </p>
            )}
        </section>
    );
}
