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
  Configure the action and choose **Save**. Widgets sit one step in: the **Widgets** row under the
  actions opens them, and **Back** returns. Until a new key is first saved, the ‹ in the editor's
  header takes the choice back to the panel it was made in. Searching finds actions and widgets
  alike.
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
  rejected rather than sent without the modifier. Keys go through one PowerShell helper that stays
  running (38 ms a press). It starts with Decky, or when a hotkey is first added, so the first press
  does not wait half a second for it; stopping a running action leaves it up.
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
  resets on quit. It does not read another application's state, except for an app's control
  (Discord's mute, camera...): that toggle's ON and OFF follow the app, and the editor and the key's
  corner name them as the control's states (Unmuted and Muted, Not in a call and In a call; the
  control's `states`). While Decky cannot reach the app (closed, not installed, not authorized),
  such a key shows OFF and looks disabled, on the deck and in the window: its icon grey and struck
  through, its label grey, an image greyed - as the app's widgets do then.
- **Widgets:** the Widgets group under the actions adds a key that draws itself and keeps itself
  current on the deck. A tap acts when the finger lifts; a hold acts the moment the press reaches
  600 ms, with the finger still down. A widget that tells double and triple taps apart (Now playing)
  waits 300 ms after each tap for another, then acts on how many came, at once on the third. So a
  single tap on it acts 300 ms after the finger lifts; other keys never wait. A hold or a swipe
  drops the taps just before it. Widgets are always Normal buttons, and only their background and
  accent colors are set in Appearance. Where a widget has styles, each is drawn live in the editor
  with made-up readings, to be picked by eye, and picked on the deck as well - see **Designs on the
  key** below. What a person did (timer, pomodoro, counter, a countdown's picked time, the last dice
  roll and where the die lay) is saved in `%APPDATA%/Decky/widgets.json` and moves with its key, so
  a running timer keeps counting while Decky is closed. Readings (ping, volume, what is playing,
  CPU, prices) are read again and never saved. Widgets on every page are kept current, not only on
  the page shown: while the deck loads, each gets its picture as it is now, and the keys it turns
  get every look they can take - a dial's muted look too, a countdown's drum while it runs - counted
  in its progress bar. So no page opens on placeholders, and no press afterwards waits for a look:
  switching to a look the deck keeps takes 20 ms, where sending a volume's arc takes 0.9 s. The page
  shown sends its looks last, so they are the newest the deck keeps. After that a page not shown
  gets a widget's new picture when its state changes, at most every 5 seconds, and a clock's every
  30 seconds.
- **Designs on the key:** a hold on a widget whose look can change offers its designs there and
  then, the way Discord's microphone offers its devices: the key draws the design itself, a little
  smaller, over a dot for each there is, and every tap moves to the next and round again. Three
  seconds after the last touch the design showing is saved to the key, and it is a key again. So a
  clock goes from digital to analog, a die becomes a coin, yes-or-no or a list (a list only where
  there is something to choose from), and a volume or microphone goes from arc to bar, all without
  the app. A widget whose hold already does something keeps it - Now playing goes back a track, a
  timer resets, a pomodoro skips - and its styles are picked in the editor as before. While a design
  is being picked, the deck stops turning that key itself, so the picture with the dots shows; the
  key goes back to its wheel or its die once the design is kept. Each kind names its own designs
  (`designs` in `src/shared/widgets/`), so a new one needs nothing here.
- **Clock widget:** digital, analog or minimal; 24- or 12-hour, with two-digit hours in both;
  seconds; the date on the digital face; any time zone, so a second clock makes a world clock.
- **Timer widget:** a stopwatch, or a countdown of up to 23:59:59. Tap starts or pauses; hold
  resets. A stopwatch's ring goes round once a minute and a countdown's fills as its time goes, each
  stepping with its digits once a second. Paused, the arc is held at half strength; an ended
  countdown's is whole, in red. With **Set time on the deck**, a countdown at rest is a picker wheel
  that the deck draws and turns by itself. The times sit on a drum, with the one it will run in the
  band, shorter above and longer below, fading as the drum turns away. The numbers follow the finger
  1:1. A flick coasts, slows down and springs onto a time, and past either end the wheel gives a
  little and bounces back. It runs at the panel's ~60 fps over USB and Wi-Fi alike, since nothing
  crosses the link while it turns; the deck only reports the time it came to rest on. The times: 10
  seconds a step up to a minute, then minutes up to an hour, then 5 minutes up to 3 hours, plus the
  time set in the app. A finger that moved 10 px is swiping, so it neither taps nor holds. Swipes
  are ignored while the countdown runs; on a paused one they pick a new time and clear its progress.
  The time picked is widget state, kept until a new time is set in the app. On firmware without
  `wheel=1` the app turns the wheel instead, one step per 15 px of swipe, drawing each step itself.
  With **Sound when it ends** (on by default), a countdown that runs out plays a soft kalimba on the
  PC, every 2 seconds, until its key is tapped. The tap stops the sound and sets the countdown back
  to its time, ready for the next tap to start it. It rings on any page, and with Decky in the tray.
  A countdown that ran out more than a minute before Decky started stays quiet. The sound is
  `src/renderer/src/assets/sounds/kalimba.wav`, one 2-second cycle; the window may play it without a
  click (`autoplayPolicy`), since it rings hidden.
- **Pomodoro widget:** focus and break lengths in minutes. Tap starts or pauses; hold skips to the
  next focus or break. Its ring fills through each focus and break, stepping once a second.
- **Countdown widget:** days until a date, with an optional title.
- **Counter widget:** a start value and a step. Tap counts; hold goes back to the start.
- **Ping widget:** how long a host (google.com by default, or a LAN address) takes to answer, every
  5 seconds to a minute: green under 100 ms, amber under 250 ms, red slower or with no reply. Tap
  pings at once. It times a TCP connection to port 443, since many VPNs and routers drop the ICMP
  packets ping.exe sends; a refused connection counts as an answer. A second connection starts if
  the first has not answered in 500 ms, so the odd lost handshake doesn't read as no reply. Only a
  host that answers no TCP at all is asked with ping.exe.
- **Now playing widget:** the track in whatever app Windows' media controls know (Spotify, a
  browser, a game). **Cover** fills the key with the album art, under the title, artist and a
  progress line; **Card** shows the art small above them. A pause badge shows when it is paused. Tap
  plays or pauses, the progress stopping or moving on from where it is; a double tap skips to the
  next track, and a triple tap or a hold goes back to the previous one. Read every second. A title
  or artist too long for the key slides along on the deck (`slide=1` firmware): it rests at its
  start for 1.5 s, then slides left at 30 px/s, its start following after a gap, and rests again.
  Its edges fade. The progress line moves on under it without starting it over; a new track does.
  The app's own preview, and older firmware, cut it short with an ellipsis.
