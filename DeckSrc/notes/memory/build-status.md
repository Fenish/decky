---
name: build-status
type: goal
---

As of 2026-09-09:

- **Bottom Case** — printed once, but has changed since (cavity corner fillets
  R4, locating pins 3.00 -> 2.60), so it needs a reprint.
- **Grid** — never printed; outer corners changed to R3. **Its purpose is now
  in question**: with the keycaps gone it is a bezel rather than a carrier of
  15 openings, and has not been redesigned for that.
- **Key Carrier** — **obsolete.** It existed to hold a plexi keycap over four
  switches; there are no keycaps and no switches. Not yet removed in Fusion.
- **Top Cover, Base Plate** — not reported as printed.
- **Strut** — designed (60 mm between pivots, 78 mm overall, three prongs at
  both ends, print two), not printed.
- **Electronics** — nothing to wire. The switch matrix and the MCP23017 are out
  of the design; the panel's own touch controller is the input.

**Why it matters:** two parts are known-stale versus the current model, and two
more are now solving a problem the design no longer has - printing either would
waste filament on a dead interface. Update this note as parts get printed.
See [[fusion-source-of-truth]], [[touch-input]].
