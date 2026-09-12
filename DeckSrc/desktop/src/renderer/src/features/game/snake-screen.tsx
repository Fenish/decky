/*---------------------------------------------------------------
 * What the window shows while snake has the deck. The game itself is the
 * deck's - it draws and plays at the panel's own frame rate - so there is
 * nothing to mirror here: only the score, and the way back.
 *--------------------------------------------------------------*/

import { Gamepad2 } from "lucide-react";
import "./snake-screen.css";

export function SnakeScreen({ score, onStop }: { score: number; onStop: () => void }) {
    return (
        <main className="snake-screen" aria-label="Playing snake on the deck">
            <div className="snake-card">
                <span className="snake-icon" aria-hidden="true">
                    <Gamepad2 />
                </span>
                <h1>Snake, on the deck</h1>
                <p className="snake-score" role="status" aria-live="polite">
                    <strong>{score}</strong>
                    <span>{score === 1 ? "bite" : "bites"}</span>
                </p>
                <p className="snake-help">
                    Swipe across the keys to turn. Your keys come back the moment it ends.
                </p>
                <button className="button" onClick={onStop}>
                    Stop playing
                </button>
            </div>
        </main>
    );
}
