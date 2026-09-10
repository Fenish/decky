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

A full page redraw writes the fifteen keys greedily: each one goes out as soon as
its row is clear, rather than in index order. Some row is always clear, so a page
costs about 35 ms. That is mostly the copies themselves - about 2.1 ms a key,
PSRAM to PSRAM beside the scanout, with one memcpy per row. The write estimate is
still twice the write and jumps up at once, but it eases back down, so one slow
write no longer narrows every later window.

**Why it matters:** the instinct is to reach for double buffering, which on this
board is the expensive wrong answer.

See [[firmware-build-status]].
