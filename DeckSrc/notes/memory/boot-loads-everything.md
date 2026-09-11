---
name: boot-loads-everything
description:
  The user's rule - when the deck finishes loading, nothing may lag on first
  use; boot preloads every cache and every state a key can reach
metadata:
  type: feedback
---

**The user's rule:** "boot basically will load everything... every cache, every
state... when boot ends I don't want any lag on my deck." Nothing may be slow
the first time and fast afterwards.

**Why:** the first mute on the volume or the microphone took about a second (its
greyed dial look, 25 KB, travelled then: 889 ms, against 20 ms once the deck
kept it). The user asked that every widget and button get the same care.

**How to apply:** for any new widget, button or state, ask what its first use
builds, sends or starts, and do that while the deck loads.

- **Looks:** every look a key can take goes at boot (`lookKeys`, `deckLooks` in
  the renderer), not only the one for its state now.
- **Helpers:** start them at boot where the profile needs them. The keystroke
  helper starts with `ActionRunner.prepare`, and the Windows helper with the
  first sound or media widget.
- **Pictures:** pages, ON pictures, and widget pictures and sliding text are
  loaded for every page.
- **Limits:** the deck keeps looks one per key plus one; more than that and the
  oldest unused ones go. More than 8 pages do not fit in its memory at all, and
  then nothing is preloaded (`cachePages` refuses).

Related: [[widgets]], [[deck-first-for-animation]].
