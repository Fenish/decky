---
name: pushing-media-without-flashing
type: reference
---

Content can be put on any key over the serial port while the deck runs, with no
reflash:

```
python tools/push_media.py <key 1-15> <file>          # PNG, JPG, GIF, WebP
python tools/push_media.py 3 clip.gif --max-frames 60 # thin a long animation
python tools/dump_cell.py <cell 0-14> --out shot.png  # read a key back
python tools/cmd.py SDINFO                            # card and free space
python tools/cmd.py SDFORMAT                          # erase the card
```

**Images and animations share one path.** The host converts anything Pillow can
open into a full-frame GIF; a still becomes a one-frame GIF. The firmware has a
single decoder and a single format. A still is drawn once and then costs no CPU
at all, which is a way to buy headroom for the animated keys.

**Two hard limits, both measured:**

- **Send 128 bytes at a time and wait for the board's `A`.** That is the size of
  the chip's hardware UART FIFO. 256-byte blocks lose bytes and streaming
  without acknowledgements loses about a hundred near the end. The loss happens
  in hardware, so `setRxBufferSize` cannot prevent it. Host and firmware block
  sizes must match, or every block waits out the firmware's timeout instead of
  being acknowledged - that is the difference between 8 seconds and 93 for the
  same payload.
- **Never let the host tools touch DTR/RTS.** Those lines are wired to reset.
  pyserial asserts DTR on open by default, so a naive `serial.Serial(...)`
  reboots the deck and wipes everything pushed. Both tools open the port with
  the lines already low.

**Pushed content persists.** It is written to the SD card under `/sd/deck/`
as `k<cell>.gif` and reloaded into PSRAM at boot, so a key keeps its picture
across a power cycle. Verified by pushing, resetting, and reading the panel back:
the pixel counts matched exactly. Without a card the firmware still runs and
still accepts pushes, but says so at boot and forgets them on reset.

`CLEAR <cell>` and `CLEARALL` delete stored content; the key keeps playing what
it has until the next reboot, when it falls back to its built-in animation.

Throughput is about 24 KB/s, so a 200 KB animation lands in 8 seconds.

`dump_cell.py` output has a caveat: the periodic status report shares the serial
port, so a hundred-odd pixels per dump are corrupted by text landing in the
binary stream. Those are an artefact of the tool, not of the panel - confirmed by
two dumps of identical content disagreeing on exactly that patch.

See [[gif-encoding-for-the-panel]], [[flashing-the-panel]].
