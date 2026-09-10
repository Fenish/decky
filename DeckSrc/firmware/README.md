# Decky firmware

Firmware for the Elecrow CrowPanel Basic 7" (ESP32-S3-WROOM-1-N4R8: 4 MB flash,
8 MB PSRAM, 800 × 480 RGB panel, GT911 touch). It draws the key artwork the
desktop app sends, reports touches as key presses, and talks to the desktop over
USB or encrypted Wi-Fi.

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

Use the Decky desktop app: Settings → Updates, or, for a board that has never
run Decky, the offer on its Disconnected page. Without the app,
`tools/flash.ps1` builds and writes the application; `-Full` writes all four
images, which a first install needs. Flash at 460800 baud, not the board default
of 921600, which corrupts transfers through this board's CH340, and treat a
flash as done only when it ends with `Hash of data verified`.

## Flash layout

From `partitions_deck.csv`:

| Address    | Contents                               | Written by an install                      |
| ---------- | -------------------------------------- | ------------------------------------------ |
| `0x0`      | bootloader                             | yes                                        |
| `0x8000` | partition table | yes; asks first if it changes, since a moved NVS loses the Wi-Fi settings |
| `0x9000`   | NVS: Wi-Fi credentials, pairing secret | never                                      |
| `0xE000`   | boot selector (`boot_app0.bin`)        | yes                                        |
| `0x10000`  | application, 2 MB                      | yes                                        |
| `0x210000` | data partition (unused by this firmware), then core dump | never |

PlatformIO also produces `firmware.factory.bin`, a merged image from `0x0`.
Never install it over a working deck: it runs through NVS and erases the Wi-Fi
settings and pairing. Key artwork is stored on the microSD card
(`/decky-cache/`), which flashing never touches.

## Versions and protocol

- `include/decky_version.h` holds `DECKY_PROTOCOL`, the one number the desktop
  and firmware must agree on. Raise it when the desktop has to change with the
  firmware. The deck reports it in `ID` and `BOOT`.
- `scripts/firmware_version.py` stamps `DECKY_FW_VERSION`: the
  `DECKY_FW_VERSION` environment variable, else `git describe` against the
  newest `firmware-v*` tag, else `dev`. It appears as `fw=` in the `ID` reply.
- Releases are automatic: a push to `main` that changes firmware code gives the
  firmware a new version and publishes it next to the Windows installer
  (`.github/workflows/release.yml`). The firmware version only rises when
  firmware code changed; each rise is marked by a `firmware-v<x.y.z>` tag, so
  run `git fetch --tags` for local builds to report it.

## Wi-Fi security

After the challenge-response handshake in `src/wireless.cpp`, every byte in both
directions goes through `SecureLink` (`src/secure_link.cpp`) as an AES-128-GCM
frame. Its byte format must match the desktop's
`desktop/src/main/device/secure-channel.ts`; change both together and raise
`DECKY_PROTOCOL`.

## Source map

- `lib/panel` - RGB bus, timing, backlight, frame buffer, beam timing, GT911.
  The only code that knows GPIO numbers.
- `lib/keygrid` - key layout in millimetres, conversion to pixels, touch
  hit-testing.
- `src/main.cpp` - the serial protocol, page cache and key drawing.
- `src/wireless.cpp`, `src/secure_link.cpp` - Wi-Fi, discovery, pairing,
  encryption.
- `src/artwork_store.cpp` - artwork persisted on a microSD card.
