---
name: sd-card-storage
type: environment
---

The panel has a **TF (microSD) slot**, on SPI:

```
MOSI IO11   MISO IO13   CLK IO12   CS IO10
```

From Elecrow's wiki for the 7.0-inch Basic model, and **confirmed on hardware
2026-08-20**: a 16 GB card mounts and reports its filesystem correctly over
SPI2, with no DIP switch or jumper. (A warning about SD pins being shared with
audio and wireless via DIP switches applies to the *Advance* model, not this
one.) The RGB panel uses the LCD peripheral and touch uses I2C, so SPI2 is free.

Serial commands: `SDINFO` reports the card and free space, `SDFORMAT` erases it
and lays down a fresh filesystem.

**Why it matters:** onboard flash is **4 MB and that is a hard limit** -
confirmed from the chip itself (`esptool flash-id`: device 0xc84016, "Detected
flash size: 4MB"), matching the N4R8 module marking. It cannot be repartitioned
larger. After the bootloader, a 2 MB application and the housekeeping
partitions, about 1.9 MB is left for content, or roughly 3 MB if the built-in
animations are dropped once storage works.

That is enough for one page of 15 keys at ~200 KB each, and multi-page would
have needed aggressive compression - but with a card present the ceiling stops
being a design constraint at all. Content should live on the card, with onboard
flash kept for the firmware.

See [[crowpanel-display]], [[pushing-media-without-flashing]].
