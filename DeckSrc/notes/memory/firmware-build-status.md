---
name: firmware-build-status
type: goal
---

As of 2026-09-09 the panel runs `firmware` - a PlatformIO project whose current
behaviour is a **touch test**: fifteen numbered keys over two pages. The bottom
right key pages forward, the bottom left pages back, and the numbers run 1 to 27
straight through both pages so that a page actually changing is visible rather
than inferred. Factory firmware has been erased (backup in `factory-backup/` at
the repo root).

Structure: `lib/panel` owns the RGB bus, timing, backlight, frame buffers, beam
timing **and the GT911** - the only place that knows GPIO numbers.
`lib/keygrid` owns the layout, the millimetre-to-pixel conversion and `hit()`,
which turns a touch point back into a key index. `src/main.cpp` is the current
screen.

Image is 443 KB of the 2 MB app partition, against 769 KB for the animation
build, and boot no longer waits on the SD card.

**Touch is the input.** Reversed 2026-09-09; the earlier "permanently out of
scope" is gone. See [[touch-input]] and
[[decisions/2026-09-09-touch-instead-of-switches]].

**GIF animation playback is gone.** The player (`lib/gifcell`, `lib/gifassets`,
`lib/sdlock`), its generator `tools/make_gifs.py` and the test GIFs in `assets/`
were deleted on 2026-09-10 at the user's request. The repository had been
re-initialised before that, so no copy survives in git. Animated keys would have
to be rebuilt; [[gif-encoding-for-the-panel]] keeps the decoder lessons.

The `ID` handshake is kept, so the desktop app still finds the board.

**Why it matters:** do not look for the animation code in the tree or in git
history; it is not there.

See [[flashing-the-panel]], [[panel-pclk-limit]], [[screen-tearing-fix]],
[[key-grid-layout]], [[where-content-plays-from]].
