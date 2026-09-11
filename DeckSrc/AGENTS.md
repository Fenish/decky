# Decky

Decky is a self-built stream deck: an Elecrow CrowPanel Basic 7" (ESP32-S3)
display with 15 touch keys, a Windows desktop app that runs each key's action
over USB or Wi-Fi, and a 3D-printed enclosure that hangs under a monitor on a
printed clamp.

| Path                            | Contents                                                |
| ------------------------------- | ------------------------------------------------------- |
| `firmware/`                     | PlatformIO firmware for the panel                       |
| `desktop/`                      | Electron + React control panel; see `desktop/README.md` |
| `notes/`                        | Project memory, decisions and the dated journal         |
| `../3D Models/`, `../Branding/` | Original CAD exports and logo sources                   |

The mechanical design lives in Fusion 360, not in this repository.

## Read first

`notes/memory/MEMORY.md` indexes durable facts about the hardware, firmware and
protocol. Read it before assuming anything, and check a fact against the code or
Fusion before acting on it.

## Rules

- **Fusion is the source of truth for dimensions.** Measure in Fusion through
  the MCP connection; never act on a dimension remembered from chat or copied
  from notes. Keep each part's build notes current in its Fusion component
  description.
- Every printed part prints without support.
- No visible screws on the top cover; all fastening is from below.
- The project is named **Decky**. Do not rename it.
- Unassigned keys are pitch black, with no numbers, placeholders or tint, on the
  deck and in the app.
- `Branding/` and `3D Models/` hold originals. The app uses derived copies; do
  not edit the source files.

## Working in this repository

- **Do not start long-lived processes** such as `pnpm dev`, `electron` or file
  watchers. They hang the agent session; the user starts the app. Use commands
  that exit on their own.
- **Desktop checks**, from `desktop/`: `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, and `pnpm test:ui` for interface changes. Run the ones that cover
  a change before reporting it done.
- **Firmware toolchain is pinned.** The PlatformIO platform, arduino-esp32,
  LovyanGFX and the `Bus_RGB` patch only work together at their pinned versions;
  do not bump them.
- **Flashing:** set `PYTHONIOENCODING=utf-8` and use 460800 baud. A flash
  succeeded only if the output ends with `Hash of data verified`; PlatformIO can
  print `[SUCCESS]` after a failed write.
- **Serial port:** the deck's COM port changes between sessions, so look it up
  instead of reusing one. Decky holds the port while it runs, including from the
  tray; the user must quit it from the tray before a flash. Never assert DTR or
  RTS when opening the port: they are wired to reset. If Windows refuses to open
  a present port with error 31, the CH340 driver is wedged; the USB cable has to
  be replugged.
- **Protocol changes** go in `firmware/include/decky_version.h`, the only copy
  of `DECKY_PROTOCOL`. Raise it whenever the desktop must change with the
  firmware, and teach the desktop's `parseIdentity` the new number.
- **Wi-Fi framing** exists twice, `firmware/src/security/secure_link.cpp` and
  `desktop/src/main/device/secure-channel.ts`. Change both together; nothing
  after the pairing handshake may travel unencrypted.
- **Never install `firmware.factory.bin`** on a working deck, and never let a
  firmware package write the NVS region: it holds the Wi-Fi settings and the
  pairing secret. `desktop/src/shared/firmware.ts` enforces this for the app.
- **Connections:** USB first, Wi-Fi only without a cable. Do not add a manual
  transport switch.

## Keep instruction files stateless

This file, `CLAUDE.md` and every README describe how the project is and how to
work on it. They contain no dates, history, progress reports or plans. Those go
in `notes/`:

- durable facts: `notes/memory/`, indexed in `MEMORY.md`
- why a choice was made: `notes/decisions/`
- what happened on a given day: `notes/journal/YYYY-MM-DD.md`

When behavior described in one of these files changes, update the description in
place rather than appending a dated note.
