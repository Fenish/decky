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

**How to apply:** `DeckLink` drops its port on `close` and refuses to write to a
port that is not open (`src/main/device/serial.ts`). Keep both. Any new code
that talks to a port must not reuse a port object after `close`.
`tests/serial.test.ts` pins this with a fake port that behaves like the library.

Related: [[connection-priority]].
