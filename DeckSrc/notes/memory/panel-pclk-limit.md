---
name: panel-pclk-limit
type: constraint
---

The RGB panel runs at **24 MHz pixel clock with a 40-line bounce buffer**. The
pixel clock is not independently choosable: it is bounded by how much PSRAM
contention the scanout DMA can absorb, and the bounce buffer is what absorbs it.

The history matters, because the obvious conclusion was wrong. At 24 MHz with
Elecrow's stock 10-line bounce buffer, stray flickering lines appear in the
left-hand cells - pixels that are not in the frame buffer at all - which is the
DMA losing the race to fetch the scanline. Dropping to 15 MHz hides this, and
15 MHz was believed to be the panel's limit. It is not. Widening the bounce
buffer to 40 lines (≈95 KB of internal RAM) fixes the same artefacts at 24 MHz,
under full animation load with fifteen GIF decoders also hammering PSRAM.

Pixel clock sets the refresh rate: `freq / (H_TOTAL * V_TOTAL)`, which is
`24 MHz / (928 * 525)` = **49.3 Hz**. At 15 MHz it was 30.8 Hz, and the low
refresh was visible. `panel::REFRESH_HZ` computes this; do not rely on a
remembered number.

Raising the clock further is plausible - internal RAM has ~160 KB spare for a
bigger bounce buffer - but must be re-tested for artefacts *under load*, not just
booted, since an idle panel does not contend for PSRAM.

Elecrow contradicts itself here: their readme's `LGFX` config says 15 MHz, their
LVGL example says 24 MHz. Neither mentions the bounce buffer, which is the part
that actually decides.

Also: the driver is configured with two frame buffers, but LovyanGFX only ever
draws into the first. Anything rendered must be mirrored into the second, or a
buffer switch blanks the image.

**Why it matters:** the artefacts look like a defective panel or a bad ribbon,
and treating 15 MHz as the ceiling silently costs 40% of the refresh rate.
Confirmed on hardware 2026-08-20.

See [[firmware-build-status]], [[flashing-the-panel]], [[screen-tearing-fix]].
