---
date: 2026-08-20
status: accepted
---

# Firmware is built with PlatformIO against Elecrow's pinned V3.0 toolchain, not the latest versions

**Context:** the CrowPanel's 800x480 panel is driven over the ESP32-S3 RGB
peripheral, whose API changed across ESP-IDF 5.x. LovyanGFX 1.2.25 does not
drive it correctly on arduino-esp32 3.3.8 unmodified — Elecrow ships a patched
`Bus_RGB.hpp` / `Bus_RGB.cpp` that reworks the driver around
`esp_lcd_new_rgb_panel` with two framebuffers and manual VSYNC present.

**Choice:** copy Elecrow's V3.0 PlatformIO example wholesale — board definition,
`huge_app.csv`, the patch and its pre-build script, and the exact pinned
versions (pioarduino platform 55.03.38, arduino-esp32 3.3.8, LovyanGFX 1.2.25) —
and replace only `src/`. Drawing is done with LovyanGFX directly; LVGL is not
used.

**Why:** the patch is version-specific. The pre-build script asserts against
LovyanGFX 1.2.25's file layout and fails loudly if it changes, so bumping any
of the three pinned versions silently invalidates the patch or breaks the build.
Elecrow's combination is the only one known to work on this hardware.

**Rejected:**
- *Latest LovyanGFX / arduino-esp32.* No upstream fix exists for this panel; the
  patch would have to be re-derived against a moving target.
- *LVGL.* Nothing here needs a widget toolkit yet, and it drags in a config
  header, fonts, and a tick/flush pipeline for what is fifteen rectangles.
- *Arduino IDE.* Not scriptable; every iteration would need manual clicks.

See [[flashing-the-panel]].
