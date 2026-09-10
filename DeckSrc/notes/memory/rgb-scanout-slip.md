---
name: rgb-scanout-slip
type: constraint
---

The deck's picture can slip vertically and wrap (a top-row image split, its
lower half at the top of the screen, its upper half at the bottom) while the
framebuffer itself is correct. Seen at power-up, intermittently; it lasted until
a reset.

The framework (arduino-esp32 3.3.8, ESP-IDF 5.5.4, `dio_opi` libs) is built with
`CONFIG_LCD_RGB_RESTART_IN_VSYNC=1`. Under it, `esp_lcd_rgb_panel_restart()` is
a **no-op** (the `need_restart` flag is never read), and the per-frame restart
only rewinds the DMA; it does not reset the LCD engine and rewinds the bounce
position only when it is more than two buffers off. `esp_lcd_panel_init()` on
the running panel runs the driver's full start (LCD stop and reset, bounce
position 0, both buffers refilled) and only rewrites registers, so the
framebuffer and picture survive. Checked in the 5.5.4 source,
`components/esp_lcd/rgb/esp_lcd_panel_rgb.c`.

Measured on the deck: `SCREEN` returned a correct framebuffer while the panel
showed the wrap; the old `DISPLAY_RESYNC` (restart) changed nothing; an EN-only
chip reset with the panel powered fixed it.

**How to apply:** `Bus_RGB::restartScanout()` calls `esp_lcd_panel_init()` after
a vertical sync. The firmware realigns once after Wi-Fi activity settles (1 s
after the last event), after the desktop's warm-up, and on `DISPLAY_RESYNC`.
Never call it at 10 Hz: each restart can cost a frame. Whether this cures the
power-up slip was not yet confirmed by repeated power cycles.

Related: [[screen-tearing-fix]], [[panel-pclk-limit]].
