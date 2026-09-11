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
  `BLOCK <n>` (back to 128 on `HELLO` and when the desktop goes), `slide=1`
  that it slides text too long for a key along by itself (`SLIDE`), and
  `sweep=1` that it moves rings' arcs by itself (`SWEEP`). `reset=`
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

After the challenge-response handshake in `src/network/wireless.cpp`, every byte
in both directions goes through `SecureLink` (`src/security/secure_link.cpp`) as
an AES-128-GCM frame. Its byte format must match the desktop's
`desktop/src/main/device/secure-channel.ts`; change both together and raise
`DECKY_PROTOCOL`.

## Layout

One `Deck` (`src/deck/deck.h`) owns every part; `src/main.cpp` makes it and runs
it. Each folder is one area, and most areas are a class or two:

```text
lib/panel/        RGB bus, timing, backlight, framebuffer, beam timing, GT911.
                  The only code that knows GPIO numbers.
lib/keygrid/      Key layout in millimetres, conversion to pixels, touch hit-testing.
include/          decky_version.h: the protocol, and the stamped firmware version.
src/
  main.cpp        setup() and loop(): the Deck.
  deck/           Deck: the main loop, and the parts' owner. Session (what the deck
                  knows of the desktop), StatusScreen (the logo, loading bar and
                  "Disconnected"), SessionCommands (ID, HELLO, PING, BLOCK, DRAG...).
  protocol/       CommandRouter (each line to the CommandSet that knows it),
                  Transfer (READY and acknowledged blocks), why the deck last started.
  pages/          Page (a copy of a page), PageCache (the slots, versions and memory
                  rules), PageCommands (CACHE, PATCH, COMMIT, STATE, LIVE, SLIDE,
                  SWEEP...), and the LIVE patch format.
  display/        Screen (writes only where the scanout is not), KeyView (the keys
                  of the page shown: animation, ON picture, live, own; overlays,
                  outline).
  input/          Touch (a finger on a key: press, move, release) and DragReport
                  (MOVE lines for keys the desktop named).
  keys/           Keys the deck animates by itself. AnimatedKeys (the 15 keys and
                  the looks kept by CRC), KeyAnimation (what each kind implements),
                  Look (what the desktop sends, one subclass a kind), KeyCommands
                  (WHEEL, WHEELAT, WHEELROLL), glyphs (text drawn from the desktop's
                  coverage), KeyOverlay (what the deck moves over a key's picture,
                  one subclass a kind).
    drum/         Picker wheels: countdowns, lists, the coin.
    dial/         The volume: arc and bar.
    die/          The die: its look and physics (die.cpp), drawing (die_render.cpp),
                  shape and view (die_shape.h), rotations.
    text/         SlidingText: titles too long for their key.
    sweep/        Sweep: a ring's arc - OBS's countdown.
  storage/        The SD card cache (artwork_store), saved a slice at a time.
  network/        Wi-Fi, discovery, pairing, and the command stream over either link.
  security/       SecureLink: AES-128-GCM frames.
  common/         KeyImage (a key's picture size), PSRAM helpers, CRC-32, the byte
                  reader, colour blending.
```

Choices go through tables, not long `if`/`else` chains:

- **A new command** is a row in its set's table (`{"NAME", &Set::method}`) and a
  method that parses its line.
- **A new group of commands** is a `CommandTable` subclass, added to the router
  in `Deck`'s constructor.
