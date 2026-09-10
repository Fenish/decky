---
date: 2026-09-09
status: accepted
---

# Input is the panel's touch controller, not 60 tact switches

**Context:** the design called for 15 keys, each with four 6x6x6.5 mm tact
switches wired in parallel and read through an MCP23017, with a transparent
plexi keycap over each so the screen showed through. None of it was built - the
switches were never wired. A previous note recorded touch as being *permanently*
out of scope, on the reasoning that the deck's input was its switches and that a
PCA9557 boot sequence stood between the firmware and the GT911 anyway.

**Choice:** drop the switches, the MCP23017, the plexi keycaps and the key
carriers. The finger touches the panel glass directly; the GT911 already on the
board is the input.

**Why:** the user's call, made 2026-09-09. What made it cheap rather than
expensive is that the blocking technical objection turned out to be false. The
GT911 answers at 0x14 with no expander sequence, no reset line and no
configuration beyond Elecrow's own numbers, which ship inside the pinned
LovyanGFX as `LGFX_Elecrow_ESP32_Display_WZ8048C070.h`. Bring-up was one config
block and a hit-test, and it worked on the first flash. The PCA9557 caveat was
an *Advance* model detail - the same mistake the notes had already made once
about the SD card's DIP switches.

**Consequences:** the whole switch half of the bill of materials is dead, the
Key Carrier part is obsolete, and the Grid becomes a bezel rather than a carrier
of openings. The mechanical files have not been updated for this - Fusion is the
source of truth and the change has not been made there yet.

**Rejected:**
- *Keeping the plexi caps and reading touch through them.* Considered and put
  aside by the user. 2.0 mm acrylic is within a GT911's reach but needs the cap
  bonded flat and the sensitivity registers raised, and the 10 mm ribs would
  have become dead zones the firmware had to map around. Touching the glass
  needs none of that.
- *Writing our own GT911 I2C driver.* LovyanGFX's is already compiled into the
  build, handles the two possible addresses by itself, and is the version
  already trusted for this panel.

See [[touch-input]], [[firmware-build-status]], [[bom]], [[build-status]].
