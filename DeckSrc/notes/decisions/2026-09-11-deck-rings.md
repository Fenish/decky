# Rings' arcs moved by the deck

**Problem (user report):** the OBS 5-second countdown ring and the timer's ring
step once a second. The user wanted them smooth.

**Decided:** the deck draws and moves the arc ([[deck-first-for-animation]]).
The key's picture keeps the ring's track; `SWEEP` sends the arc once: where the
ring is, its look, and how its end moves with the clock. The digits under it
stay `LIVE` patches, once a second.

**Why not the app:** a patch takes 20-130 ms over USB and competes with every
other live key, so a few steps a second at best. The user chose the deck when
asked.

**Why not a dial look:** a dial already fills per pixel against a map, but it is
a wheel look, and a `LIVE` picture ends a key's wheel. A timer's digits change
every second, which would stop it each second: the reason sliding text is an
overlay too ([[2026-09-11-sliding-text]]).

**The clock in the line, not the payload:** the motion is `(t - zero) / turn`
in the PC's clock, and `SWEEP`'s line ends with that clock as it is sent. The
payload is then the same for as long as the motion holds, so the CRC check that
keeps slides from being resent does the same here: a running stopwatch's arc
goes once. The price is the line's transit time (a few ms) as a fixed offset,
and the two clocks' drift (tens of ppm) over a long run. Neither shows on a
ring.

**One overlay base:** sliding text and the arc are both `KeyOverlay`s, one per
kind per key, drawn in a row pass. `SLIDE` and `SWEEP` share one handler, and
the desktop sends both as `KeyOverlays`. A new kind needs a class, a kind and a
table row ([[generic-over-copies]]).

**Order, changed for slides too:** an overlay taken away goes before the
picture that has none; one that comes or changes goes after its picture. Before,
removing sliding text went after the new picture, which briefly showed the text
twice.

No critic: `SWEEP` is behind an `ID` flag and unreleased, so the format can
still change on both sides for free (as with `SLIDE`).

**Later the same day:** having tried a 10-second countdown smooth on the Debug
page, the user asked for the Timer's countdown "stepped like before". Its arc
is drawn into each second's picture again; the stopwatch, pomodoro and OBS
countdown stay on the deck.

Then: "only obs 5 second smooth other old version pls". The stopwatch and
pomodoro step once a second again too; `SWEEP` carries OBS's countdown ring
alone. The mechanism stays general.
