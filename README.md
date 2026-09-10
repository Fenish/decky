# Decky

Decky is a touch control surface built around an Elecrow CrowPanel Basic 7-inch
ESP32-S3 display. Each of its fifteen touch keys can run a hotkey, launch a
program, open a website, run a PowerShell script, play a macro or open a page of
keys on a Windows PC. Keys work as plain buttons or as toggles with separate OFF
and ON artwork, and unassigned keys stay pitch black. The deck connects over USB
or Wi-Fi and sits in a 3D-printed enclosure that hangs under a monitor.

## Repository

- [`DeckSrc/desktop`](DeckSrc/desktop): the Windows control panel (Electron and
  React). Its README covers running, building, features and architecture.
- [`DeckSrc/firmware`](DeckSrc/firmware): PlatformIO firmware for the panel.
- [`DeckSrc/notes`](DeckSrc/notes/memory/MEMORY.md): hardware, firmware and
  protocol notes.
- [`3D Models`](3D%20Models): CAD export and 3MF print files for the enclosure
  and clamp.
- [`Branding`](Branding): logo sources.
