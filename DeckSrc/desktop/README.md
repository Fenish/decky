# Decky desktop

Decky is the Windows control panel for this project's CrowPanel Basic 7-inch touch deck. New
workspaces contain one empty Home page. **Unassigned keys are exactly black**, without numbers, plus
signs, or colored backgrounds. The app does not populate example assignments; sample keys in design
previews are test fixtures.

## Run and build

From `DeckSrc/desktop`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`dev` and `preview` first run `scripts/ensure-electron.mjs`, which installs the Electron executable
when it is missing. Without it, Electron 44's on-demand installation conflicts with electron-vite
5's direct `path.txt` lookup and fails with `Error: Electron uninstall`.

Checks and packaging, each of which exits on its own:

```powershell
pnpm build
pnpm lint
pnpm test
pnpm test:ui
pnpm test:visual
pnpm package
pnpm dist
```

UI/visual checks use a temporary headless Chrome instance and route built files directly, without a
server or Electron launch. Chrome must be installed. Screenshots and local test artifacts go to
`output/`. The executable is `dist/win-unpacked/Decky.exe`; `dist` creates an NSIS installer. Builds
are not code-signed; signing requires a publisher certificate.

Closing the window keeps Decky in the system tray so hardware actions continue working. Quit through
the tray menu.

## Using keys

- Select an empty key to choose an action, or an assigned key to edit it. The floating grid shrinks
  and slides left while the editor opens on the right. Close the editor to recenter the grid.
  Configure the action and choose **Save**.
- The bottom dock opens Keys, Appearance for the selected key, Pages, and Settings. Tooltips keep
  the interface minimal.
- Key labels are optional. A blank label centers the icon in both the UI and device pixels.
  Background colors are independently configurable for OFF and ON appearances.
- A custom draggable title bar displays the white Decky logo with minimize, maximize/restore and
  close controls. The application and tray icon is the white app logo, trimmed to fit, with
  transparent surroundings.
- **Hotkey:** **Auto-assign key** is on by default and reserves a free combination of F13–F24 with
  Ctrl, Alt and Shift (96 in total). The key field stays hidden; to bind it in another application,
  start recording the shortcut there and press **Test**. A reserved combination never changes, and
  duplicating the key reserves a new one. Turn auto-assign off to type or record a combination
  yourself: Ctrl, Alt, Shift, named keys and F1–F24 are supported, and Windows-key combinations are
  rejected rather than sent without the modifier.
- **Launch program:** choose a Windows `.exe`. It launches directly, without a command shell.
- **Website:** HTTP(S) URLs open in the default browser.
- **Script:** choose a local PowerShell `.ps1`. Background execution and waiting are separate
  options. Waiting defaults to 30 seconds; 0 means unlimited. Disable waiting for independent
  sessions such as SSH. Other keys remain usable while scripts run.
- **Macro:** up to 32 ordered hotkey, program, website, script or delay steps. Reorder with arrows.
  Errors stop the sequence. Delays support 50–30,000 ms. Quitting Decky cancels a running action;
  processes a script launches independently are not necessarily terminated.
- **Normal:** run once per press. **Toggle:** each successful press runs the same action and
  switches OFF/ON. Each state has its own image, label, icon, color, zoom, position, rotation and
  brightness. Failed actions do not flip state. State belongs to the running Decky session and
  resets on quit; it does not read an external application's state.
- **Pages:** create a named page and assign an Open page action to any key, including key 2. Every
  nested page reserves key 11 (bottom left) for Back. Double-click a folder in edit mode to open it.
  Page IDs remain stable after renames.
- **Images:** PNG, JPEG and WebP up to 12 MB. Sources are resized to at most 640 pixels before
  storage. Adjustments are nondestructive.
- Selecting a key edits it. **Test** saves the visible settings and executes that key. Importing
  profiles never executes their actions.

## Structure

