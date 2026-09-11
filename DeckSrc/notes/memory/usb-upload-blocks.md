---
name: usb-upload-blocks
description:
  USB uploads go in acknowledged blocks; 2 KB blocks (asked with BLOCK) are
  ~1.6x faster than 128; it needs the deck's 8 KB receive buffer
metadata:
  type: project
---

Uploads to the deck (`PUSH`, `LIVE`, `ALT`, `WHEEL`) go in blocks, each
acknowledged with `A` before the next. Over USB the protocol used 128-byte
blocks; since `block=4096` firmware the app asks for 2048 with `BLOCK` right
after `HELLO`, and `READY <n>` names the size.

- **Measured on the deck, a 24 KB look:** 128-byte blocks 1.7 s (1.3 s once the
  UART hands bytes on from 32 rather than 120), 2 KB 0.8 s, 4 KB 1.0 s. 2 KB is
  the sweet spot.
- **What makes big blocks safe** is the receive buffer: `Serial.setRxBufferSize`
  of 8 KB before `begin`, so a whole block waits while the loop draws. It was
  not the core the UART interrupt runs on - an A/B with it moved to core 0
  measured the same.
- **Compatibility:** released apps reject any serial `READY` size but 128, so
  the deck only uses bigger blocks after `BLOCK`, and goes back to 128 on
  `HELLO` and when the desktop goes.
- **A test-script trap:** a script that ignores the size in `READY <n>` and
  keeps writing 128-byte chunks makes the deck wait for the rest of its block -
  `ERR transfer timeout 128/2048`. That looked like lost bytes and cost an
  evening of wrong theories; the timeout now says how much of the block came.

**Why:** every widget picture, look and page goes this way; the round trip per
block, not the baud rate, was the limit.

**How to apply:** keep uploads block-acknowledged. Test tools must honour the
block size `READY` names.
