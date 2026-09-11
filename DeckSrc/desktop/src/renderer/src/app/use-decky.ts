import { useCallback, useEffect, useRef, useState } from "react";
import { createConfig } from "../../../shared/config";
import type { DeckConfig, KeyStates, DeckPage } from "../../../shared/config";
import type { DeckStatus, PageUpload } from "../../../shared/api";
import { pageFrames, pageToggleFrames } from "../features/artwork/artwork";
import { useWidgetLive, widgetWarmup } from "../features/widgets/use-widget-live";
import { useCountdownAlarms } from "../features/widgets/use-countdown-alarms";
import type { WidgetStates } from "../../../shared/widgets";
const RETRY_MS = 4000;
export function useDecky() {
    const [config, setConfig] = useState<DeckConfig>(createConfig);
    const [status, setStatus] = useState<DeckStatus>({ connected: false });
    const [loaded, setLoaded] = useState(false);
    const [everConnected, setEverConnected] = useState(false);
    const [dashboardReady, setDashboardReady] = useState(false);
    // The deck is loading - just connected, or restarted - and the app waits
    // on its connection screen until it has: nothing to edit meanwhile.
    const [booting, setBooting] = useState(false);
    const booted = useRef("");
    const [keyStates, setKeyStates] = useState<KeyStates>({});
    const [widgetStates, setWidgetStates] = useState<WidgetStates>({});
    // Widget state as it is now, for loading, which does not start over with it.
    const statesNow = useRef<WidgetStates>({});
    useEffect(() => {
        statesNow.current = widgetStates;
    }, [widgetStates]);
    // Counts the moments the active page landed on the deck, so widgets refresh.
    const [landed, setLanded] = useState(0);
    const [pressedCell, setPressedCell] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState("");
    const connectionLive = useRef(false);
    const request = useRef<Promise<void> | null>(null);
    const synced = useRef("");
    const warmed = useRef("");
    const [deviceEpoch, setDeviceEpoch] = useState(0);
    const bitmaps = useRef(new Map<string, { token: string; frames: Promise<PageUpload> }>());
    const preparePage = useCallback(
        (
            page: DeckPage,
            width: number,
            height: number,
            states: KeyStates,
            independentToggles = false,
        ): Promise<PageUpload> => {
            const local = Object.fromEntries(
                Object.entries(independentToggles ? {} : states).filter(([key]) =>
                    key.startsWith(`${page.id}:`),
                ),
            );
            const token = JSON.stringify([page, width, height, local, independentToggles]);
            const previous = bitmaps.current.get(page.id);
            if (previous?.token === token) return previous.frames;
            const frames = Promise.all([
                pageFrames(page, width, height, local),
                independentToggles
                    ? pageToggleFrames(page, width, height)
                    : Promise.resolve(undefined),
            ])
                .then(([frames, toggleFrames]) => ({ pageId: page.id, frames, toggleFrames }))
                .catch((error) => {
                    bitmaps.current.delete(page.id);
                    throw error;
                });
            bitmaps.current.set(page.id, { token, frames });
            return frames;
        },
        [],
    );
    const notify = useCallback(
        (text: string) =>
            setMessage(
                text
                    .replace(/^Error: /, "")
                    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""),
            ),
        [],
    );
    const clearMessage = useCallback(() => setMessage(""), []);
    const enteredDashboard = useCallback(() => {
        if (connectionLive.current) setDashboardReady(true);
    }, []);
    const check = useCallback((): Promise<void> => {
        if (request.current) return request.current;
        setChecking(true);
        request.current = window.deck
            .status()
            .then((next) => {
                connectionLive.current = next.connected;
                if (next.connected) setEverConnected(true);
                else setDashboardReady(false);
                setStatus(next);
            })
            .catch((error) => {
                notify(String(error));
                connectionLive.current = false;
                setDashboardReady(false);
                setStatus({ connected: false });
            })
            .finally(() => {
                request.current = null;
                setChecking(false);
            });
        return request.current;
    }, [notify]);
    useEffect(() => {
        let live = true;
        let timer: ReturnType<typeof setTimeout>;
        void window.deck
            .getConfig()
            .then((next) => {
                if (live) {
                    setConfig(next);
                    setLoaded(true);
                }
            })
            .catch((e) => notify(String(e)));
        void window.deck
            .getKeyStates()
            .then((next) => {
                if (live) setKeyStates(next);
            })
            .catch((e) => notify(String(e)));
        void window.deck
            .widgetStates()
            .then((next) => {
                if (live) setWidgetStates(next);
            })
            .catch((e) => notify(String(e)));
        const poll = async (): Promise<void> => {
            await check();
            if (live) timer = setTimeout(() => void poll(), RETRY_MS);
        };
        void poll();
        const focus = (): void => {
            void check();
        };
        window.addEventListener("focus", focus);
        const subscriptions = [
            window.deck.onConfig(setConfig),
            window.deck.onKeyStates(setKeyStates),
            window.deck.onWidgetStates(setWidgetStates),
            window.deck.onEvent((event) => {
                if (event.kind === "key") setPressedCell(event.down ? event.cell : null);
                else if (event.kind === "fallback")
                    notify("USB unplugged. Decky is continuing over Wi-Fi.");
                else if (event.kind === "reset") {
                    warmed.current = "";
                    synced.current = "";
                    setDeviceEpoch((value) => value + 1);
                    void check();
                } else if (event.kind === "ports")
                    // A check already under way listed the ports before this one arrived.
                    void (request.current ?? Promise.resolve()).then(() => check());
            }),
            window.deck.onActivity((event) => {
                if (!event.ok) notify(event.message);
            }),
        ];
        return () => {
            live = false;
            clearTimeout(timer);
            window.removeEventListener("focus", focus);
            subscriptions.forEach((off) => off());
        };
    }, [check, notify]);
    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(clearMessage, 6500);
        return () => clearTimeout(timer);
    }, [message, clearMessage]);
    const save = useCallback(async (next: DeckConfig): Promise<void> => {
        setConfig(await window.deck.saveConfig(next));
    }, []);
    const navigate = useCallback(async (id: string): Promise<void> => {
        setConfig(await window.deck.navigate(id));
    }, []);
    const sync = useCallback(async (): Promise<void> => {
        if (!status.connected || busy) return;
        const page = config.pages.find((p) => p.id === config.activePageId)!;
        setBusy(true);
        try {
            const upload = await preparePage(
                page,
                status.identity.keyWidth,
                status.identity.keyHeight,
                keyStates,
                status.identity.protocol >= 4,
            );
            const reply = await window.deck.syncPage(page.id, upload.frames, upload.toggleFrames);
            notify(reply.message);
        } catch (error) {
            notify(String(error));
        } finally {
            setBusy(false);
        }
    }, [status, busy, config, keyStates, notify, preparePage]);
    useEffect(() => {
        if (!status.connected) {
            synced.current = "";
            warmed.current = "";
            booted.current = "";
            return;
        }
        if (!loaded || status.identity.protocol < 2 || busy) return;
        const page = config.pages.find((item) => item.id === config.activePageId)!;
        const independentToggles = status.identity.protocol >= 4;
        const stateToken = independentToggles ? "" : JSON.stringify(keyStates);
        const token = `${status.identity.serial}:${JSON.stringify(page)}:${stateToken}:${deviceEpoch}`;
        const library = `${status.identity.serial}:${JSON.stringify(config.pages)}:${stateToken}:${deviceEpoch}`;
        const preload = status.identity.protocol >= 3 && warmed.current !== library;
        if (synced.current === token && !preload) return;
        synced.current = token;
        if (preload) warmed.current = library;
        for (const id of bitmaps.current.keys())
            if (!config.pages.some((item) => item.id === id)) bitmaps.current.delete(id);
        // The first load of a session is the deck starting up.
        const session = `${status.identity.serial}:${deviceEpoch}`;
        const boot = booted.current !== session;
        const execute = async (): Promise<void> => {
            if (boot) {
                setBooting(true);
                setDashboardReady(false);
            }
            setBusy(true);
            try {
                if (preload) {
                    const pages = await Promise.all(
                        config.pages.map((item) =>
                            preparePage(
                                item,
                                status.identity.keyWidth,
                                status.identity.keyHeight,
                                keyStates,
                                independentToggles,
                            ),
                        ),
                    );
                    // Every page's widgets as they are now, loaded with the pages.
                    const warmup = status.identity.warm
                        ? widgetWarmup(
                              config,
                              statesNow.current,
                              status.identity.keyWidth,
                              status.identity.keyHeight,
                              status.identity.dial === true,
                              status.identity.slide === true,
                          )
                        : undefined;
                    const reply = await window.deck.cachePages(pages, warmup);
                    warmed.current = library;
                    if (reply.ok) {
                        setLanded((value) => value + 1);
                        return;
                    }
                    notify(reply.message);
                }
                const upload = await preparePage(
                    page,
                    status.identity.keyWidth,
                    status.identity.keyHeight,
                    keyStates,
                    independentToggles,
                );
                const reply = await window.deck.syncPage(
                    page.id,
                    upload.frames,
                    upload.toggleFrames,
                );
                if (!reply.ok) notify(reply.message);
                else setLanded((value) => value + 1);
            } catch (error) {
                notify(String(error));
            } finally {
                setBusy(false);
                if (boot) {
                    booted.current = session;
                    setBooting(false);
                }
            }
        };
        void Promise.resolve().then(execute);
    }, [status, loaded, busy, config, keyStates, notify, preparePage, deviceEpoch]);
    useWidgetLive(status, config, widgetStates, landed);
    useCountdownAlarms(config, widgetStates);
    return {
        config,
        status,
        loaded,
        everConnected,
        dashboardReady,
        booting: status.connected && booting,
        keyStates,
        widgetStates,
        pressedCell,
        busy,
        checking,
        message,
        notify,
        clearMessage,
        enteredDashboard,
        save,
        navigate,
        sync,
        setConfig,
    };
}
