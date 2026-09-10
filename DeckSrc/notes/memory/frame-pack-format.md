---
name: frame-pack-format
type: constraint
---

Content is decoded **on the host**, not on the deck. The desktop side crops,
squares, scales, quantises and emits finished frames; the firmware only copies
them through a lookup table. No decoder runs at playback time.

Two reasons, both measured. Decoding cost two thirds of the per-frame budget and
was repeated every loop for a sequence that never changes. And the GIF decoder
has been the source of every rendering bug on this panel - blank cells, ghost
trails, and colours that appear nowhere in the source file.

**The pack format** (all little endian):

```
0   'D' 'E' 'C' 'K'
4   version (1)
5   flags (0)
6   width
8   height
10  frame count
12  reserved (4 bytes)
16  per frame: delay_ms (2), palette (256 x RGB565), width*height indices
```

A palette per frame, not one shared: 512 bytes each is about 5% overhead and it
holds the colour of footage that shifts as it plays.

**Frames must live in PSRAM, not stream from the card.** Playback needs about
6.5 MB/s (15 cells x 15 fps x 14 KB); SD over SPI gives 1-2. That is what fixes
the format at 8-bit indices: RGB565 would be a straight memcpy and faster, but
15 cells of it will not fit in 5.5 MB of PSRAM.

Adopting a pack is zero-copy - the frame pointers point into the pack buffer
itself, so it costs nothing beyond the pack.

**Measured:** a packed cell costs ~2.26 ms per frame against ~4.3 ms decoded,
1.9x cheaper. Staging each line in internal RAM before copying to PSRAM was
tried and was *slower* (2.68 ms); the write pattern is not the bottleneck.

See [[pushing-media-without-flashing]], [[gif-encoding-for-the-panel]].