- **Volume widget:** the PC's volume and its mute, as an **Arc** with the number inside, or a
  **Bar** nearly the key's height with no number. Swipe up or down on the key: with `dial=1`
  firmware the deck turns it itself, so the fill and number follow the finger at the panel's frame
  rate (1% per 1.2 px) while Windows follows every 40 ms. Older firmware steps it 2% per 15 px from
  the app. Tap mutes or unmutes, shown at once; turning it up from 0 unmutes. A change made
  elsewhere (the keyboard, Windows' own slider) shows the moment Windows says so.
- **Microphone widget:** the default microphone's level and its mute, drawn and turned exactly as
  the volume is, with the mic in place of the speaker. Turning it never unmutes it, so a stray swipe
  cannot open the mic. Grey while muted, or with no microphone.
- **System widget:** CPU, memory or both, as **Graph** (the last minute) or **Rings**, every 1, 2 or
  5 seconds. Tap opens Task Manager.
- **Crypto widget:** Bitcoin, Ethereum, Solana, BNB, XRP, Dogecoin, Cardano, Avalanche or Toncoin,
  in US dollars, live: Binance's public market data (no account or key) streams a price a second
  while it trades, over one WebSocket for all the coins shown (`src/main/widgets/crypto-feed.ts`). A
  coin the stream is quiet about for 20 seconds is asked for over REST, and from CoinGecko if
  Binance is out of reach. **Chart**: the coin, the day's change and the last 24 hours (hourly,
  refreshed each hour, its last point the live price), green or red. **Ticker**: the price large,
  with ▲ or ▼ for the move over the last minute beside the day's change, each coloured by its own
  direction. Tap checks now. Profiles saved with a currency or interval load with them dropped.
