import { useEffect, useRef } from "react";
import { RefreshCw, X } from "lucide-react";
import type { DeckConfig } from "../../../../shared/config";
import { DiscordSettings } from "./discord-settings";
import { WifiSettings } from "./wifi-settings";
import { FirmwareSettings } from "./firmware-settings";
export function SettingsPanel({
    config,
    busy,
    save,
    sync,
    onClose,
    notify,
    firmwareKey,
    revealUpdates,
}: {
    config: DeckConfig;
    busy: boolean;
    save: (config: DeckConfig) => Promise<void>;
    sync: () => Promise<void>;
    onClose: () => void;
    notify: (message: string) => void;
    firmwareKey: string;
    /** Bumped to bring the Updates section into view, as the title bar's pill does. */
    revealUpdates: number;
}) {
    const body = useRef<HTMLDivElement>(null);
    const updates = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const scroller = body.current;
        const target = updates.current;
        if (!revealUpdates || !scroller || !target) return;
        const align = (behavior: ScrollBehavior): void =>
            scroller.scrollTo({
                top:
                    scroller.scrollTop +
                    target.getBoundingClientRect().top -
                    scroller.getBoundingClientRect().top,
                behavior,
            });
        align(config.reducedMotion ? "auto" : "smooth");
        // Wireless and Updates fill in just after Settings opens, which moves the
        // section; follow it while they settle, unless the user scrolls first.
        let height = scroller.scrollHeight;
        const follow = new ResizeObserver(() => {
            if (scroller.scrollHeight === height) return;
            height = scroller.scrollHeight;
            align("auto");
        });
        for (const child of Array.from(scroller.children)) follow.observe(child);
        const stop = (): void => follow.disconnect();
        const settle = setTimeout(stop, 1500);
        const takeOver = ["wheel", "pointerdown", "keydown"] as const;
        for (const kind of takeOver) scroller.addEventListener(kind, stop, { once: true });
        return () => {
            stop();
            clearTimeout(settle);
            for (const kind of takeOver) scroller.removeEventListener(kind, stop);
        };
    }, [revealUpdates, config.reducedMotion]);
    return (
        <section className="utility-panel settings-panel" aria-label="Settings">
            <header>
                <h2>Settings</h2>
                <button aria-label="Close settings" onClick={onClose}>
                    <X size={22} />
                </button>
            </header>
            {/* Only the body scrolls, so the title and close button stay in place. */}
            <div className="settings-body" ref={body}>
                <div className="preference-row">
                    <label id="motion-label">Reduce motion</label>
                    <button
                        role="switch"
                        aria-labelledby="motion-label"
                        aria-checked={config.reducedMotion}
                        className={`toggle ${config.reducedMotion ? "on" : ""}`}
                        onClick={() =>
                            void save({ ...config, reducedMotion: !config.reducedMotion }).catch(
                                (e) => notify(String(e)),
                            )
                        }
                    >
                        <span />
                    </button>
                </div>
                <DiscordSettings notify={notify} />
                <div className="settings-actions">
                    <button disabled={busy} onClick={() => void sync()}>
                        <RefreshCw size={19} className={busy ? "spin" : ""} />
                        {busy ? "Syncing…" : "Sync keys"}
                    </button>
                </div>
                <WifiSettings />
                {/* Keyed to the deck's firmware: an install's "restarting" message and the
                versions it showed belong to the firmware it replaced. When the deck
                drops out and returns running the new one, the section starts over. */}
                {/* Remounted on every reveal, so the highlight plays each time. */}
                <div
                    key={revealUpdates}
                    ref={updates}
                    className={revealUpdates ? "updates-anchor revealed" : "updates-anchor"}
                >
                    <FirmwareSettings key={firmwareKey} />
                </div>
                <p className="settings-footnote">Decky stays in the system tray when closed.</p>
            </div>
        </section>
    );
}
