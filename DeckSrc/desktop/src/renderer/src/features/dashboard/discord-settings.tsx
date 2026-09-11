import { useEffect, useState } from "react";
import type { PresenceCard, PresenceStatus } from "../../../../shared/presence";
import { errorText } from "../../app/error-text";
import Logo from "../../assets/logo-white.svg?react";

/** "12:34 elapsed", ticking, as Discord counts it. */
function Elapsed({ since }: { since: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const total = Math.max(0, Math.floor((now - since) / 1000));
    const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    const two = (n: number): string => String(n).padStart(2, "0");
    return <span>{h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`} elapsed</span>;
}

/** The card as friends see it on Discord, drawn small: the logo, "Watching Decky", its lines. */
function CardPreview({ card }: { card: PresenceCard }) {
    return (
        <div className="presence-card" role="group" aria-label="What friends see">
            <div className="presence-art" aria-hidden="true">
                <Logo />
            </div>
            <div className="presence-lines">
                <small>Watching</small>
                <strong>Decky</strong>
                <span>{card.details}</span>
                {card.state && <span>{card.state}</span>}
                {card.since !== undefined && <Elapsed since={card.since} />}
            </div>
        </div>
    );
}

/**
 * Settings: Decky on Discord (Rich Presence). One switch; while it is on, the
 * card friends see, as it is now, and a word when Discord isn't there.
 */
export function DiscordSettings({ notify }: { notify: (message: string) => void }) {
    const [status, setStatus] = useState<PresenceStatus | null>(null);
    useEffect(() => {
        let live = true;
        window.deck
            .presenceStatus()
            .then((next) => {
                if (live) setStatus(next);
            })
            .catch(() => {});
        const off = window.deck.onPresenceStatus((next) => setStatus(next));
        return () => {
            live = false;
            off();
        };
    }, []);
    const enabled = status?.enabled ?? false;
    return (
        <section className="discord-settings" aria-label="Discord">
            <div className="discord-row">
                <div>
                    <label id="presence-label">Show on Discord</label>
                    <p>
                        Friends see “Watching Decky”: what you’re doing, and your presses today.
                        Never a page or key name.
                    </p>
                </div>
                <button
                    role="switch"
                    aria-labelledby="presence-label"
                    aria-checked={enabled}
                    className={`toggle ${enabled ? "on" : ""}`}
                    disabled={!status}
                    onClick={() =>
                        void window.deck
                            .presenceSet(!enabled)
                            .then(setStatus)
                            .catch((error) => notify(errorText(error)))
                    }
                >
                    <span />
                </button>
            </div>
            {enabled && status?.card && <CardPreview card={status.card} />}
            {enabled && status?.discord === "closed" && (
                <p className="presence-note" role="status">
                    Discord isn’t running. The card shows once it opens.
                </p>
            )}
        </section>
    );
}