- **Dice widget:** a die, a coin, yes or no, or a list of up to 8 choices of up to 14 characters
  each. **Dice** (the die): with `dial=1` firmware the deck draws a real 3D cube and throws it. A
  tap sends it tumbling through the air, hopping, bouncing off the key's edges and rolling the way
  it goes, until it slows and lies flat wherever it stopped, turned however it landed (about 1.2 s,
  at the panel's frame rate). The deck reports how it lies (face, place, turn) and the app shows the
  same. It is fair: where the tumble ends is picked evenly among all turns (a random unit
  quaternion) and reached exactly; from there the cube's symmetry keeps every face as likely -
  120,000 simulated throws came up 16.50-16.79% each, 40 on the deck [6, 4, 10, 7, 6, 7]. A tap
  while it rolls throws it again. **Coin**, **Yes / No** and **List** spin a drum of words at least
  two turns to a side the app picks at random; a tap while it spins rolls on from there, and a flick
  rolls it too. Without the firmware for either, the result just appears.
- **Note widget:** up to 120 characters in three sizes.
- **Apps:** the Apps row, beside Widgets, lists the apps Decky talks to by name; each opens its own
  page, with Back to Apps. The page opens with the app's connection in one line - how Decky stands
  with it (not installed, closed, its API off, its password refused, or connected) - then a rule,
  then the app's keys. The line's button fits the standing: **Open OBS** starts the app while it is
  closed, and the line says it is starting until the app answers; **Get OBS** opens its download
  page while it is missing; otherwise **Connect…** or **Edit** opens the app's settings. Beside Open
  or Get, a small settings button opens them too. The settings dialog has the app's fields, what to
  do about the standing, and Save and connect, which closes it once connected. The same line is in
  the editor of each of its keys, and their widget list offers only that app's widgets. Passwords
  stay on this PC, encrypted by Windows, outside the profile, and are never shown again.
- **OBS Studio:** **Recording** and **Streaming** keys show what OBS has, so they are right however
  it was started. Idle, a key is its glyph - a record button, a broadcast mast - and REC or LIVE.
  Running, it is a tally light: washed and framed in on-air red, a REC or LIVE badge that brightens
  and dims each second, and the time it has run large. Paused or reconnecting, it turns amber. The
  countdown shows the seconds left in a glowing ring that drains smoothly - the deck moves it
  (`SWEEP`) - with "tap to cancel" under it. Out of reach, the key is its idle look greyed, with a
  slash through the glyph and no words; OBS's card in the app says why. Decky talks to OBS's own
  WebSocket server (OBS 28 and later; Tools → WebSocket Server Settings), from Decky's start while
  any OBS key exists, trying again every 3 seconds while OBS is closed. A touch counts down 5
  seconds on the key before OBS is asked to start, or to stop what runs; a second touch within them
  calls it off. OBS counts as installed with an installer or Steam entry, a Start Menu shortcut, or
  a running copy. Open OBS starts the copy found the same way - from its own folder, or through
  Steam - and tries OBS every 1.5 seconds for up to 30 while it starts its WebSocket server.
- **Discord:** its card asks Discord's permission once (**Authorize**, then Authorize in Discord);
  see [Discord](#discord). Its keys:
    - **Mute**, **Deafen**, **Camera**, **Screen share**, **Noise suppression**, **Echo
      cancellation** and **Auto gain** are toggle keys whose ON and OFF follow Discord, however it
      was switched: from the deck, Discord itself or its shortcuts. Picked, a key starts as a
      toggle - OFF as Discord is at rest (Mic), ON in the colour of what it means (Muted, in red) -
      for any look of your own. A tap switches it in Discord. Deafened, Mute shows muted too, as
      Discord mutes you then; a tap on it undeafens, as Discord's own mic button does. Camera and
      screen share work in a call; starting a share opens Discord's picker and brings Discord to the
      front as it was left.
    - **Leave call** is a toggle too: ON, in red, while you are in a call; a tap leaves it.
      Discord's RPC sets only its Standard noise suppression (`noise_suppression`); Krisp is out of
      its reach.
    - **Voice channel** shows a channel by its ID; **Use current** beside the field takes the one
      you are in. **Current call** shows the call you are in, whichever it is. Both show who is in
      it as their avatars, with initials until an avatar has come, and a green ring on whoever
      speaks (in your own call: Discord says who speaks nowhere else). They turn green while you are
      in it. Appearance sets how people sit - **Grid** (one large, two side by side, three as two
      over one, four in a square), **Row** or **Stack** (overlapping, whoever speaks in front) -
      past four, three and "+n"; **Channel name** under them or not; and the icon shown with no one
      there, from the library, in the key's colour and at the size picked. With Discord out of
      reach, that icon struck through. A tap on a channel's key joins it, and leaves it while you
      are in it; on the call's, leaves the call.
    - **Mic switcher** and **Output switcher** show the device Discord uses - the part of its name
      that tells it apart large (HyperX Cloud II), what it is small (Microphone) - under the key's
      icon, and a dot for each device it could use. A tap moves Discord to the next. Both are choice
      keys, which any widget can be: its state's `choice` (`src/shared/widgets/choice.ts`: the
      option chosen and where it is among them, `nextChoice` for a tap) drawn by
      `features/widgets/choice-face.ts`.
    - **Notifications** shows how many notifications Discord gave since the last tap, with Discord's
      red badge on the last sender's avatar; with none, the key's icon. A tap opens that
      conversation in Discord and counts from nothing again. The count survives a restart of Decky
      or Discord. It holds only what Discord sends while Decky is linked to it: Discord lets no app
      read unread messages or older mentions, and sends nothing while its own window is in front or
      a game shows it in Discord's overlay.

The volume, microphone and now playing widgets reach Windows through one PowerShell helper
(`src/main/system/windows-host.ps1`), started when the first such widget appears and stopped when
the last goes. It answers a line of JSON for each request: each device's level and mute through Core
Audio (`level` and `mute`, with the device's flow: 0 the speaker, 1 the microphone), the track
through Windows' media controls (the cover read once per track). A reading takes 20-60 ms. Asked to
(`watch-audio`), it also registers Core Audio's volume callbacks on the default speaker and
microphone - again when the default device changes - and writes a line of its own the moment either
changes: the app never polls for the sound, besides a check every 15 seconds. Levels the app sets
are not echoed back for 400 ms, so a dial being turned never jumps back.

- **Pages:** create a named page and assign an Open page action to any key, including key 2. Every
  nested page reserves key 11 (bottom left) for Back. Back returns to the page it was opened from -
  on the deck or in the window, so a page opened from several goes back to where you were - and to
  the page it was created under when that is not known (since Decky started) or is gone.
  Double-click a folder in edit mode to open it. Page IDs remain stable after renames. Pictures
  drawn for the profile as it was, still waiting to go when it is saved again, are answered `stale`
  and drawn again, with nothing said.
- **Images:** PNG, JPEG and WebP up to 12 MB. Sources are resized to at most 640 pixels before
  storage. Adjustments are nondestructive.
- Selecting a key edits it. **Test** saves the visible settings and executes that key. Importing
  profiles never executes their actions.

## Structure

```text
src/
  shared/                 Configuration and its validation, typed IPC contracts, LIVE patch and deck
                          wheel formats
    integrations/         The apps Decky talks to: each one's name, settings fields, what is said of
                          how Decky stands with it and its button then, and registry.ts, which names
                          them all
    widgets.ts            The Widget union, widget state and the time helpers every widget shares
    widgets/              One kind per widget type - its settings, defaults, validation, when its
                          picture changes, what a press does - and registry.ts, which names them all
  main/
    index.ts              Builds the parts below and wires them together
    app/                  The window, the tray, and quitting
    deck/                 The session with the deck (finding it, one exchange at a time, the
                          heartbeat), Wi-Fi setup, and what the deck reports unprompted
    pages/                What the deck holds, and sending it pages: CACHE, PAGE, ALT, STATE
    widgets/              Widget state; readings (sound, media, CPU, prices, pings); live pictures
                          and sliding text; the wheels the deck turns; taps, holds and swipes
      actions/            What a widget does beyond its own state, one class per type, and a
                          registry of them
    profile/              The profile in memory: saving it, opening pages, running keys
    updates/              New releases, firmware installs, and Decky updating itself
    discord/              Decky on Discord: the local pipe (discord-ipc.ts) and Rich Presence, from
                          what the other parts know (presence.ts)
    ipc/                  Every channel the window calls; only Decky's own window is answered
    logging/              deck.log and discord.log (log-file.ts)
    actions/              Action runner, hotkey helper, toggle state, and toggles that follow an app
                          (app-controls.ts)
    config/               Atomic saves, recovery copies, legacy migration
    device/               Serial and Wi-Fi links, the deck's line format, encrypted framing,
                          firmware flashing
    programs/             Installed programs and their icons, for the program picker
    integrations/         The service each app has (integration.ts), settings kept encrypted by the
                          fields it declares, and a folder per app: obs/ (its link, its finder -
                          which also starts it - and its service), discord/ (its finder and service)
    system/               The PowerShell helper that reads and sets Windows' sound and media, and
                          tells of sound changes
  preload/                Narrow contextBridge API
  renderer/
    public/models/        Deck CAD model (GLB) shown on the disconnected screen
    src/
      app/                Connection/session state, workspace orchestration and preview adapter
      components/         Shared icons
      features/
        editor/           Key/action and macro editors (actions.ts: every kind of action), optional
                          starter layout
        artwork/          Import, adjustments, OFF/ON preview, RGB565 rendering
        connection/       Smooth obsidian disconnected screen, actual CAD model and camera transition
        dashboard/        Floating grid, sliding editor slot, pages/settings panels
        firmware/         Install progress, first install on the Disconnected page
        integrations/     An app's connection line and dialog, at the top of its page in the picker
                          and in its keys' editor, drawn from what the app declares
        widgets/          Widget previews, settings, and live updates to the deck
          kinds/          One view per widget type - drawing, settings, sample readings, deck look
                          (the volume and the microphone share level/) - and registry.ts, which
                          names them all
      assets/             White SVG logo and generated artwork
      styles/             True-dark theme and responsive layout
resources/                Application and tray icons
scripts/                  Bounded UI, visual and hardware checks; package-check.mjs checks the
                          built package; convert-model.mjs makes the GLB from the CAD model
tests/                    Configuration, persistence, wire timing, actions, toggles, widgets and
                          their readings, LIVE patches, wheel looks, a simulated deck
```

A new widget type needs its kind in `src/shared/widgets/<type>.ts`, its view in
`src/renderer/src/features/widgets/kinds/<type>/`, an action in `src/main/widgets/actions/` if it
does something beyond its own state, its type in the `Widget` union, and a line in each registry. A
type missing from a registry does not compile. A type that behaves like one already there takes that
one's code, made generic, instead of a copy: another sound level is a `levelKind` in
`src/shared/widgets/level.ts`, a row in `level/level-view.ts`'s `DEVICES`, and a `SoundAction` for
its device. Key action kinds work the same way: `STEP_CHECKS`/`ACTION_CHECKS` in
`src/shared/config.ts`, the runner's `steps` in `src/main/actions/runner.ts`, and `ACTION_KINDS` in
the editor's `actions.ts`.

A new app needs its id in `IntegrationId`, what it declares in `src/shared/integrations/<id>.ts`
(name, settings fields, what is said of each standing, the button for each, its download page, and
the controls keys can switch), a service in `src/main/integrations/<id>/` that implements
`IntegrationService` (`open` starts the app; `authorize`, `press`, `controlState` and `call` for an
app that has them), a row in `INTEGRATIONS` and in `IntegrationServices`, and its widgets, each a
widget type whose kind names the app as its `group`. Its picker page - its controls, then its
widgets - and its connection line and dialog follow from these.

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
by `src/security/secure_link.cpp`.

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

The handshake is
`OK id decky 7 ... cache=8 storage=1 fw=<version> live=1 drag=1 wheel=1 dial=1 warm=1 block=4096 slide=1 sweep=1`;
`storage=1` means a card is mounted, `live=1` that the deck accepts `LIVE` patches for widgets,
`drag=1` that it reports finger movement on keys named with `DRAG`, `wheel=1` that it draws and
turns picker wheels itself, `dial=1` that it also turns dials (the volume, the microphone), rolls
drums (`WHEELROLL`) and throws dice, `warm=1` that while loading it takes every page's widget
pictures and looks sent ahead and counts them in its progress, `block=` the largest block it takes
uploads in over USB when asked with `BLOCK`, `slide=1` that it slides text too long for its key
along by itself (`SLIDE`), and `sweep=1` that it moves rings' arcs by itself (`SWEEP`). `reset=`
says why the deck last started: `poweron`, `sw`, `panic`, `taskwdt`, `brownout` and so on. Over USB
the desktop also accepts firmware v2–v6 and the `streamdeck 1` touch-test handshake. GPIO, RGB
display timing and GT911 touch settings live in `../firmware/lib/panel/`.

When something goes wrong with the deck, `%APPDATA%/Decky/deck.log` says what. It records a deck
that restarted after a crash, a watchdog or a brownout (from `reset=`), a deck that started again
while connected, an upload the deck did not answer, and any line the deck printed that was not a
reply. The file starts over after a few hundred KB. When Windows reports the deck's USB adapter as
not working (error code 31), the adapter has stopped answering and only a replug brings it back. The
Disconnected screen says so and names the port.

Toggle OFF frames form the base page; each ON frame is uploaded separately at connection or when
artwork changes. Successful actions send only a `STATE` bitmask from the main process. Alternating
different toggles never creates another page image or triggers renderer image synchronization.
Firmware redraws only changed cells. Alternate images share the existing PSRAM budget and memory
floor.

Widget keys go into page uploads as their base picture, which only their settings decide: a clock's
face without its hands, say. The time never changes a page's checksum, so cached pages stay valid.
While a page is shown, the renderer redraws each widget exactly when its picture next changes: on
the second or the minute for clocks, every second for a running timer, and otherwise when its state
changes. The main process sends only what differs from the picture the deck holds. A changing
seconds digit is under 1 KB and takes 20-95 ms over USB. Without `live=1` the deck shows the base
pictures. A key's pictures never queue up: a send waiting its turn always takes the key's newest
picture. A wheel step is 0.8-3 KB (one digit changing, or all of them from 9:00 to 10:00), about
40-130 ms over USB, so a fast swipe skips the steps in between rather than falling behind.

Patches go into a key's live picture, which the deck keeps apart from the page's own pictures. The
page's own pictures therefore always match its signature, and the card's copy loads. A new version
of a page (after an edit) starts from the deck's copy with its live pictures and the text sliding
over them. So only keys whose own picture changed are sent, each as a patch against what the deck
holds. The app remembers the live pictures in each copy the deck holds (page and signature).

- **Keys that are no longer widgets:** a key carried into a new version, or kept in a copy the deck
  already holds, gets its live picture dropped (`LIVE` with no bytes). Without this, a digital clock
  that moved would leave its last time behind. (Its own picture is only its background, like an
  empty key's.)
- **The cost:** changing the volume's style on a page of 8 live widgets sends one patch of 2.7 KB.
  On the deck, a small edit takes under 0.1 s from `CACHE` to the `COMMIT` reply. The deck shows the
  page at once and writes it to its card afterwards, between frames. Sending every live widget again
  whole would take 10.4 s.
- **A page loaded whole** goes as patches over nothing: 22 KB instead of 311 KB for that page.
- **Out of memory:** when a live picture doesn't fit in memory, the deck refuses the patch
  (`ERR live memory`) rather than draw into the page's own pictures. Live pictures always leave room
  for a whole page.

`tests/widget-live-sync.test.ts` checks all this against a simulated deck.

- `ID`: identity and real key geometry.
- `HELLO <page-count> [<units>]`: show the white Decky logo and loading progress in the center key.
  `<units>` counts what is to come: each key, ON picture, and with `warm=1` each widget picture and
  look sent ahead, which loading sends after the pages and before showing one: no page opens on
  placeholders or waits for a look.
- `BLOCK <bytes>`: from here uploads over USB go in blocks of `<bytes>` (128-4096) and `READY` names
  it, until `HELLO` or the desktop goes. The app asks for 2048 after `HELLO`: blocks are each
  acknowledged, and at 128 bytes a transfer spent more time waiting for the answer than sending. A
  24 KB look went in 1.3 s at 128 bytes and 0.8 s at 2 KB; 4 KB was slower again (1.0 s). The deck
  holds 8 KB of what arrives, so a whole block waits while it draws. A released app never asks and
  keeps 128.
- `CACHE <index> <CRC32>`: stage a page without displaying it; progress advances after each
  cell/page. A new version is built from the deck's copy of the page: `copied=1 base=<CRC32>`, and
  with `live=1` firmware `live=<mask>` names the keys whose live pictures (and sliding text) it
  carried.
- `PATCH <cell> <bytes> <patch-CRC32>` (`live=1`): a key of the page being built, as a `LIVE`-format
  patch against what the key holds - the copy it was built from, or nothing known in a fresh one,
  when the patch covers the whole key. Most keys are mostly one colour, so a whole key is a few KB
  instead of 29. It drops the key's live picture: its own picture changed.
- `ALT <index> <page-CRC32> <cell> <bytes> <image-CRC32>`: upload an ON image with the same
  READY/128-byte ACK protocol. Already-cached artwork returns immediately.
- `STATE <index> <page-CRC32> <mask>`: select preloaded OFF/ON artwork independently for every key,
  without image transfer. An unchanged mask redraws nothing.
- `LIVE <index> <page-CRC32> <cell> <base-CRC32> <bytes> <patch-CRC32>`: patch one key of a page the
  deck holds, shown or not, with the same READY/block acknowledgements as `PUSH`. A patch for the
  page shown ends a wheel on the key and redraws it. The patch holds the changed box of every 32 ×
  32 tile, run-length encoded (`src/shared/live-patch.ts`). It goes into the key's live picture,
  begun as a copy of its own; the page's own pictures stay as sent. The deck first compares the
  picture the key shows with `<base-CRC32>` and answers `ERR live base` when they differ, and the
  desktop then sends the whole key with base 0. It answers `OK live` when the key is redrawn, and
  `ERR live memory` when a new live picture doesn't fit. `LIVE <index> <page-CRC32> <cell> 0 0 0`
  drops the key's live picture and its sliding text; the deck drops all of them on `HELLO` and when
  the desktop goes.
- `DRAG <mask>`: the keys (15 bits) whose finger movement the deck reports; 0 for none. The desktop
  sends it when a page lands, naming the keys a finger turns: adjustable countdowns, the volume, the
  microphone and drums of words - not a die, which any touch throws. The deck forgets it on `HELLO`
  and when the desktop goes offline.
- `EV <page> <cell> MOVE <y>`: the finger's height inside a `DRAG` key, from its top, in pixels. It
  comes right after `DOWN`, then each time the finger has moved 2 px, at most every 20 ms. It is
  only ever sent for keys the desktop named, because apps from before it hand a line they don't know
  to the command waiting for a reply.
- `WHEEL <index> <page-CRC32> <cell> <label> <bytes> <look-CRC32>`: a wheel's look for a key of the
  page shown, and the label to show, with the READY/block acknowledgements of `PUSH`. The look
  (`src/shared/wheel-spec.ts`) holds everything the deck needs to turn the wheel: the key picture
  under the numbers (as a `LIVE` patch), the characters at two sizes as the app draws them, the
  labels, the drum's shape and how it moves. That is about 15 KB, 1 s over USB. The deck keeps looks
  by CRC, one for every key and one more, and never drops a look a key is armed with: looks no key
  uses go first, least lately armed, and when PSRAM runs short; with no room even then it answers
  `ERR wheel memory` and the app draws the key. Should an older deck refuse a roll (`WHEELROLL`)
  because it dropped the key's look, the app rolls in its place and sends the look again. A dial's
  look (version 2, `dial=1`) is the key at its lowest and, as a patch over it, at its highest; per
  pixel, the share of the range from which it shows the highest (in runs); the range; finger pixels
  a step; and digits for the number, where it writes one (the arc; the bar writes none). The deck
  composes each frame from these, so the volume's arc or bar fills under the finger. The volume's
  arc is about 24 KB and its bar 7 KB. A die's look (version 3) is its edge in pixels, body and pip
  colours, how hard it is thrown and how it slows, and the key under it: about 0.4 KB; the deck
  draws the cube itself (`src/shared/die.ts` holds the same sums). Cell -1 only keeps a look, for a
  page not shown yet: `OK wheel cached=1` at once if the deck has it.
- `WHEELAT <index> <page-CRC32> <cell> <label> <look-CRC32>`: arm a key with a look the deck keeps,
  or move it to a label; `ERR wheel unknown` asks for `WHEEL`. Label -1 takes the wheel away. The
  app arms a wheel when its page lands and whenever its time changes. A wheel ends when a `LIVE`
  picture arrives for the key (the countdown started), or on another page, `HELLO` or disconnect.
- `EV <page> <cell> WHEEL <label>`: the wheel came to rest on a different label than the desktop
  last set. Only armed keys send it. A die's label is how it lies: face + 8 (x + 128 (y + 128 yaw)),
  face 0-5, x and y in 128ths of the key, yaw in degrees; `WHEELAT` puts a die down the same way.
- `EV <page> <cell> VALUE <value>`: a dial's value while a finger turns it, at most every 40 ms, and
  once more when the finger lifts. A new look for a dial or drum still moving (the volume unmuted by
  the turn) takes over without stopping it.
- `WHEELROLL <index> <page-CRC32> <cell> <label>`: spin an armed drum to a label and land on it,
  then `EV ... WHEEL`. The app aims a roll of words two turns on at least, at the side it picked. A
  die is thrown instead (the label is unused) and lands however it lands.
- `WHEELSPIN <cell> <tenths of labels a second>`: diagnostics; set a wheel coasting as a flick
  would.
- `SLIDE <index> <page-CRC32> <cell> <bytes> <text-CRC32>`: text too long for a key, for the deck to
  slide along, on any page it holds, with the READY/block acknowledgements of `PUSH`; 0 bytes and
  CRC 0 take it away. The text (`src/shared/slide-spec.ts`) is up to two lines, each drawn once as
  the app draws it and read back as coverage, with its window on the key and its colour, and how it
  moves: its rest, speed, gap and fading edges. A title is about 5 KB. The deck lays it over the
  key's picture each time it has moved a pixel, redrawing only the rows it covers, so `LIVE`
  pictures go on changing under it. It belongs to that copy of the page and goes with the key's live
  picture: a new version of the page carries both, and `HELLO`, disconnect and dropping the live
  picture drop it. The app sends it right after the key's picture (new text on the old picture would
  show both), takes it away just before a picture that has none, sends it only when it differs from
  what that copy has, and during loading for pages not shown.
- `SWEEP <index> <page-CRC32> <cell> <bytes> <arc-CRC32> <clock>`: a ring's arc for the deck to move
  (OBS's 5-second countdown), with the READY/block acknowledgements of `PUSH`; 0 bytes, CRC 0 and
  clock 0 take it away. The arc (`src/shared/sweep-spec.ts`, 32 bytes) is where the ring is, its
  stroke width, colour, opacity and glow, and how its end moves: held at a share of a turn, or
  `(t - zero) / turn` of the way round, stopping at none and at a whole turn or going round and
  round. `t`, `zero` and `clock` are the PC's clock in ms since 1970; `clock` is read as the line is
  sent, and the deck follows it from there, so the arc is sent once for as long as its motion holds.
  The key's picture keeps the ring's track; the deck strokes the arc from the top, clockwise, with
  round ends and its glow, and redraws it each time its end has moved a quarter of a pixel, only
  over the rows it covers. It goes with the key's live picture as `SLIDE`'s text does, and is sent
  and taken away in the same order. The deck refuses an arc that would reach within 2 px of the
  key's edges. Firmware without it has the arc drawn into the key's picture, stepping once a second.
- `PING`: desktop heartbeat every four seconds, including while hidden in the tray. A 12-second
  lapse shows Disconnected; `BYE` does so immediately on quit.
- `BOOT decky 7`: unsolicited reset event; triggers cache restoration again.
- `UPDATING <0-100>` / `UPDATING END`: Decky on the PC is updating itself. The center key shows the
  logo, "Updating Decky" and a progress bar; the deck keeps it up (instead of Disconnected, for up
  to three minutes) while Decky closes for its installer, until the new version says `HELLO`. `END`
  means the update stopped and the page returns.
- `SDINFO`: mounted-card status and capacity. Commit/alternate replies report `stored=1` after
  successful persistence.
- `DISPLAY_STATE`: scanout health for diagnosing a vertically slipped picture - the bounce position
  at the last frame end (`pos=76800` when right), EOF interrupts per frame since the last ask
  (`eofs=10..10` when right), slips corrected since boot, and the last page redraw in microseconds
  (`draw=`, about 35000). It also gives the last wheel picture composed in microseconds (`wheel=`,
  about 4300), the wheel pictures since boot (`frames=`), and a die's last picture in parts
  (`die=<put back>/<shadow>/<faces>/<pips>`, microseconds; about 5 ms in all), then the overlay
  frames (sliding text, rings' arcs) drawn since boot and the last one's time in microseconds
  (`overlays=<frames>/<us>`). `DISPLAY_RESYNC` restarts scanout by hand; nothing needs it.
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
icon picker shows a short default set and searches the full library: Lucide's icons, and about 60
brands' logos Lucide leaves out (Discord, OBS Studio, Twitch, Spotify, Steam, GitHub and so on;
`src/renderer/src/components/brand-icons.ts`, from Simple Icons, CC0). A logo is drawn solid in the
key's colour, a little smaller than an outline icon so it weighs the same. Appearance, editor header
and selected deck key share the same canvas renderer and update before saving. A label never moves
what the key shows: the label sits at the foot of the key, and the icon stays in the middle,
shrinking only as far as the label and Icon/text spacing under it need. A widget's caption works the
same way - it leaves as much room at the foot as it takes at the top, so the widget is a little
smaller and stays where it was. Labels use the accent color. **Icon size** (40-200%, 100% saved as
no setting: `iconSize`) scales a key's icon wherever it shows one - on any key without an image, and
on a widget that draws the key's icon, such as Discord's. Hover over an uploaded image to remove it.
The dock duplicates the selected key; drag a key onto an empty cell to move it or an occupied cell
to swap it.

## Discord

Settings → **Show on Discord** (off until turned on) shows Decky on the user's Discord profile as
**Watching Decky**: a line on what they are doing, their presses on the deck today, and for how
long. Never a page's or a key's name. The card is the first of these that holds:

| When                                       | The card                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| The deck's firmware or Decky installing    | Updating the deck, or Updating Decky                      |
| OBS streaming or recording (with OBS keys) | Live, Recording or Recording paused, timed from its start |
| A key open in the editor                   | Editing keys, timed from opening it                       |
| The deck not connected                     | Deck disconnected                                         |
| Otherwise                                  | At the deck, timed from connecting                        |

Each but the first and fourth also says "128 presses today" (none before the first press). It is
Decky's own Discord application, `1548005754705813654`, over Discord's local pipe
(`\\.\pipe\discord-ipc-0` to `9`): a handshake with that public id, then `SET_ACTIVITY`. No sign-in
and no secret; nothing leaves the PC but what Discord shows. The activity type is Watching (3):
Discord shows one Playing activity at a time, so a Playing card would be hidden by a game, or hide
it. A card goes at most every 4 seconds (Discord takes about five in 20 s), and only when it
changed. Discord closed, Decky tries it again every 15 seconds. The card goes when Decky quits or
the switch is turned off, and Settings shows it as friends see it. Its picture is the application's
art asset `decky`, uploaded in the Developer Portal (Rich Presence → Art Assets): the logo, white on
a near-black square. On or off and today's presses are kept in `%APPDATA%/Decky/presence.json`.

Discord's keys (Apps → Discord) need its local RPC, which Discord gives an unapproved application
only for its owner and 50 testers. So Decky asks as Discord StreamKit Overlay
(`207646673902501888`), Discord's own overlay application, whose permission any user can give:
Discord shows its name in the Authorize popup and under Authorized Apps. It is unofficial, and
Discord can end it. Authorize sends `AUTHORIZE` with the scopes `rpc`, `rpc.voice.write`,
`rpc.video.write`, `rpc.screenshare.write` and `rpc.notifications.read`; the code Discord gives goes
to StreamKit's server (`streamkit.discord.com/overlay/token`, through Electron's network, since
Node's own is reset by Discord on some PCs) for a token that lasts 7 days, with no refresh. The
token is kept in `%APPDATA%/Decky/integrations/discord.json`, encrypted by Windows. A token Discord
refuses, or one run out, makes the card ask again. One given without notifications (`AUTHENTICATE`
names the scopes it has) leaves only the Notifications key struck through, until Authorize again.

While any key uses Discord, Decky keeps a link to it, trying again every 3 seconds while it is
closed (every 15 while it is not installed). It follows:

- **Voice settings**, the moment they change (`VOICE_SETTINGS_UPDATE`): mute (`mute`), deafen
  (`deaf`), noise suppression (`noise_suppression`), echo cancellation (`echo_cancellation`),
  automatic gain (`automatic_gain_control`), and each device list (`input` and `output`:
  `available_devices`, `device_id`). A tap sets one (`SET_VOICE_SETTINGS`; a switcher's, the next
  device's `device_id`), shown at once, with Discord's own word after. `mute` stays as you left it
  while deafened, so Mute shows `mute` or `deaf`. Just started, Discord reports its settings before
  its media engine has listed the devices: the list then holds only a stand-in under the default
  device's id ("No Input Devices"), and a switcher stays out of reach until the real list comes.
  `%APPDATA%/Decky/discord.log` records how the link came and went, and the devices each time they
  changed.
- **Camera and screen share**, which Discord's RPC does not report: Windows' record of what Discord
  uses (the Windows helper's `capture`: a camera or screen-capture use by a Discord program with a
  start and no stop yet), read every second while a key has either. A tap sends `TOGGLE_VIDEO` or
  `TOGGLE_SCREENSHARE`. Starting a share, Decky then starts Discord through its `Update.exe`, as its
  shortcuts do: a running Discord comes to the front as it was left (a `discord://` link would go to
  Home).
- **Voice channels keys show**, and the call you are in while a Current call key shows it:
  `GET_CHANNEL` for who is in each, and `SUBSCRIBE` to its voice state events. Those events do not
  name their channel, so any of them reads the channels again (300 ms after a burst), and every 15
  seconds besides. Avatars come from Discord's CDN, each once, as data URLs in the key's state, and
  go once no key shows them. `VOICE_CHANNEL_SELECT` says which channel you are in; Decky then
  follows `SPEAKING_START` and `SPEAKING_STOP` there, and no longer in the one you left. A tap sends
  `SELECT_VOICE_CHANNEL` (`null` to leave).
- **Notifications** (`NOTIFICATION_CREATE`, with the notifications scope): each counts on the key;
  the last one's sender (`message.author`) and avatar (`icon_url`) show. The count, sender and
  channel are kept in `discord.json` beside the token. A tap opens
  `discord://-/channels/<server>/<channel>` - the server from `GET_CHANNEL`, `@me` for a direct
  message - or, with none, brings Discord up as above. Discord sends the event only for a new
  message that would notify, and no RPC command reads read state or mention counts (`GET_CHANNEL`
  gives a channel's last messages, nothing on what was read).

A toggle key whose action is an app's control (`{ kind: "app", app, control }`, the app's
`controls`) never flips on a press: `AppControls` sets every such key to its app's state whenever
the app says it changed, and sends the page shown its `STATE`. The window follows how Decky stands
with each app keys control (`useAppsDown`: asked once, then `integration:status` events). An app out
of reach reports no state for its controls, so their keys show OFF, and the window draws their OFF
pictures disabled (`renderKey`'s `disabled`, with the widgets' `strike`). Only the OFF pictures: the
deck takes ON pictures (`ALT`) whole, 29 KB each, and reloads one from its card only while its
checksum is unchanged, so ON pictures never change with the app's reach. The page shown is sent
again as a patch of about 2 KB for each such key, and other pages follow as they open.

## Updates

Decky checks GitHub for a newer release a few seconds after starting and then every 15 minutes, also
while it sits in the tray. When Decky or the deck's firmware can be updated, the title bar shows a
pill left of the connection dot, such as **2 updates available**; it opens Settings and scrolls to
the Updates section, which lists the app and firmware versions and an update button for each.
**Check GitHub for updates** checks at once.

- **Decky itself:** an installed Decky updates in place. **Update Decky** opens an update screen
  over the window: electron-updater downloads the newest release's installer with progress (it can
  be cancelled), checks its SHA-512 against the release's `latest.yml`, and runs it silently; the
  installer closes Decky and opens the new version. Keys, pages and pairing live in `%APPDATA%` and
  are kept. If the update fails, Decky keeps running and the screen offers the installer instead. A
  development build cannot replace itself and offers the download instead.
  `src/main/updates/app-update.ts` holds the flow; the release carries `latest.yml` and the
  installer's `.blockmap` for it. Updates are differential: every installer leaves a copy of itself
  in `%LOCALAPPDATA%\decky-updater`, and electron-updater fetches only the blocks that differ from
  it - about 3 MB of the 101 MB installer for an app-only change. When the copy or a blockmap is
  missing, it downloads the whole installer.
- **On the deck:** while Decky updates itself the deck shows "Updating Decky" with the download's
  progress, and keeps showing it through the restart, until the new version connects.
- **Firmware:** covered below; it updates from the same section.

## Firmware

Decky installs the deck's firmware itself, over USB.

- **Update:** Settings → Updates shows the installed version and offers a newer one when the app
  carries it or GitHub has it. Updating needs the USB cable; over Wi-Fi the section says so.
- **First install:** a CrowPanel still running other firmware never answers as Decky. A USB-serial
  device that stays silent when asked twice, a second apart, is offered on the Disconnected page:
  "Install Decky on it?". Nothing touches it until the user clicks; the click restarts it into the
  chip's ROM bootloader, and firmware is written only to an ESP32-S3 with 4 MB of flash. Anything
  else is left as it was. A newly plugged-in device is looked at within about a second, not at the
  next four-second poll.
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
before anything is written. Every GitHub release carries them zipped, as
`decky-firmware-<version>.zip`, next to the Windows installer; the app downloads the zip when a new
release appears, checks every image, and reads the firmware version from the manifest inside. The
app checks the repository named in package.json's `repository` field (`github:Fenish/decky`); the
release workflow overwrites it with the repository it runs in, so a fork's installer checks the
fork. Without the field, checking GitHub is unavailable.

**Releases.** `../../.github/workflows/release.yml` runs on every push to `main`. When firmware or
desktop sources changed since the last release (tools, scripts, tests and notes do not count), it
builds the firmware and the installer and publishes both as one release, `v<version>`. Unchanged
firmware is not rebuilt: the release carries the images already released under that version. The
build fails if `scripts/package-check.mjs` finds a built file missing from the package. Versions
count up by themselves: the patch number by default, `[minor]` or `[major]` in a commit's first line
for a bigger step, and `[skip release]` holds a push back until the next release. Raising `version`
in package.json sets the next number. The rules live in `../../.github/scripts/plan_release.py`; run
it from the repository root for a dry run. Release notes come from the commit messages.

**Versions.** The app is stamped with the release version. The firmware keeps its own version, which
only rises when firmware code changed; each rise is marked by a `firmware-v<x.y.z>` tag, which local
builds read through `git describe` (else `dev`). The protocol number lives only in
`../firmware/include/decky_version.h`. An update is offered for a newer protocol, or a newer
firmware version at the same protocol, so a desktop-only release never asks anyone to reflash;
development builds are never offered an older release.

For flashing without the app, `../firmware/tools/flash.ps1` builds and writes the application (add
`-Full` for all four images). Use 460800 baud and `PYTHONIOENCODING=utf-8`; a flash succeeded only
if it ends with **Hash of data verified**.

## Design references and assets

Interaction references:
[Elgato system actions](https://help.elgato.com/hc/en-us/articles/360028234471-Elgato-Stream-Deck-System-Actions-Hotkey-Open-Website-Multimedia),
[Multi Actions](https://help.elgato.com/hc/en-us/articles/360027960912-Elgato-Stream-Deck-Multi-Actions),
and
[folders](https://www.elgato.com/us/en/explorer/products/stream-deck/how-to-use-folders-stream-deck/).
Model loading uses [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html). The layout
and visuals are Decky's own.

The title-bar logo is `Branding/logo.svg`, rendered white, and the disconnected screen's model is
`3D Models/StreamDeck_CAD.obj`; the originals are not modified. The app uses a copy of the logo and
a GLB of the model: `node scripts/convert-model.mjs` rewrites `public/models/decky.glb` from the OBJ
with the same vertices. (electron-builder leaves `*.obj` files out of the package, and the GLB loads
without parsing 6 MB of text.) The app, taskbar, installer and tray icon come from
`Branding/logo-app.png`: `node scripts/build-icons.mjs` trims its transparent margin and writes
`resources/icon.png` and the multi-size `resources/icon.ico` (16–256 px).

## Connection flow

Disconnected: only the small model and gentle Connect Decky heading, with custom window chrome. No
retry button; detection repeats every four seconds without overlapping requests. Connected, the deck
loads first - its pages, then every page's widgets and looks - while the screen says "Decky is
starting" and nothing can be edited; the same when the deck restarts under a running app. Then the
camera rotates the deck face-on, moves through the center key, and reveals the dashboard.
Reduced-motion preference bypasses the camera animation. A disconnect during the animation cancels
the reveal; unsaved edits survive disconnect/reconnect.

The image-generation prompts and final asset filenames are in
`src/renderer/src/assets/generated-backgrounds.md`. The application icon generator uses the original
vector, with no dark background. `pnpm test:connection` covers automatic retry, loading before the
reveal, transition stages, cancellation, draft preservation and responsive layouts.
