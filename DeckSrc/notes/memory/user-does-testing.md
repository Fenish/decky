---
name: user-does-testing
description:
  The user tests features on the deck and in the app themselves; Claude builds,
  checks the code, and hands over
metadata:
  type: feedback
---

From 2026-09-11 the user does the hands-on testing: "from now let me do the
tests not you".

**Why:** said while Claude was about to flash again and probe the deck (SCREEN
captures, golden runs) to check a new feature. Those runs hold COM5, restart the
deck, and take minutes.

**How to apply:**

- Don't run probes, golden runs or SCREEN captures on the deck, and don't flash
  it just to check something. Don't launch the app to test a feature, unless the
  user asks.
- Code-only checks are still fine: typecheck, lint, unit tests, a firmware
  compile (no upload), and the headless UI check (`scripts/ui-check.mjs`, a
  browser against fakes - neither the deck nor the user's app).
- Hand over with what to try, and what to look for in each case.
- While the user is testing, hold edits that would hot-reload the running app
  until they are done, or ask first.

Related: [[visual-tweaks-checked-by-hand]], [[firmware-golden-run]].
