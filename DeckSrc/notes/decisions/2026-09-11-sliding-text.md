# Sliding text on the deck

**Asked:** a song title too long for the Now playing key should slide so all of
it can be read. The user picked the loop (rest, slide left, the start following
after a gap), and Now playing only for now.

**Decided:** the deck slides it. The app draws each overflowing line once, as
coverage in its own font, and sends it with `SLIDE`. The deck lays it over the
key's picture, at the panel's pace. Only a line that does not fit slides, and
the key's picture leaves it out.

**Why the deck:** the user's rule ([[deck-first-for-animation]]). The numbers
agree: a moving strip is a new picture every 33 ms. USB carries a patch in
20-130 ms, so the app could manage 3-10 steps a second at best, and they would
queue behind the progress patches.

**Why not a wheel look:** a `LIVE` picture ends a key's wheel. Now playing's
progress line patches the key every second, so a wheel-based slide would stop
each second. Sliding text is an overlay on the page copy instead: `LIVE` changes
the picture under it without restarting it.

**Lifetime, and the risk it answers:** text hangs off the deck's copy of the
page (page id + signature), like LIVE patches, and the app mirrors it
(`liveSlides`).

- If text were kept per page id and cell only, moving the widget would slide a
  stale title over whatever key took its place, until the app noticed.
- With per-copy text, a new version of a page starts clean.
- `HELLO` and disconnect drop everything. So a new session never inherits text
  that the app thinks is absent: "absent" is the one state the app never
  re-sends.

**Drawing:** each frame writes only the box the lines cover.

- The box is built from the key's own picture, then each line is blended in.
- Title and artist windows overlap by a few rows, so they are drawn together in
  one pass rather than each restoring its own window.
- Windows stay 2 px inside the key, clear of the pressed outline.

**Checked:**

- A Python copy of the deck's blending, run on the app's real output.
- On the deck itself: at rest, after a LIVE picture under it (it kept going),
  two lines at once, and taken away.
- Unit and simulated-deck tests cover the format, the timing, and when the app
  sends it.

No critic: the command is behind an `ID` flag and unreleased, so the format can
still change on both sides for free.
