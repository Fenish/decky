---
name: firmware-golden-run
description:
  How to prove a firmware change leaves the deck's behaviour unchanged -
  tools/golden_run.py record, then check
metadata:
  type: project
---

The firmware has no unit tests. A change that should not alter behaviour (a
restructure, a refactor) is checked on the deck with
`DeckSrc/firmware/tools/golden_run.py`.

1. Run `record` on the build before the change.
2. Flash the change.
3. Run `check`.

It drives every command the desktop uses in a fixed order and compares every
reply, and two `SCREEN` captures pixel for pixel. What it controls for:

- **A restart first** (RTS), so nothing a previous run left in RAM changes the
  replies.
- **A new page signature every run**, so the SD card never has the page. The
  nonce pixel sits under the die, which covers it.
- **Replies that vary for reasons that aren't the firmware's** are normalised:
  `fw=` (the git-derived version stamp), `reset=`, `base=`, and ALT `cached=`
  (the card keeps ON pictures between runs).

**Why:** on 2026-09-11 the firmware was split from two big files into folders
and classes. The run showed the new build identical: 59 replies, both captures.
Frame rates were measured separately: die 52-55 fps thrown, drum 70-80 fps spun.

**How to apply:**

- Run it before calling any "no behaviour change" firmware work done.
- For speed, time frames with `DISPLAY_STATE` during `WHEELROLL`/`WHEELSPIN`.
- The fixtures in `tools/golden/` are the app's own looks. A change to a look's
  format needs new fixtures and a check by eye.
- The app must be closed (COM5), as for flashing. See [[flashing-the-panel]].
