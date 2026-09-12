# Decky firmware

Firmware for the Elecrow CrowPanel Basic 7" (ESP32-S3-WROOM-1-N4R8: 4 MB flash,
8 MB PSRAM, 800 × 480 RGB panel, GT911 touch). It draws the keys the desktop app
sends, reports touches, and talks to the app over USB or encrypted Wi-Fi. This
file is how to build, flash and check it; how it works is in
[`../notes/`](../notes/).

## Build

```sh
pip install platformio
pio run -d DeckSrc/firmware
```

A successful build copies the four flash images and `manifest.json` into
`../desktop/resources/firmware/`, where the desktop app installs them from. Set
`DECKY_BUNDLE_DIR` to put them elsewhere. The copy runs when `firmware.bin` is
relinked; after deleting the desktop folder, rebuild with
`pio run -d DeckSrc/firmware -t clean` first.

The toolchain is pinned in `platformio.ini`: the pioarduino platform,
arduino-esp32 and LovyanGFX only drive this panel correctly together, with
Elecrow's `Bus_RGB` patch applied by `scripts/patch_lovyangfx.py`. Do not bump
them independently.

## Install

Use the desktop app: Settings → Updates, or the offer on its Disconnected page
for a board that has never run Decky. Without the app, `tools/flash.ps1` builds
and writes the application; `-Full` writes all four images, which a first
install needs.

Flash at 460800 baud, not the board default of 921600, which corrupts transfers
through this board's CH340. A flash counts as done only when it ends with
`Hash of data verified`.

## Flash layout

From `partitions_deck.csv`:

| Address    | Contents                                                 | Written by an install                                                     |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `0x0`      | bootloader                                               | yes                                                                       |
| `0x8000`   | partition table                                          | yes; asks first if it changes, since a moved NVS loses the Wi-Fi settings |
| `0x9000`   | NVS: Wi-Fi credentials, pairing secret                   | never                                                                     |
| `0xE000`   | boot selector (`boot_app0.bin`)                          | yes                                                                       |
| `0x10000`  | application, 2 MB                                        | yes                                                                       |
| `0x210000` | data partition (unused by this firmware), then core dump | never                                                                     |

PlatformIO also produces `firmware.factory.bin`, a merged image from `0x0`.
Never install it over a working deck: it runs through NVS and erases the Wi-Fi
settings and pairing. Key artwork lives on the microSD card (`/decky-cache/`),
which flashing never touches.

## Versions

`include/decky_version.h` holds `DECKY_PROTOCOL`, the one number the desktop and
the firmware must agree on; raise it when the desktop has to change with the
firmware. Anything an older desktop can do without is announced as a flag in the
`ID` reply instead, so neither side has to be updated first.

`scripts/firmware_version.py` stamps `DECKY_FW_VERSION` from the environment
variable, else `git describe` against the newest `firmware-v*` tag, else `dev` —
so run `git fetch --tags` if you want a local build to report its version.
Releases are automatic on a push to `main` that changed firmware code.

## Checking a change

There are no unit tests. A change that should not alter behaviour is checked on
the deck with `tools/golden_run.py`: run `record` on the build before the
change, flash the change, then run `check`. It drives every command the desktop
uses in a fixed order, then compares every reply and two screen captures pixel
for pixel.

A crash (`reset=panic` in `ID`) leaves a core dump in the last 64 KB of flash;
reading and decoding it is in `../notes/memory/deck-restart-diagnosis.md`.
