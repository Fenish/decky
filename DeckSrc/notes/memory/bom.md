---
name: bom
type: reference
---

Bill of materials as it stands after the move to touch input (2026-09-09):

- 24 x neodymium magnet 6x3 (12 in the case, 12 in the mount plate)
- 4 x M3x10 self-tapping, for the cover
- M6 screws for the GoPro joints
- silicone pads for the clamp faces

**Dropped when the switches went.** 60 x tact switch 6x6x6.5 mm, 1 x MCP23017
I2C expander, 30 AWG stranded silicone wire, and the 15 plexi keycaps
(24.2 x 23.3 x 2.0 mm) are all out of the design - the finger touches the glass
directly now. Do not re-order any of them. The plexi thickness used to be a
hard interface dimension; it constrains nothing any more.

**Why it matters:** most of the old parts list was there to serve a switch
matrix that no longer exists. See [[touch-input]],
[[decisions/2026-09-09-touch-instead-of-switches]].
