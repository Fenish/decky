---
date: 2026-09-11
status: accepted
---

# Widgets: drawn by the app, patched onto the deck

**Context:** the user asked for widget keys: a clock (12/24-hour, several
styles), timer, pomodoro, countdown, counter, ping (first built as a server
status check) and note. A clock with seconds changes a key every second, and a
key image is 29 KB. Over USB, measured at about 24 KB/s, sending a whole key
takes about 1.2 s.

**Choice:**

- The desktop draws every widget on a canvas, like any other key. The deck gets
  pictures, not widget logic: no clock, timers or network checks in firmware.
- Page uploads carry each widget's _base picture_, which only its settings
  decide. The time never changes a page's signature, so the PSRAM and SD caches
  keep matching.
- While a page is shown, the renderer redraws a widget when its picture next
  changes. The main process sends the difference from the picture the deck
  holds: `LIVE <page> <sig> <cell> <baseCRC> <bytes> <crc>`. The patch holds the
  changed box of each 32 × 32 tile, run-length encoded. It travels through the
  existing READY/block-ack transfer. The deck refuses the patch when its copy
  does not match `baseCRC`, and the app then sends the whole key (base 0).
- Widget state (timer, pomodoro, counter) lives in the main process, in
  `widgets.json`.
- The firmware announces `live=1` in `ID`; `DECKY_PROTOCOL` stays at 7.

**Rejected:**

- _The deck draws widgets._ It needs fonts, time zones, time sync and network
  checks in firmware, and a reflash for every new style.
- _Resending the whole key every tick._ At about 1.2 s per key over USB it
  cannot keep up with a seconds display.
- _Protocol 8._ Released apps accept only protocols 1-7 (`serial.ts:113`,
  `BOOT decky [3-7]` at `:147`), so they would reject the new firmware as not a
  Decky. A flag lets either side update first.

**Review:** a fresh critic read the code and returned _sound with caveats_.

1. **The deck's copy drifts from the app's baseline** (SD reloads, a rebuild
   copying patched pixels, failed patches), and `LIVE <cell>` could race a page
   switch. _Accepted:_ page, signature and base CRC go in the command, and base
   pictures are time-independent. Falsifier given: after eviction, a reboot and
   an app restart, the deck's key matches the app's image and startup is no
   slower.
2. **Taps are lost inside transfers**, which widgets make constant. _Accepted:_
   the firmware polls touch between blocks and while waiting for data, at least
   15 ms apart. Falsifier: 100 quick taps on a page with a seconds clock give
   100 `EV DOWN` events.
3. **Chromium slows timers in the hidden (tray) window.** _Accepted:_
   `backgroundThrottling: false`. Falsifier: ticks stay 1000 ± 50 ms apart after
   10 minutes in the tray.

Also raised was protocol 8 being rejected by current apps; the capability flag
answers it. The critic also suggested batching all changed keys of a tick into
one command. _Not adopted:_ a page holds one or two ticking widgets, so each
sends its own `LIVE`. Revisit if a page of seconds clocks lags.

**Measured (USB):** a small patch takes 21 ms. A 968-byte patch, the worst
seconds-digit change, takes about 94 ms. A whole plain key, run-length encoded,
takes 35 ms. A wrong base is refused. The critic's budget of 30-80 ms per tick
was close, and the worst case ran a little over it.

**Did it matter:**

- **Objection 1: yes, and it went further than the fix.** The base-CRC check
  covers keys that are still widgets. The user then moved a digital clock, and
  its last picture stayed behind on the deck. A digital clock's base picture is
  only its background, the same as an empty key's. So moving it changed neither
  the signature nor any picture, and the deck's patched copy was shown as it
  stood.
  - _Fix (desktop only):_ `livePatched` records, for each copy of a page the
    deck holds (page id and signature), which keys patches drew into.
  - A patched key is re-sent whenever the page is rebuilt from that copy, so
    committed pages and their SD copies hold exactly their own pictures. The SD
    loader checks the pixel CRC against the signature, so patched pixels there
    would also have made it refuse the page after a reboot.
  - When the deck already holds the page, a patched key that is no longer a
    widget is restored with a whole-key `LIVE`. `sendLive` refuses keys that are
    not widgets.
  - `tests/widget-live-sync.test.ts` reproduces the bug against a simulated
    deck. Switching off either half of the fix fails it.
- **Objections 2 and 3:** open; their falsifiers have not been run yet.

**Ping, settled by measurement:** on the user's network (behind a VPN adapter),
ICMP to the internet never answers while TCP to port 443 answers in 16-46 ms.
One TCP handshake in 30 was lost outright (no answer within 8 s). So the ping
widget times a TCP connection to port 443, and a refusal counts as an answer. A
second connection starts if the first has not answered after 500 ms, and
whichever answers first counts, timed from its own start. In the result, 40 of
40 answered. ping.exe runs only when TCP gets no answer; a LAN router that
dropped TCP to 443 answered it in 1 ms.

See [[widgets]].
