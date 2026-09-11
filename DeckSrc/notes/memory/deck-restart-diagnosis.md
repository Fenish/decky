---
name: deck-restart-diagnosis
description: How to tell why the deck restarted - reset reason, deck.log, core dump, error 31
metadata:
  type: project
---

When the deck restarts or disappears, find out why before changing code:

- `ID` ends with `reset=<reason>` (`poweron`, `sw`, `panic`, `taskwdt`,
  `brownout`...). The app writes crash, watchdog and brownout restarts to
  `%APPDATA%/Decky/deck.log`, along with uploads the deck did not answer and
  stray lines it printed.
- A crash leaves a core dump at `0x3F0000` (64 KB), which outlives power
  cycles. Decoding needs the `firmware.elf` of the build that crashed, so keep
  the ELF of anything you flash for testing. Commands are in the firmware
  README. Erase the partition after reading it, or a later restart gets blamed
  on the old crash.
- **An empty partition after a restart means it was not a panic.** It was
  verified on 2026-09-11 that this build does write dumps (a deliberate
  abort decoded correctly). So empty means power: a brownout or a dip.
- Windows "error code 31" / "device not functioning" on the COM port means
  the CH340 adapter is wedged. Only a replug fixes it; flashing cannot reach it
  until then. It came with the one unexplained restart, which points to power
  as well.

**Why:** the first restart (2026-09-11) looked like a firmware crash, but the
evidence said power.
**How to apply:** read `deck.log` and the dump first. A different USB port or
cable is the first thing to try for power restarts. See [[flashing-the-panel]]
and [[serial-unplug-stall]].
