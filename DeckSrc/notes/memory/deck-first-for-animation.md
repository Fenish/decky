---
name: deck-first-for-animation
description:
  Animated or heavy keys run on the deck itself; static or occasionally-updating
  keys are drawn by the Decky app
metadata:
  type: feedback
---

**The user's rule:** for heavy work or animated keys, use the deck first. For
static keys or ones that update now and then, use the Decky app.

**Why:** the link is the bottleneck. USB moves about 24 KB/s; a small patch
takes 20-130 ms and a whole key about a second. The deck redraws a key in about
2 ms. Anything that must follow a finger or move smoothly (a scrolling wheel,
momentum, snapping) cannot be streamed from the app. It was the user's call
after the app-drawn countdown wheel "teleported" from step to step (2026-09-11).

**How to apply:**

- **On the deck:** real-time or animated behaviour. The app sends what the deck
  needs once (shapes, lists, parameters) and the deck animates locally,
  reporting only the result.
- **In the app:** pictures that change on events or every second or more (a
  clock, ping, counter). These stay as `LIVE` patches.
- Put tunable feel (speeds, springs) in what the app sends, so tuning needs no
  reflash.

See [[widgets]].
