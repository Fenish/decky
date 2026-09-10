---
name: crowpanel-display
type: environment
---

The deck is built around an Elecrow CrowPanel Basic 7" ESP32 HMI display,
800x480, bought from robocombo.com. The board is an ESP32-S3-WROOM-1-N4R8
(4 MB flash, 8 MB PSRAM) with an EK9716BD3 / EK73002ACGB RGB panel, a GT911
capacitive touch controller on IO19/IO20, and backlight on IO2. Active area is
153.84 x 85.63 mm. It exposes two JST I2C ports, so the switch matrix can be
wired without soldering to the board itself.

**Why it matters:** the whole mechanical design (grid pitch, opening position,
case size) is derived from this panel's active area — a different panel
invalidates every dimension. See [[key-grid-layout]], [[panel-pclk-limit]].
