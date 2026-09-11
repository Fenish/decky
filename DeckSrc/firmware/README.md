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
settings and pairing. Key artwork is stored on the microSD card
(`/decky-cache/`), which flashing never touches.

## Reading a crash

A crash (`reset=panic` in `ID`) writes a core dump to the last 64 KB of flash
(`0x3F0000`), and it outlives a power cycle. Read it, then decode it against the
`firmware.elf` of the build that crashed. Any other build names the wrong lines,
so keep the ELF of whatever you flash:

```sh
pip install esp-coredump
python -m esptool --chip esp32s3 --port COM5 --baud 460800 read-flash 0x3F0000 0x10000 coredump.bin
python -m esp_coredump --chip esp32s3 info_corefile --core coredump.bin --core-format raw \
  --gdb ~/.platformio/packages/tool-xtensa-esp-elf-gdb/bin/xtensa-esp-elf-gdb-no-python.exe \
  .pio/build/esp32-s3-devkitc-1-myboard/firmware.elf
```

A partition that reads back as all `FF` means the last restart was not a crash:
a brownout or a power dip leaves nothing. A dump stays until the next crash
overwrites it, so erase it once read (`erase-region 0x3F0000 0x10000`).
Otherwise a later restart can be blamed on an old crash.

## Versions and protocol

- `include/decky_version.h` holds `DECKY_PROTOCOL`, the one number the desktop
  and firmware must agree on. Raise it when the desktop has to change with the
  firmware. The deck reports it in `ID` and `BOOT`.
- A command that an older desktop can do without is announced as a flag in the
  `ID` reply instead: `live=1` means the deck accepts `LIVE` patches for widget
  keys, `drag=1` that it reports finger movement (`EV <page> <cell> MOVE <y>`)
  on the keys the desktop names with `DRAG`, `wheel=1` that it draws and turns
  picker wheels itself (`WHEEL`, `WHEELAT`, `EV <page> <cell> WHEEL <label>`),
  `dial=1` that it also turns dials (version 2 looks,
  `EV <page> <cell> VALUE <value>`), rolls drums to a label (`WHEELROLL`) and
  throws dice (version 3 looks), `warm=1` that while loading it takes every
  page's widget pictures (`LIVE` for pages not shown) and looks sent ahead
  (`WHEEL` with cell -1), counted in its progress, and `block=4096` that it
  takes uploads over USB in blocks of up to 4096 bytes once asked with
  `BLOCK <n>` (back to 128 on `HELLO` and when the desktop goes), and `slide=1`
  that it slides text too long for a key along by itself (`SLIDE`). `reset=`
  names why the deck last started (`esp_reset_reason()`: `poweron`, `ext`, `sw`,
  `panic`, `intwdt`, `taskwdt`, `wdt`, `brownout`, `usb`, `jtag`). Desktops that
  don't know a flag ignore it, and a desktop facing firmware without it leaves
  widgets as their still pictures, so neither side has to be updated first.
  Movement goes only to keys a desktop named: an older desktop takes any line it
  doesn't know for the reply to the command it is waiting on.
- `scripts/firmware_version.py` stamps `DECKY_FW_VERSION`: the
  `DECKY_FW_VERSION` environment variable, else `git describe` against the
  newest `firmware-v*` tag, else `dev`. It appears as `fw=` in the `ID` reply.
  The script writes it to a header in the build folder, rewritten only when it
  changes, so a new version recompiles `main.cpp` alone (a compiler flag would
  rebuild all ~200 files).
- Releases are automatic: a push to `main` that changes firmware code gives the
  firmware a new version and publishes it next to the Windows installer
  (`.github/workflows/release.yml`). The firmware version only rises when
  firmware code changed; each rise is marked by a `firmware-v<x.y.z>` tag, so
  run `git fetch --tags` for local builds to report it. A release whose firmware
  did not change carries the images released under that version, unrebuilt.

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
- `src/main.cpp` - the serial protocol, page cache and key drawing. Serial keeps
  8 KB of what arrives and passes bytes on from the UART once 32 are in (not
  120): with that, uploads can go in 2 KB blocks, and a 24 KB look takes 0.8 s
  rather than 1.7 s. A page copy keeps its own pictures exactly as sent, and
  widget keys' live pictures (`LIVE`) apart from them, so its own pictures
  always match its signature and the card's copy. A new version of a page
  carries the live pictures over, and needs only its changed keys, which come as
  patches (`PATCH`). Live pictures always leave the memory floor and a whole
  page's worth in one piece free. Without room for one, `LIVE` is refused rather
  than drawn into the page's own pictures. Slots keep their buffers once they
  have one, so memory never breaks into pieces too small for a page.
- `src/wheel.cpp` - picker wheels the deck turns itself: the looks the desktop
  sends (kept by CRC), the drum they are drawn on, following the finger, the
  coast after a flick and the spring onto a label, or a roll to a label the
  desktop picked (a coin, yes or no, a list). Dials too (the volume): each pixel
  is the key at its lowest or its highest, by a per-pixel map against the value
  the finger sets, with the number drawn on top. And dice: a cube drawn in 3D (a
  small rasteriser: each face a parallelogram walked row by row, lit by how it
  faces the light, rounded and darker at its edges, its pips as small ellipses,
  a soft shadow under it), thrown by `WHEELROLL` - tumbling through the air,
  hopping, bouncing off the key's edges, rolling the way it goes, then lying
  flat where it stops; `EV WHEEL` says how it lies. The throw is fair: where its
  tumble ends is a random unit quaternion, reached exactly (by time, not
  integrated), and on the table the spin comes from the roll, so the cube's
  symmetry keeps every face as likely. Composing a drum's frame takes about 4.3
  ms and a die's about 5 ms; both run at the panel's refresh (it is about 54
  Hz), between transfer blocks too. The file is built with `-O2` and fast-math:
  with the defaults a die's frame took 10-15 ms. Animated keys belong here
  rather than in the desktop, whose pictures take 20-130 ms each over USB.
- `src/slide.cpp` - text too long for its key (a song's title), slid along by
  the deck: up to two lines, each as coverage the desktop drew in its font, laid
  in one colour over the key's picture inside its window. It rests, slides, and
  its start comes round after a gap; the edges fade. Only the rows the text
  covers are written, each time it has moved a pixel, when the beam is clear of
  them. The text hangs off the page copy it was sent for (`texts` in
  `CachedPage`) and goes with it, so `LIVE` pictures change under it and a new
  version of the page starts without it.
- `src/live_patch.cpp` - decoding `LIVE` patches, for widget pictures and a
  wheel's backdrop.
- `src/wireless.cpp`, `src/secure_link.cpp` - Wi-Fi, discovery, pairing,
  encryption.
- `src/artwork_store.cpp` - artwork persisted on a microSD card.
