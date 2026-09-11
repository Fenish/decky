---
name: firmware-build-status
type: goal
---

As of 2026-09-11 the panel runs the full Decky firmware (protocol 7), built
locally as `fw=0.1.4-dirty` and not yet released: pages sent by the desktop,
widgets patched with `LIVE`, wheels, the volume dial and 3D dice drawn by the
deck, every page warmed while loading, 2 KB upload blocks, and `reset=` in `ID`.
Factory firmware has been erased (backup in `factory-backup/` at the repo root).
The touch test of 2026-09-09 is long gone.

Structure: `lib/panel` owns the RGB bus, timing, backlight, frame buffers, beam
timing **and the GT911** - the only place that knows GPIO numbers. `lib/keygrid`
owns the layout, the millimetre-to-pixel conversion and `hit()`, which turns a
touch point back into a key index. `src/main.cpp` holds the protocol and page
cache, `src/wheel.cpp` the wheels, dials and dice.

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