```text
src/
  shared/                 Configuration, validation, typed IPC contracts
  main/
    actions/              Action runner, hotkey helper, toggle state
    config/               Atomic saves, recovery copies, legacy migration
    device/               Serial and Wi-Fi links, encrypted framing, firmware flashing
    index.ts              Electron lifecycle and validated IPC orchestration
  preload/                Narrow contextBridge API
  renderer/
    public/models/        Deck CAD model (OBJ) shown on the disconnected screen
    src/
      app/                Connection/session state, workspace orchestration and preview adapter
      components/         Shared icons
      features/
        editor/           Key/action and macro editors, optional starter layout
        artwork/          Import, adjustments, OFF/ON preview, RGB565 rendering
        connection/       Smooth obsidian disconnected screen, actual OBJ and camera transition
        dashboard/        Floating grid, sliding editor slot, pages/settings panels
        firmware/         Install progress, first install on the Disconnected page
      assets/             White SVG logo and generated artwork
      styles/             True-dark theme and responsive layout
resources/                Application and tray icons
scripts/                  Bounded UI, visual and hardware checks
tests/                    Configuration, persistence, wire timing, actions, toggles
```

The renderer cannot access Node, arbitrary files, raw IPC or arbitrary serial commands. Main
handlers validate the sender and data. Imported images are bounded raster data URLs, never remote
URLs or imported SVG markup. Profile import uses native confirmation and backs up the current
profile. Configuration lives in `%APPDATA%/Decky/decky.json`. When no Decky configuration exists,
shortcuts from `%APPDATA%/deck-studio/bindings.json` are imported and that file is left untouched;
program bindings without an executable path are skipped.

## Wi-Fi

