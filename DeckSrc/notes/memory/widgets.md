---
name: widgets
description:
  Widget keys are drawn by the desktop and patched onto the deck with LIVE; base
  pictures stay time-free; patched keys are tracked per deck copy; every page is
  warmed while the deck loads; sound and prices arrive as events, not polls
metadata:
  type: project
---

Widget keys (clock, timer, pomodoro, countdown, counter, ping, note, now
playing, volume, microphone, system, crypto, dice) are drawn by the desktop; the
deck receives pictures, and looks for the keys it turns itself.

- **Base pictures are time-free.** Page uploads carry what a widget's settings
  alone decide, so a page's signature never changes with the time. A digital
  clock's base picture is only its background, pixel-identical to an empty key.
- **The signature must stay the CRC of the pixels.** The SD store refuses any
  page whose pixels don't match it (`artwork_store.cpp`). Widget positions
  cannot go into the signature.
- **Live updates:** `LIVE <page> <sig> <cell> <baseCRC> <bytes> <crc>`, a
  tile/RLE patch, to any page the deck holds. The deck refuses it on a base
  mismatch, and the app then sends the whole key with base 0. It is gated by
  `live=1` in `ID`; hidden pages by `warm=1`.
- **Live pictures are kept apart from the page's own**
  ([[2026-09-11-live-layer]]). A page copy's own pictures stay exactly as sent,
  so they always match the signature and the card's copy loads. `LIVE` writes a
  per-key live picture.
  - **New versions:** a version built from a copy carries its live pictures and
    sliding text (`live=<mask>` in the `CACHE` reply). Only keys whose own
    picture changed go, as `PATCH`.
  - **Tracking:** `livePatched` in `main/widgets/live-keys.ts` (page id, then
    signature) mirrors what each copy shows.
  - **Widgets moved or removed:** such keys get their live picture dropped
    (`LIVE … 0 0 0`), or a moved clock leaves its time behind
    ([[2026-09-11-widgets-live-patches]]).
  - **Why:** re-sending every live widget whole took 10.4 s on the Debug page.
  - **The card save never holds an edit:** the deck shows a committed page
    first, then its main loop writes it to the card in 8 KB slices, so `COMMIT`
    answers in about 6 ms. Anything else on the card, or reusing a page slot,
    finishes the save first. Keep long card writes out of command handlers: the
    deck reads no touches and runs no animations meanwhile.
- **Every page is warmed while the deck loads** (`warm=1`). With the page cache
  the renderer sends each widget's picture as it is now and every look each
  deck-turned key can take ([[boot-loads-everything]]): a dial's muted look too,
  and a running countdown's drum, the page shown last. The app sends them after
  the pages and before showing one, counted in `HELLO`'s units. Afterwards a
  page not shown gets a widget's new picture when its state changes, at most
  every 5 s. The user asked for this: pages they switched to showed placeholders
  until visited.
- **The app waits for the deck.** While it loads - on connecting, or when the
  deck restarts - the app stays on its connection screen ("Decky is starting")
  and nothing is editable; the reveal plays after.
- **Presses:** a widget taps on release, and holds at 600 ms while still down
  (`HOLD_MS`). A finger that moved 10 px is a swipe: no tap, no hold.
- **Deck wheels (adjustable countdowns)** need finger movement:
  `EV <page> <cell> MOVE <y>`. The deck sends it only for keys named with
  `DRAG <mask>` (`drag=1` in `ID`). **Never let the firmware send unsolicited
  new line types:** released apps hand any line they can't parse to the command
  waiting for a reply (`serial.ts`), which breaks transfers. The app sends the
  mask when a page lands, and the deck clears it on `HELLO` and on disconnect.
- **Live frames are coalesced per key** (`liveQueue`): a waiting send takes the
  newest picture, so a fast swipe skips steps instead of queueing USB patches.
- **An adjustable countdown at rest is turned by the deck itself**
  (`firmware/src/keys/`, `wheel=1`).
  - **The look:** the app sends it once (`WHEEL`, `src/shared/wheel-spec.ts`):
    backdrop, the digits rasterised in the app's font, labels, and drum and
    physics settings. The deck keeps four looks by CRC, and `WHEELAT` re-arms
    one. `WHEEL` with cell -1 keeps a look without arming it.
  - **Motion:** the deck animates at the panel's rate and reports only the label
    it lands on (`EV … WHEEL`).
  - **Outside the page picture:** the wheel is drawn over the page copy without
    changing it, so `livePatched` is untouched. A `LIVE` picture for a key of
    the page shown ends its wheel.
  - **Tuning:** feel constants are in `WHEEL_FEEL` (app side) and need no
    reflash.
  - **Fallback:** without `wheel=1` the app steps the wheel from `MOVE` events.
