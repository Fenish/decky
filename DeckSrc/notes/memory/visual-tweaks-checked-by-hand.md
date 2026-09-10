---
name: visual-tweaks-checked-by-hand
type: feedback
---

For small visual tweaks (spacing, scrollbars, alignment), the user looks at the
running dev app themselves; it reloads on save. Once lint and the UI checks
pass, hand the change over. Don't build extra layout measurements or zoomed
screenshots to prove how it looks.

**Why:** the user stopped a layout-measurement run after a scrollbar-gap change
because they had already seen it was right. Headless screenshots can't show some
things at all (scrollbars are not drawn), so the user's own eyes are the real
check for these.

**How to apply:** behaviour changes still get tests that fail without the fix.
Pure styling gets lint plus the existing UI checks, then a short note on what to
look at.