Set up Wi-Fi with the USB data cable attached: Settings → Wireless → Find Wi-Fi networks, select a
network, enter its password, and connect. Decky uses USB whenever the cable answers and falls back
to Wi-Fi only without it; plugging the cable back in returns to USB, once the USB device answers
with the same serial number. There is no manual switch. The title bar shows which connection is in
use, and a notification says when a lost USB link continues over Wi-Fi. The deck and PC must be on
the same local network. The panel supports
[2.4 GHz Wi-Fi](https://www.espressif.com/en/products/socs/esp32-s3); WPA enterprise login and
hidden networks are not supported.

Credentials are saved in the device's NVS after a successful connection, so it reconnects after a
power cycle. Wi-Fi passwords are not saved in the desktop profile. USB provisions a random pairing
key; Windows protects the desktop copy with Electron safeStorage in wifi-pair.json. TCP port 47561
uses a fresh HMAC-SHA256 challenge with proofs from both endpoints. Unpaired connections cannot
submit protocol commands or send accepted key events. Local UDP discovery on port 47562 finds a
paired deck after IP changes. Changing networks requires the USB cable. No cloud service or router
port forwarding is needed.

Settings → Wireless → Forget (USB only, after a confirmation) removes the saved network from the
deck's NVS and deletes this PC's pairing file for that deck. The deck keeps its pairing key, so
joining a network again pairs the PC with the same key.

After the handshake, every byte in both directions travels in an AES-128-GCM frame: a 2-byte length,
the ciphertext, and a 16-byte tag. Each direction has its own key, HMAC-SHA256(pairing secret,
label + challenge) truncated to 16 bytes, and its own frame counter, which forms the nonce and is
never sent. A frame that is altered, injected, replayed or reordered fails authentication and ends
the connection, so nobody on the same network can send commands to the deck or fake key presses to
the PC. The deck marks its challenge `aesgcm1`; firmware without it (before protocol 7) is not used
over Wi-Fi. The format is pinned by `tests/secure-channel.test.ts` and implemented in the firmware
by `src/secure_link.cpp`.

The common command/image protocol runs over either USB or TCP, including preloaded per-key toggles.
USB uses 128-byte acknowledgement blocks; TCP negotiates 4096-byte blocks in `READY 4096` and reads
data in bulk. Wi-Fi scans run asynchronously; waiting for scan results does not occupy the desktop
action queue. Network tests cover pairing and both transfer block sizes.

With a microSD card, base pages and every toggle's ON image are saved under `/decky-cache/`. Black
cells occupy only metadata. Files have dimension/length/CRC checks and are replaced through
temporary/backup files. No formatting or removal of unrelated card files occurs. At startup the
desktop sends hashes; matching artwork loads directly from SD into PSRAM, so unchanged profiles need
no image upload. The card is mounted at boot. Without a card, faster TCP still works, but artwork
remains volatile, and Settings asks for a card.

The firmware preloads up to eight static pages in PSRAM, with two additional staging slots and a 768
KB memory floor. All configured pages are prepared at connection before the active page appears.
Profiles over eight pages fall back to active-page loading with a capacity message. The desktop is
the durable source; cached pages disappear on reset. No SD card is required.

The handshake is `OK id decky 7 ... cache=8 storage=1 fw=<version>`; `storage=1` means a card is
mounted. Over USB the desktop also accepts firmware v2–v6 and the `streamdeck 1` touch-test
handshake. GPIO, RGB display timing and GT911 touch settings live in `../firmware/lib/panel/`.

Toggle OFF frames form the base page; each ON frame is uploaded separately at connection or when
artwork changes. Successful actions send only a `STATE` bitmask from the main process. Alternating
different toggles never creates another page image or triggers renderer image synchronization.
Firmware redraws only changed cells. Alternate images share the existing PSRAM budget and memory
floor.

- `ID`: identity and real key geometry.
- `HELLO <page-count>`: show the white Decky logo and loading progress in the center key.
- `CACHE <index> <CRC32>`: stage a page without displaying it; progress advances after each
  cell/page.
- `ALT <index> <page-CRC32> <cell> <bytes> <image-CRC32>`: upload an ON image with the same
  READY/128-byte ACK protocol. Already-cached artwork returns immediately.
- `STATE <index> <page-CRC32> <mask>`: select preloaded OFF/ON artwork independently for every key,
  without image transfer. An unchanged mask redraws nothing.
- `PING`: desktop heartbeat every four seconds, including while hidden in the tray. A 12-second
  lapse shows Disconnected; `BYE` does so immediately on quit.
- `BOOT decky 7`: unsolicited reset event; triggers cache restoration again.
- `SDINFO`: mounted-card status and capacity. Commit/alternate replies report `stored=1` after
  successful persistence.
- `PAGE <index> <CRC32>`: load a cached page or stage a transfer. `cached=1` skips uploading.
  `copied=1 base=<CRC>` permits changed-key transfers from the current page.
- `PUSH <cell> <bytes> <CRC32>`: little-endian RGB565, exactly `width × height × 2` bytes. `READY`
  means **128-byte USB blocks**; `READY 4096` means **4096-byte TCP blocks**. Each block is
  acknowledged by `A`; require `OK image` at completion.
- `BLANK <cell>`: stage a black key without sending an image.
- `COMMIT <CRC32>`: display only when every cell is ready. Failed/abandoned transfers preserve the
  prior page.
- `ABORT`: discard an incomplete transfer.
- `SCREEN`: read the actual 800 × 480 RGB565 framebuffer. `../firmware/tools/capture_screen.py`
  saves it as a PNG without resetting the board.

Touch input and desktop actions are suppressed during transitions, so a new page's action cannot run
while the old artwork remains visible.

The program picker searches installed Start-menu, registered and Store apps with native icons. The
Lucide picker shows a short default set and searches the full library. Appearance, editor header and
selected deck key share the same canvas renderer and update before saving. Icon/text spacing moves
both as a centered group; labels use the accent color. Hover over an uploaded image to remove it.
The dock duplicates the selected key; drag a key onto an empty cell to move it or an occupied cell
to swap it.

## Firmware

Decky installs the deck's firmware itself, over USB.

- **Update:** Settings → Firmware shows the installed version and offers a newer one when the app
  carries it or GitHub has it (Check GitHub for updates). Updating needs the USB cable; over Wi-Fi
  the section says so.
- **First install:** a CrowPanel still running other firmware never answers as Decky. When a
  USB-serial device stays silent for two checks, the Disconnected page offers to check it. Checking
  restarts it into the chip's ROM bootloader after the user agrees; the install button appears only
  for an ESP32-S3 with 4 MB of flash.
- **What is written:** the four images PlatformIO's upload writes - bootloader at `0x0`, partition
  table at `0x8000`, boot selector at `0xE000`, application at `0x10000` - at 460800 baud, each
  verified by MD5 on the chip. Never the Wi-Fi settings and pairing secret (NVS, `0x9000`), never
  the flash data partition, never a merged `firmware.factory.bin` (it runs through NVS). Key artwork
  lives on the microSD card, which flashing never touches. An update that would change the partition
  table stops and asks first, because a moved NVS partition loses the Wi-Fi settings and pairing.
- **Engine:** esptool-js, bundled into the main process, over `device/web-serial.ts`, which presents
  `serialport` as a Web Serial port. That adapter always sends DTR and RTS together (`serialport`
  asserts any line left out) and changes baud in place instead of reopening the port. The chip is
  restarted with esptool's RTS pulse rather than esptool-js's `after("hard_reset")`, which in 0.6.1
  does not reset the chip.

**Where the firmware comes from.** Building the firmware with PlatformIO (`pio run -d ../firmware`)
copies the images and `manifest.json` into `resources/firmware/`, which is gitignored and packed
into the installer. The manifest lists each image's address, size, SHA-256 and MD5, the firmware
version and the protocol number; packages that would touch NVS or the data partition are rejected
before anything is written. GitHub releases tagged `firmware-v<x.y.z>` carry the same files;
`.github/workflows/firmware-release.yml` builds and publishes them, and `desktop-release.yml` builds
the installer for `desktop-v*` tags with the firmware inside. The app checks the repository named in
package.json's `repository` field (`github:Fenish/decky`); the release workflow overwrites it with
the repository it runs in, so a fork's installer checks the fork. Without the field, checking GitHub
is unavailable.

**Versions.** The firmware version comes from the `firmware-v*` tag, or `git describe` for local
builds, or `dev`. The protocol number lives only in `../firmware/include/decky_version.h`. An update
is offered for a newer protocol, or for a newer release number at the same protocol; development
builds are never offered an older release.

For flashing without the app, `../firmware/tools/flash.ps1` builds and writes the application (add
`-Full` for all four images). Use 460800 baud and `PYTHONIOENCODING=utf-8`; a flash succeeded only
if it ends with **Hash of data verified**.

## Design references and assets

Interaction references:
[Elgato system actions](https://help.elgato.com/hc/en-us/articles/360028234471-Elgato-Stream-Deck-System-Actions-Hotkey-Open-Website-Multimedia),
[Multi Actions](https://help.elgato.com/hc/en-us/articles/360027960912-Elgato-Stream-Deck-Multi-Actions),
and
[folders](https://www.elgato.com/us/en/explorer/products/stream-deck/how-to-use-folders-stream-deck/).
Model loading uses [Three.js OBJLoader](https://threejs.org/docs/pages/OBJLoader.html). The layout
and visuals are Decky's own.

The title-bar logo is `Branding/png/logo.svg`, rendered white, and the disconnected screen's model
is `3D Models/StreamDeck_CAD.obj`. The app uses copies of both; the originals are not modified. The
app, taskbar, installer and tray icon come from `Branding/png/logo-app.png`:
`node scripts/build-icons.mjs` trims its transparent margin and writes `resources/icon.png` and the
multi-size `resources/icon.ico` (16–256 px).

## Connection flow

Disconnected: only the small model and gentle Connect Decky heading, with custom window chrome. No
retry button; detection repeats every four seconds without overlapping requests. On connection the
camera rotates the deck face-on, moves through the center key, and reveals the dashboard.
Reduced-motion preference bypasses the camera animation. A disconnect during the animation cancels
the reveal; unsaved edits survive disconnect/reconnect.

The image-generation prompts and final asset filenames are in
`src/renderer/src/assets/generated-backgrounds.md`. The application icon generator uses the original
vector, with no dark background. `pnpm test:connection` covers automatic retry, transition stages,
cancellation, draft preservation and responsive layouts.
