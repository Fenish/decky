# Memory index

Durable facts about this project. One file per fact — read these before
assuming project context.

- [crowpanel-display](crowpanel-display.md) — the panel everything is dimensioned from
- [fusion-source-of-truth](fusion-source-of-truth.md) — measure in Fusion, never from memory
- [fusion-file-split](fusion-file-split.md) — which Fusion file holds what
- [print-support-free](print-support-free.md) — no supports, Bambu Studio, test prints
- [key-grid-layout](key-grid-layout.md) — 5x3, cell pitch, pixel-aligned openings
- [touch-input](touch-input.md) — GT911 on 0x14, no expander needed, no switches
- [no-visible-screws](no-visible-screws.md) — top cover stays clean, fasten from below
- [monitor-mount-scheme](monitor-mount-scheme.md) — magnet plate, clamp, GoPro joints, measured limits
- [open-source-unnamed](open-source-unnamed.md) — public open-source project named Decky; do not rename
- [decky-desktop](decky-desktop.md) — Decky identity, rewrite, black defaults, toggles, firmware and startup fix
- [bom](bom.md) — parts list, and the half of it the touch change killed
- [panel-pclk-limit](panel-pclk-limit.md) — 24 MHz pixel clock, bounded by bounce buffer size, not by the panel
- [screen-tearing-fix](screen-tearing-fix.md) — beam-synchronised writes, not double buffering
- [gif-encoding-for-the-panel](gif-encoding-for-the-panel.md) — full frames, no duplicates, and why the desktop file lies
- [pushing-media-without-flashing](pushing-media-without-flashing.md) — put an image or GIF on a key over serial, no reflash
- [frame-pack-format](frame-pack-format.md) — host decodes, deck only blits; the wire format
- [where-content-plays-from](where-content-plays-from.md) — PSRAM if it fits, card if not; and the card's hard 383 KB/s
- [sd-card-storage](sd-card-storage.md) — 4 MB flash is a hard limit; there is a TF slot on SPI
- [flashing-the-panel](flashing-the-panel.md) — CH340 driver, moving COM port, 460800 baud, and the encoding trap
- [firmware-build-status](firmware-build-status.md) — what the board is currently running; the GIF player was deleted and is not in git
- [build-status](build-status.md) — what is printed, what is stale, what has not started
- [dont-run-long-lived-commands](dont-run-long-lived-commands.md) — the user starts dev servers and the app; they hang here
- [firmware-install](firmware-install.md) — the app flashes over USB; never NVS; two esptool-js traps
- [wifi-encryption](wifi-encryption.md) — AES-GCM frames after pairing, both sides must match
- [connection-priority](connection-priority.md) — USB first, Wi-Fi fallback, no manual switch
- [serial-unplug-stall](serial-unplug-stall.md) — a write to an unplugged port never returns and stalls every deck command
- [visual-tweaks-checked-by-hand](visual-tweaks-checked-by-hand.md) — styling changes: lint + UI checks, then hand over; the user checks the live app
