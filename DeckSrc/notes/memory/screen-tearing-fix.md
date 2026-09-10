---
name: screen-tearing-fix
type: constraint
---

Drawing goes straight into the frame buffer the panel is scanning out, so a
region written while the beam is crossing it tears - the part below the split
shows the new frame, the part above the old one. It looks like a horizontal
glitch partway down a moving shape.

The fix is not double buffering. Copying a 768 KB frame per refresh would cost
more PSRAM bandwidth than the artefacts budget allows and would bring back the
DMA artefacts described in [[panel-pclk-limit]]. Instead the beam position is
tracked - `panel::wait_vsync()` gives a reference point, and elapsed time maps
to a scanline - and a cell is only written when the beam is clear of it, either
far enough above that the write finishes first, or already past it.

Two things make this work: the write must be fast relative to the frame (turbo
mode cut a cell from ~2.4 ms to ~0.6 ms, against a 20 ms frame), and the estimate
of how long a write takes must be pessimistic. Underestimating it starts a write
too close to the beam, which is the tear it is meant to prevent.

Cost is about 5% of the frame rate. Frames are deferred, not dropped.

**Why it matters:** the instinct is to reach for double buffering, which on this
board is the expensive wrong answer.

See [[firmware-build-status]].