- **A new kind of animated key** is a folder under `keys/`: a `Look` subclass
  for what the desktop sends (a row in `Look::parse`'s version table), and a
  `KeyAnimation` for how it moves and draws.
- **A new kind of overlay** is a folder under `keys/` with a `KeyOverlay`
  subclass, a `Kind`, a row in `page_commands.cpp`'s `OVERLAY_KINDS`, and a
  command that reads its line into `PageCommands::overlay`.
- **The Wi-Fi commands** (`network/wireless.cpp`) and the reset reasons
  (`protocol/identity.cpp`) are tables too.

Notes on what matters in each area:

- **Serial** keeps 8 KB of what arrives and passes bytes on from the UART once
  32 are in (not 120). With that, uploads can go in 2 KB blocks, and a 24 KB
  look takes 0.8 s rather than 1.7 s (`Deck::begin`, `Transfer`).
- **Page copies** keep their own pictures exactly as sent, and widget keys' live
  pictures (`LIVE`) apart from them, so their own pictures always match their
  signature and the card's copy.
  - A new version of a page carries the live pictures over, and needs only its
    changed keys, which come as patches (`PATCH`).
  - Live pictures always leave the memory floor and a whole page's worth in one
    piece free. Without room for one, `LIVE` is refused rather than drawn into
    the page's own pictures.
  - Slots keep their buffers once they have one, so memory never breaks into
    pieces too small for a page (`PageCache`).
  - A committed page is shown first, then written to the card by the main loop
    in 8 KB slices, one per pass (`artwork_store::step`). `COMMIT` answers in
    about 6 ms, and touches and animations keep going while the card is written,
    about 0.7 s for a page of 15 lit keys. One save is under way at most.
    Anything else that reads or reuses a page finishes it first, so a page's
    pictures never change under its save. A failed save shows as `stored=0` in
    the next `COMMIT` reply.
- **Looks** are kept by CRC, one for every key and one more arriving to take
  over from one of them (`AnimatedKeys::LOOKS`). A look a key is armed with is
  never dropped for another, so every key the page turns keeps turning. Looks
  no key uses go first, least lately armed, and also when PSRAM runs short
  (`memory::spare`, the rule live pictures follow); with no room even then,
  `WHEEL` answers `ERR wheel memory`.
- **Drums** follow the finger, coast after a flick and spring onto a label, or
  roll to a label the desktop picked (a coin, yes or no, a list).
- **Dials** take each pixel from the key at its lowest or its highest, by a
  per-pixel map against the value the finger sets, with the number (the arc's)
  drawn on top.
- **The die** is drawn in 3D by a small rasteriser.
  - Each face is a parallelogram walked row by row, lit by how it faces the
    light, rounded and darker at its edges, with its pips as small ellipses and
    a soft shadow under it.
  - `WHEELROLL` throws it: it tumbles through the air, hops, bounces off the
    key's edges and rolls the way it goes, then lies flat where it stops.
    `EV WHEEL` says how it lies.
  - The throw is fair. Where its tumble ends is a random unit quaternion,
    reached exactly (by time, not integrated), and on the table the spin comes
    from the roll, so the cube's symmetry keeps every face as likely.
- **Speed of animated keys:** a drum's frame takes 3-4 ms and a die's about 5
  ms. Both run at the panel's refresh (about 54 Hz), between transfer blocks
  too. `keys/` is built with `-O2` and fast-math (a pragma at the top of each
  file): with the defaults a die's frame took 10-15 ms. Animated keys belong on
  the deck rather than in the desktop, whose pictures take 20-130 ms each over
  USB.
- **Overlays** are what the deck moves over a key's picture by itself, while
  `LIVE` pictures change underneath: a key has at most one of each kind. Each
  frame composes the key's rows from its picture and lays each overlay over
  them in turn. Only the rows they cover are written, each time one has moved,
  when the beam is clear of them (`KeyView::overlay_frames`). They ride on the
  key's live picture and go with it: carried into a page's new version, dropped
  with it, and dropped on `HELLO` and disconnect.
- **Sliding text** (`keys/text`) has up to two lines, each as coverage the
  desktop drew in its font, laid in one colour over the key's picture inside its
  window. It rests, slides, and its start comes round after a gap; the edges
  fade. It moves a pixel at a time.
- **Rings' arcs** (`keys/sweep`) are stroked from the top, clockwise, with round
  ends and a glow, antialiased from a map made when the arc arrives: each
  pixel's angle and how much of the colour the whole ring gives it. A frame
  compares each pixel's angle with where the end is now, and works out the round
  ends near the two ends only. The end moves with the desktop's clock - `SWEEP`'s
  line carries it as sent - so an arc is sent once for as long as its motion
  holds, and redrawn each time its end has moved a quarter of a pixel. The map
  takes memory on the terms live pictures do (`memory::spare`).
- **Checking a change:** the firmware has no unit tests. A change that should
  not alter behaviour is checked on the deck with `tools/golden_run.py`:
  - run `record` on the build before the change;
  - flash the change, then run `check`.

  It drives every command the desktop uses in a fixed order. Then it compares
  every reply, and two screen captures pixel for pixel.
