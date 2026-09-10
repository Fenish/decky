---
date: 2026-09-10
status: accepted
---

# The desktop app installs firmware itself, with esptool-js

**Context:** the project is open source, and a CrowPanel owner should not need
PlatformIO to use Decky. A new board also runs Elecrow's factory firmware, never
answers as Decky, and so could not even reach the app's Settings.

**Choice:** esptool-js 0.6.1, bundled into the Electron main process, driven
through `device/web-serial.ts` - an adapter that presents `serialport` as a Web
Serial port. Updates live in Settings; a first install is offered on the
Disconnected page for a USB device that stayed silent for two checks, after the
user agrees to restart it and the ROM bootloader confirms an ESP32-S3 with 4 MB
flash. The package is four separate images plus a manifest, never the merged
`firmware.factory.bin`, and a manifest that touches NVS or the flash data
partition is rejected before anything is written.

**Why:** chosen by the user over bundling esptool.exe, for being pure npm and
cross-platform. Proven on the real board before the rest was built: 460800 baud,
four images written and MD5-verified in 20.8 s, deck back on its own.

That test found two things that would otherwise have shipped:

- `serialport`'s `set()` fills omitted lines with "asserted", so esptool-js
  setting RTS alone would also assert DTR and break the reset circuit. The
  adapter tracks both lines and always sends both.
- esptool-js 0.6.1's `after("hard_reset")` only releases RTS, which is already
  released: the chip stays in the flasher stub after every install. The flasher
  pulses RTS itself, esptool's own sequence.

**Rejected:**

- _Bundled esptool.exe._ The more proven path (it is what PlatformIO runs), but
  a Windows binary and a download step in the build; the user preferred npm.
- _Merged factory image._ Runs contiguously through NVS at 0x9000 and would
  erase the Wi-Fi credentials and pairing on every update.
- _Detecting a CrowPanel from the USB IDs._ The CH340 is in thousands of
  devices; only the bootloader's chip and flash answer settles it.

**Revised 2026-09-11:** the first install is one question instead of four steps.
The silent device is offered at once ("Install Decky on it?"), and that one
click restarts it into the bootloader, then installs only on an ESP32-S3 with 4
MB of flash. It still waits for the click, because checking without one would
also restart unrelated hardware on the same USB chip, like a 3D printer
mid-print. The two silent asks now come a second apart within one status check,
and a newly plugged-in port triggers a check within a second. The offer appeared
12-16 s after plugging in before; the estimate is now about 6 s, with Wi-Fi
tried first for a paired deck.

See [[firmware-install]], [[flashing-the-panel]].
