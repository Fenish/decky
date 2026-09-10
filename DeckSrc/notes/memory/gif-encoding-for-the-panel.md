---
name: gif-encoding-for-the-panel
type: constraint
---

Animations for the deck must be encoded as **full frames, `disposal=2`**, and
every frame must be visually distinct. Three separate defects came from getting
this wrong, all of which looked fine in a desktop GIF viewer.

**The decoder corrupts difference-encoded frames.** This is the hard reason,
found by measurement on 2026-08-20. A real optimised GIF (100x100, 151 frames,
150 of them partial, 256-colour global palette) rendered colours that appear
**nowhere in the source file** - green and cyan streaks in a fixed patch that
never cleared. Confirmed by reading the panel's frame buffer back over serial
(`tools/dump_cell.py`) rather than by eye: the bad pixels were in memory, so it
was not a display artefact. It reproduced with AnimatedGIF's turbo mode on and
off, and in both its cooked and raw draw paths, which rules out the palette
handling, the turbo decoder and our own drawing code. Re-encoding the same file
as full frames rendered it clean. Anything imported must therefore be re-encoded,
not embedded as-is (the generator that did this, `tools/make_gifs.py`, was
removed with the GIF player; see [[firmware-build-status]]).

Partial frames also make any such fault permanent: they touch about half the
canvas, so a single bad frame leaves pixels nothing ever repaints.

**Full frames, not differences.** Pillow's default writes each frame as a diff
against the previous one, leaving unchanged pixels transparent. That only
displays correctly while the decoder's canvas and the panel agree exactly; once
they diverge, earlier frames show through as trails behind moving shapes.
`optimize=False` does *not* turn this off - it controls the palette. `disposal=2`
is what forces whole-canvas frames. On these images full frames also encode
*smaller* than diffed ones, so there is no trade to weigh.

**No duplicate frames.** Eased motion (`sin`, `cos`) crawls at its turning
points; once consecutive frames round to the same pixels the encoder merges them
into one long frame, seen as the animation sticking. Use constant-rate motion.
Count distinct frames against the frames requested for each animation -
anything below 100% is a stutter, not a rounding detail.

**A scrolling repeat cannot exceed its pitch.** A pattern that repeats every N
pixels can only produce N distinct frames however far it is scrolled. Asking for
more frames silently reproduces duplicates. Rotate instead of scrolling.

**Step size sets perceived smoothness.** At 72 frames the sweeping bar moves
2.5 px per frame and reads as smooth; a hand rotating a full turn moves 6.5 px at
its tip and reads as jerky. Judge by pixels moved per frame, not by frame count.

**Why it matters:** all of these look correct on a PC and wrong on the deck, so
the desktop file is not a check.

See [[firmware-build-status]], [[screen-tearing-fix]].
