---
name: serial-unplug-stall
type: project
---

When the USB cable is pulled, the serial library closes the port itself (a
`close` event with `disconnected: true`). After that, a `write` or `drain` on
that port object never calls back: `@serialport/stream` holds them until the
port reopens, which it never does.

**Why it matters:** every deck command runs through one serial queue in the main
process. One write to a dead port stalls the queue forever, so the status check,
the Disconnected page and the Wi-Fi fallback all stop. Measured on the real
deck: the close event arrived about 1 s after the unplug, and a PING sent after
it was still waiting 12 s later.

**Wi-Fi has the same trap, worse.** A deck whose power goes never closes its TCP
connection: a write waits on TCP's own timeouts (minutes), and the whole queue
waits with it, so Decky goes on looking connected. Since 2026-09-12 the socket
is dropped when the deck ends it, a write over Wi-Fi gives up after 3 s, and a
ping still waiting while `DeckLink.silentFor` passes 8 s counts as the link gone
(`DeckSession.linkLost`, which also frees the queue by closing the link).

**How to apply:** `DeckLink` drops its port on `close` and refuses to write to a
port that is not open (`src/main/device/serial.ts`). Keep both, and the Wi-Fi
guards above. Any new code that talks to a port must not reuse a port object
after `close`. Watch the host, never the deck: listing ports and reading socket
state cost the deck nothing, while polling it would. `tests/serial.test.ts` pins
this with a fake port that behaves like the library.

Related: [[connection-priority]].
