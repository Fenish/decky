---
name: firmware-install
type: constraint
---

The desktop app installs firmware over USB with esptool-js: the four images
PlatformIO's upload writes (bootloader 0x0, partition table 0x8000, boot_app0
0xE000, app 0x10000), each MD5-verified on the chip, at 460800 baud. It never
writes NVS (0x9000: Wi-Fi credentials, pairing secret) or anything from 0x210000
on, and never the merged `firmware.factory.bin`, which runs through NVS. Key
artwork is on the microSD card and untouched by any install.

Packages come from `desktop/resources/firmware/` (written by the PlatformIO
post-build script `scripts/bundle_for_desktop.py`) or the newest GitHub release,
both as `manifest.json` plus images with SHA-256 and MD5. The firmware version
is read from the manifest, never from the release tag. See [[release-pipeline]].
The protocol number lives only in `firmware/include/decky_version.h`.

Two traps, found on the real board: `serialport`'s `set()` asserts any line left
out, so both DTR and RTS are always sent; and esptool-js 0.6.1's
`after("hard_reset")` never resets the chip, so the flasher pulses RTS itself.

**Why it matters:** writing NVS silently unpairs the deck and forgets its Wi-Fi;
either trap makes a healthy deck look dead after an install.

See [[flashing-the-panel]], [[decisions/2026-09-10-desktop-flasher]].
