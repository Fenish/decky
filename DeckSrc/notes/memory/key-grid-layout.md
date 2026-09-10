---
name: key-grid-layout
type: constraint
---

5 x 3 grid, 15 keys. Cells are 22.768 x 21.877 mm with 10 mm ribs, and the
openings start exactly at the active-area corner of the panel so that every
screen pixel is used.

This is exact against Elecrow's published active area of **153.84 x 85.63 mm**:
5 * 22.768 + 4 * 10 = 153.84 and 3 * 21.877 + 2 * 10 = 85.63. So the ribs exist
only *between* cells, never at the edge. Confirmed on hardware 2026-08-20 — the
rendered grid closes flush on 0 and 800/480.

Transparent plexi keycaps sit in the carriers so the screen shows through.

**Why it matters:** the cell pitch is not a round number on purpose — it is
derived from the active area. Rounding it breaks pixel alignment. Note the
pixels are **not square**: 5.2002 px/mm horizontally, 5.6055 px/mm vertically.
Anything drawn from millimetres must use both scales.
See [[crowpanel-display]], [[firmware-build-status]].
