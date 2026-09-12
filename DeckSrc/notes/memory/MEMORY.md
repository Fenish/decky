# Memory index

Durable facts about this project. One file per fact — read these before assuming
project context.

- [crowpanel-display](crowpanel-display.md) — the panel everything is
  dimensioned from
- [fusion-source-of-truth](fusion-source-of-truth.md) — measure in Fusion, never
  from memory
- [fusion-file-split](fusion-file-split.md) — which Fusion file holds what
- [print-support-free](print-support-free.md) — no supports, Bambu Studio, test
  prints
- [key-grid-layout](key-grid-layout.md) — 5x3, cell pitch, pixel-aligned
  openings
- [touch-input](touch-input.md) — GT911 on 0x14, no expander needed, no switches
- [no-visible-screws](no-visible-screws.md) — top cover stays clean, fasten from
  below
- [monitor-mount-scheme](monitor-mount-scheme.md) — magnet plate, clamp, GoPro
  joints, measured limits
- [open-source-unnamed](open-source-unnamed.md) — public open-source project
  named Decky; do not rename
- [decky-desktop](decky-desktop.md) — Decky identity, rewrite, black defaults,
  toggles, firmware and startup fix
- [bom](bom.md) — parts list, and the half of it the touch change killed
- [panel-pclk-limit](panel-pclk-limit.md) — 24 MHz pixel clock, bounded by
  bounce buffer size, not by the panel
- [screen-tearing-fix](screen-tearing-fix.md) — beam-synchronised writes, not
  double buffering
- [gif-encoding-for-the-panel](gif-encoding-for-the-panel.md) — full frames, no
  duplicates, and why the desktop file lies
- [pushing-media-without-flashing](pushing-media-without-flashing.md) — put an
  image or GIF on a key over serial, no reflash
- [frame-pack-format](frame-pack-format.md) — host decodes, deck only blits; the
  wire format
- [where-content-plays-from](where-content-plays-from.md) — PSRAM if it fits,
  card if not; and the card's hard 383 KB/s
- [sd-card-storage](sd-card-storage.md) — 4 MB flash is a hard limit; there is a
  TF slot on SPI
- [flashing-the-panel](flashing-the-panel.md) — CH340 driver, moving COM port,
  460800 baud, and the encoding trap
- [firmware-build-status](firmware-build-status.md) — what the board is
  currently running; the GIF player was deleted and is not in git
- [build-status](build-status.md) — what is printed, what is stale, what has not
  started
- [dont-run-long-lived-commands](dont-run-long-lived-commands.md) — the user
  starts dev servers and the app; they hang here
- [firmware-install](firmware-install.md) — the app flashes over USB; never NVS;
  two esptool-js traps
- [wifi-encryption](wifi-encryption.md) — AES-GCM frames after pairing, both
  sides must match
- [connection-priority](connection-priority.md) — USB first, Wi-Fi fallback, no
  manual switch
- [serial-unplug-stall](serial-unplug-stall.md) — a write to an unplugged port
  never returns and stalls every deck command
- [visual-tweaks-checked-by-hand](visual-tweaks-checked-by-hand.md) — styling
  changes: lint + UI checks, then hand over; the user checks the live app
- [release-pipeline](release-pipeline.md) — every product-code push to main
  releases itself; firmware has its own version
- [app-self-update](app-self-update.md) — installed Decky updates itself via
  electron-updater, differentially (blockmap, ~3 MB); the silent install is not
  yet seen on a real install
- [titlebar-drag-regions](titlebar-drag-regions.md) — nothing over the title
  bar's buttons may belong to the title bar; it steals their clicks
- [rgb-scanout-slip](rgb-scanout-slip.md) — a wrapped, shifted picture is the
  driver's bounce parity flipped by flash stalls; guarded every VSYNC, re-init
  never fixed it
- [packaging-drops-files](packaging-drops-files.md) — electron-builder silently
  drops *.obj and other extensions; package-check.mjs guards the installer
- [electron-run-as-node](electron-run-as-node.md) — shells here set
  ELECTRON_RUN_AS_NODE=1; unset it to launch Electron or the packaged app
- [deck-first-for-animation](deck-first-for-animation.md) — animated or heavy
  keys run on the deck; static or occasional ones are drawn by the app
- [widgets](widgets.md) — drawn by the app, LIVE-patched onto the deck;
  time-free base pictures, patched keys tracked per deck copy, every page warmed
  while loading, sound and prices as events, long titles slid by the deck,
  retired settings dropped on load
- [speedtest](speedtest.md) — our own Speedtest.net client: ask c.speedtest.net
  first or Istanbul gets Liechtenstein; one dropped connection must not fail the
  run
- [usb-upload-blocks](usb-upload-blocks.md) — 2 KB acknowledged blocks after
  BLOCK, thanks to the 8 KB receive buffer; test tools must honour READY's size
- [deck-restart-diagnosis](deck-restart-diagnosis.md) — why the deck restarted:
  `reset=`, deck.log, the core dump (empty means power), error 31 means replug
- [firmware-golden-run](firmware-golden-run.md) — prove a firmware change keeps
  behaviour: tools/golden_run.py record, flash, check (replies + screens)
- [generic-over-copies](generic-over-copies.md) — handler tables, not chains;
  one generic module told what it is, never per-type wrapper files
- [boot-loads-everything](boot-loads-everything.md) — nothing may be slow the
  first time after boot: every look, state and helper is loaded while the deck
  loads
- [discord-mute-state](discord-mute-state.md) — mute/deafen from Discord's local
  storage, ~5 s behind; RPC voice refused even for Decky's own app
- [discord-rich-presence](discord-rich-presence.md) — the public app ID is all
  it needs; never "Playing", only one of those shows
- [discord-rpc-control](discord-rpc-control.md) — full RPC control via
  StreamKit; channel members without joining; camera and stream state from
  Windows
- [integrations](integrations.md) — third-party apps (OBS first): declared in
  shared/integrations, a service each in main, widgets grouped by app
- [user-does-testing](user-does-testing.md) — the user tests on the deck and in
  the app; Claude checks the code and hands over