- **Countdown sound** plays in the renderer through an `<audio>` element
  (`use-countdown-alarms.ts`), looping `kalimba.wav`. Fetching a bundled file
  would fail: Chromium's fetch refuses `file://` and the CSP allows only
  `connect-src 'self'`. The window needs
  `autoplayPolicy: "no-user-gesture-required"`, because it rings hidden in the
  tray, where no click ever happens. A tap on an ended countdown resets it.
- **Ping** times TCP to port 443 (ICMP is blocked on the user's network), with a
  second connection raced after 500 ms and ping.exe as a fallback.
- **Dials, rolls and the die (`dial=1`).** The volume is a dial: a version 2
  look (the key at its lowest, at its highest, and a per-pixel fill map). The
  deck reports `EV … VALUE` at most every 40 ms and the app sets Windows'
  volume.
  - **Coin, yes/no, list:** a drum; the app picks the side, and `WHEELROLL`
    spins to it, always forward (`rolling` in `ArmedWheel`).
  - **The die:** a 3D cube the deck draws and throws (look version 3,
    `src/shared/die.ts` mirrors its sums). Its "label" is how it lies (face,
    place, turn) and is kept as `rest` in widget state. How it lands must stay
    fair: see [[2026-09-11-deck-dice]].
  - **Same-kind looks:** a new look of the same kind takes over a key that is
    still moving without stopping it.
  - **How many looks the deck keeps:** one per key and one more, and never a
    look an armed key uses (`AnimatedKeys::LOOKS`). Released firmware up to
    0.1.4 kept four and dropped the one armed least lately, disarming its key
    without a word. So a refused `WHEELROLL` makes the app roll in its place and
    forget the arming (`rollOnDeck`); the look goes again with the key's next
    picture. Every mute makes a look of its own (greyed), so each dial on a page
    can need two.
- **Sliding text (`slide=1`).** A Now playing title or artist too long for the
  key is left out of its picture and sent to the deck as `SLIDE`
  (`shared/slide-spec.ts`; drawn by `features/widgets/slide.ts`). The deck
  slides it over the picture, so `LIVE` pictures change under it.
  - **Lifetime:** it belongs to the deck's copy of the page and goes with the
    key's live picture. `liveOverlays` in `main/widgets/live-keys.ts` mirrors
    `livePatched`: a new version carries it with the live picture, and `HELLO`
    and disconnect drop everything.
  - **Sending:** new text goes after its picture and is taken away before one,
    only when its CRC differs. The strip must render the same every time: the
    media key redraws every second, and new text restarts the slide.
  - See [[2026-09-11-sliding-text]].
- **Rings' arcs (`sweep=1`).** Only OBS's 5-second countdown ring has its arc
  moved by the deck (`SWEEP`, `shared/sweep-spec.ts`); the key's picture keeps
  only the track. Its drawing hands the arc to `moment.sweeps` through
  `sweepArc` (canvas-kit), with a motion: held, or `(t - zero) / turn` in the
  PC's clock. Keep motions exact integers from widget state, so the payload is
  identical second to second and goes once.
  - The timer (stopwatch and countdown) and pomodoro rings step with their
    digits, drawn into each second's picture (`timeRing`). The user tried them
    smooth and asked for "old version" for all but OBS.
  - Sliding text and arcs are both firmware `KeyOverlay`s and travel as
    `KeyOverlays` (`{ slide, sweep }`) through `liveKey`, the warmup and
    `LiveKeys`. An overlay taken away goes before the picture without it; one
    that comes or changes, after.
  - See [[2026-09-11-deck-rings]].
- **Readings** (volume, mic, media, CPU, prices) come from `WidgetFeeds` and are
  never saved. Only `KEPT_STATE` fields (what a person did) go to
  `widgets.json`.
  - **Sound is event-driven:** the Windows helper registers Core Audio volume
    callbacks (`watch-audio`) and writes `{"event":"audio"}` lines by itself;
    the app polls only every 15 s as a safety net. Echoes of the app's own
    volume sets are ignored for 400 ms so a turning dial never jumps back.
  - **Taps show at once:** mute and play/pause change the key before Windows
    answers; Windows' own word follows.
  - **Windows helper:** one persistent PowerShell
    (`main/system/windows-host.ps1`), one JSON line per request, answered in
    order; lines without an id are events.
  - **WinRT traps in PowerShell:** a WinRT stream is read by invoking
    `IInputStream.ReadAsync` through reflection on `$x.psobject.BaseObject`.
    Operations with progress need `AsTask` with both type arguments.
    `AsStreamForRead` and `GetInputStreamAt` fail from PowerShell. WinRT events
    are out of reach: the main loop blocks on `ReadLine`, so media is still read
    every second.
  - **Prices are live:** Binance's public stream
    (`wss://data-stream.binance.vision`, no key) for all coins on one socket,
    klines hourly for the chart, REST then CoinGecko for a coin the stream is
    quiet about (`main/widgets/crypto-feed.ts`). US dollars only (USDT).
- **Retired settings are dropped on load** (`retireWidgets` in
  `shared/config.ts`, each kind's `retire`): the network widget, crypto currency
  and interval; a microphone in a style since gone becomes an arc. Without it an
  old profile fails validation and the whole configuration is refused.
- **New firmware commands that older desktops can skip are `ID` flags**, not
  protocol bumps. Released apps reject any protocol above 7 (`serial.ts`).

**Why:** a 29 KB key cannot be resent every second over USB; patches take 20-95
ms, and uploads are bounded by [[usb-upload-blocks]].

**How to apply:** a new widget type needs no firmware change. It needs its kind,
its view, its action if it has one, and one registry line in each; a type
missing from a registry does not compile.

- **Kind** (`shared/widgets/<type>.ts`, `WidgetKind`): its settings type,
  defaults, validation, `nextChange`, and `press`/`swipe` if those change its
  state. Its type also joins the `Widget` union in `shared/widgets.ts`.
- **View** (`renderer/src/features/widgets/kinds/<type>/`, `WidgetView`): its
  drawing, its settings fields, `sample` (the made-up readings its style tiles
  show), and a `deckLook` if the deck turns it.
- **Action** (`main/widgets/actions/`, `WidgetAction`): only if a press does
  something beyond its own state - mute, play, roll. Its `gestures` table says
  what `tap`, `double`, `triple` and `hold` do. Only an action with `double` or
  `triple` makes its taps wait `TAP_GAP_MS` (300 ms) for another
  (`tap-runs.ts`), so give those to a widget only where the later tap is worth
  it.
- **Registries:** `shared/widgets/registry.ts`,
  `renderer/src/features/widgets/kinds/registry.ts`,
  `main/widgets/actions/registry.ts`.
- **Alike types share one generic module** ([[generic-over-copies]]): the volume
  and the microphone are `levelKind(...)`, `levelView(device)` (the
  `kinds/level/` folder, per-device icons and words in its `DEVICES`) and
  `SoundAction(device)`; the helper's `level`/`mute` requests take the device's
  flow. A turned dial goes to its action's `turned`.

Anything it reads goes in `WidgetFeeds` (a line in `sync`'s `reads`) - as events
where the source can tell of its changes - and anything a person sets that must
survive a restart goes in `KEPT_STATE`. Keep its base picture time-free.
Anything that must animate or follow a finger goes on the deck instead
([[deck-first-for-animation]]). Text that can outgrow its key goes to
`moment.slides` through `slideLine` rather than being cut with `clip`. A ring
the deck should move goes through `sweepArc` with a motion; the user wants that
only where asked (OBS's countdown). Removing a
setting needs its kind's `retire`.

**Designs are picked on the key, not only in the app.** A kind's `designs()`
lists the whole widgets it can be shown as (a clock's three faces, a die /
coin / yes-no / list, a level's arc and bar); a hold offers them on the key
itself, a dot each, every tap moves on, and three quiet seconds save the one
showing through `Workspace.setWidget`. `WidgetState.choosing` carries it, and
`deckTurned` answers null while it is set so the deck stops turning that key
and shows the preview instead. A widget whose hold already does something
never gets the picker, so freeing dice's hold (a duplicate of its tap) was
what let dice into it.
