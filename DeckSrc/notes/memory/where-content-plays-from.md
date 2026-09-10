---
name: where-content-plays-from
type: constraint
---

Every key's content lives on the SD card. Where it *plays from* is decided by the
firmware, not by whoever sends it: **memory if it fits, card if it does not.**
Nothing about length or size has to be chosen on the host.

|                | In PSRAM | Streamed from card |
|----------------|----------|--------------------|
| Cost per frame | ~1.3 ms  | **~26 ms**         |
| Memory per key | whole pack (350 KB - 2 MB) | one frame (~15 KB) |
| Size limit     | shared ~5.5 MB across 15 keys | none |

**Streaming costs about twenty times what memory playback does**, almost all of
it the card read - so it is a fallback, not a default. It runs on the second
core, which matters: the cost is *waiting* on SPI rather than work, so overlapping
it with drawing took a streamed frame from 41 ms to 26 ms. This is not the
earlier dual-core attempt that broke the panel; that one put GIF decoders on both
cores and starved the display DMA of PSRAM, while an SPI read competes for almost
none.

**Keep a floor of free PSRAM.** Loading content until memory ran out worked, and
then the board rebooted into a state where nothing could be allocated and every
key fell back to its built-in animation. Anything that would eat the last
768 KB streams instead. Slower is a trade; unstable is not.

**The card reads at 383 KB/s and nothing changes that.** Measured across read
sizes from 14 KB to 112 KB: 382, 382, 382, 383. Raising SDSPI's clock from 20 to
40 MHz measured 383 against 386. So the limit is the driver and the card over
SPI, not the clock and not the transfer size - and **read-ahead buffering would
buy nothing**, which is worth knowing before building it.

Consequences worth remembering:
- Boot reads every stored key back, so start-up time is `total content / 383 KB/s`
  - about 13 s for 5 MB.
- A full-size frame (118x118) is 14.4 KB, so a streamed key cannot exceed ~24 fps
  even alone.
- Uploads write straight to the card as blocks arrive, so an animation's length
  is limited by the card, not by PSRAM. A 151-frame clip at full size is 2.2 MB
  and works.

**Serve the most overdue key, never the lowest-numbered one.** This bit twice.
The main loop scanned keys in index order, and so does the scanout beam - so by
the time a pass reached the bottom row the beam was late in the frame, which is
exactly when that row cannot be written, and it stuttered while the top rows ran
smoothly. The card reader had the same shape of bug with worse symptoms: the
first streamed key took the entire 383 KB/s and the other three got **zero**
frames, frozen while their neighbour ran at 24 fps. Ordering by lateness turned
that into 6 fps each - the shortage shared rather than handed to one key.

**One full-size key nearly saturates the card.** 15 KB a frame at 24 fps is
357 KB/s against 383 available. Streaming is therefore for one key, or a few
slow ones - never a general fallback for a deck full of content.

**The panel allocates one frame buffer, not two.** Nothing ever flipped them:
every drawing path writes into the buffer being scanned, and the second was
mirrored once at start-up and never touched again. Removing it returned 768 KB -
enough to move two more keys off the card and into memory, which took them from
6 fps to 25 and doubled what was left for the two still streaming. Worth
remembering how much an idle allocation cost on a board where memory decides how
content plays.

**Budget: about 370 KB per key** if all fifteen are to play from memory
(5.5 MB shared). At full key size that is 24 frames; at 96x100, 36. More frames
needs a smaller frame.

See [[frame-pack-format]], [[sd-card-storage]], [[pushing-media-without-flashing]].
