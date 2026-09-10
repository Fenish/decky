---
name: touch-input
type: environment
---

Input is the panel's own GT911 capacitive controller, not physical switches.
Confirmed working on hardware 2026-09-09: it answers at **I2C address 0x14** on
a bus of its own - SDA 19, SCL 20, 400 kHz, `I2C_NUM_1`. No reset line and no
interrupt line are wired to a usable pin, so it is polled and left to its own
power-on reset.

**No expander sequence is needed.** A PCA9557 does sit on that bus (a second
device answers at 0x18), and Elecrow's V3.0 notes describe driving the touch
reset through it - but the controller responds on this board without any of
that. The same pattern as the SD card DIP-switch warning: an *Advance* model
caveat that does not apply to the Basic.

The pin map, clock and address come from
`LGFX_Elecrow_ESP32_Display_WZ8048C070.h`, which ships inside the pinned
LovyanGFX. Its twenty RGB pins match `lib/panel/panel.cpp` exactly, which is
what identifies it as this panel rather than a near neighbour. LovyanGFX's own
`Touch_GT911` driver is used; it tries the other address (0x5D) by itself if
the configured one does not answer.

`panel::touch_bus_scan()` lists what is on the bus and runs before the panel
claims it - the first thing to look at if touch ever stops working.

**Why it matters:** the previous note said touch was permanently out of scope
and warned that a PCA9557 boot sequence stood in the way. Both were wrong for
this board, and the second would have cost a day of work that was not needed.

See [[crowpanel-display]], [[firmware-build-status]], [[key-grid-layout]].
