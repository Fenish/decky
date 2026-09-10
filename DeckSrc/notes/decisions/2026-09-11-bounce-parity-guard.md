---
date: 2026-09-11
status: accepted
---

# Guard the RGB driver's bounce parity from our VSYNC callback

**Context:** the deck's picture slipped up by 48 lines and wrapped until a
reset: at power-up, after a first install, and after Wi-Fi activity. The earlier
remedy re-ran `esp_lcd_panel_init()` after Wi-Fi and after warm-up. On a slipped
deck, `DISPLAY_RESYNC` ran it, and the picture stayed shifted.

**Finding:** diagnostic firmware read the driver's private bookkeeping at every
VSYNC. The correct state is 10 EOFs per frame with an even count. Random 30 ms
flash erases produced a lasting slip within two stalls, and the only thing that
changed was the count's parity, now odd. Adding one to the count straightened
the picture at once; the user confirmed it on the screen. The v5.5.4 source
shows why the slip lasts: with `CONFIG_LCD_RGB_RESTART_IN_VSYNC`, the line that
zeroes the count every VSYNC is skipped.

**Choice:** zero the count ourselves, in the VSYNC callback the patched Bus_RGB
already registers. It runs in the same interrupt just before the driver's
restart, and takes the driver's spinlock as the driver does. The private struct
is reached through a mirrored layout, used only after init matches it against
the framebuffer, sizes, pins, timings, and our own callback and context. The old
realign calls were removed. `DISPLAY_STATE` reports the bookkeeping.

**Rejected:**

- _Rebuilding the framework with `CONFIG_LCD_RGB_ISR_IRAM_SAFE` or XIP from
  PSRAM,_ which a forum thread the user found also recommends. It stops the
  missed interrupts at the source, but it means compiling our own arduino-esp32
  libs, against the rule to keep Elecrow's pinned framework.
- _A larger bounce buffer or a slower pixel clock._ These make stalls rarer, not
  harmless, and the pixel clock was tuned against flicker and artefacts.
- _Deleting and recreating the panel to recover._ It resets the count too, but
  it needs the slip detected first, costs a visible restart, and reallocates the
  framebuffer out from under LovyanGFX.

**Risk:** the mirror is tied to ESP-IDF v5.5.4. A framework change that moves
the fields fails the init check. The guard then switches itself off and logs a
warning, so nothing gets corrupted.

See [[rgb-scanout-slip]].
