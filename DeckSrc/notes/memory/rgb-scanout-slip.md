---
name: rgb-scanout-slip
type: constraint
---

The deck's picture could slip up by one bounce buffer (48 lines) and wrap - a
top-row image split, its lower half at the top of the screen - while the
framebuffer stayed correct. It lasted until a chip reset. Seen at power-up,
after a first install over factory firmware, and after Wi-Fi activity.

**Cause, proven on the deck:** the ESP-IDF 5.5.4 RGB driver picks which of its
two bounce buffers to refill by the parity of `bb_eof_count`. Flash-cache stalls
(flash erases and writes, Wi-Fi calibration, NVS commits) hold its non-IRAM
interrupts off, and several EOF interrupts merge into one. The count's parity
flips, and every refill then lands in the buffer being sent. Without
`CONFIG_LCD_RGB_RESTART_IN_VSYNC` the driver zeroes the count at every VSYNC.
With it, as the prebuilt arduino-esp32 3.3.8 libs are built, it never does.
Neither the per-frame restart nor `esp_lcd_panel_init()` touches the count.

**Fix:** `Bus_RGB::onVSync` (patches/LovyanGFX) zeroes `bb_eof_count` under the
driver's spinlock at every VSYNC, restoring the driver's own rule. It reaches
the private `esp_rgb_panel_t` through a mirror of the v5.5.4 layout, trusted
only after `init()` matches it against known values, its own VSYNC callback and
context included. If they don't match, it logs a warning and leaves the driver
alone.

Measured on the deck:

- **Correct state:** `pos=76800` (two chunks pre-filled), 10 EOFs per frame,
  even count at every VSYNC.
- **Slipped state:** the same, but an odd count.
- **Without the fix:** random 30 ms flash erases left the picture slipped by the
  second stall. Nudging the count by one straightened it at once.
- **With the fix:** 40 random stalls, 75 odd frames corrected, picture always
  back. A first install over factory firmware no longer leaves it shifted.

**How to apply:**

- `DISPLAY_STATE` reports `pos`, EOFs per frame, and corrections since boot.
- Don't bring back the old "realign" (`esp_lcd_panel_init` after Wi-Fi or
  warm-up): it was built on a wrong theory and never cured the slip.
- If the framework version changes, re-check the mirrored layout. The boot
  warning "bounce parity not guarded" means it no longer matches.

Related: [[screen-tearing-fix]], [[panel-pclk-limit]],
[[decisions/2026-09-11-bounce-parity-guard]].
