# Use both cores by default

**Decision:** work that is genuinely parallel is spread across both ESP32-S3
cores by default, not left on the Arduino core. Performance is treated as a
first-class requirement for this firmware, not something to revisit later.

**Context:** the animation test was decode-bound at ~16 frames per second per
cell. One core was 92% busy (230 frames/s x 4 ms) while the second sat idle -
Arduino runs `loop()` on one core and reserves the other for the WiFi and
Bluetooth stacks, neither of which this project uses.

**Scope and limits.** "Use every core" is applied where there is real independent
work. The fifteen cells qualify completely: each owns a disjoint rectangle of the
frame buffer, shares no state, and needs no locking. Serial work is not split -
forcing parallelism onto a dependent chain adds synchronisation cost and runs
slower, so the rule is "parallelise independent work", not "parallelise
everything".

**Consequence to watch:** two cores writing to PSRAM at once contend with the
display's scanout DMA. That contention is what produced the flickering lines
documented in [[panel-pclk-limit]], and doubling the write load can reach the
same limit again. Internal RAM has ~160 KB spare for a larger bounce buffer if
it does. Any change here must be re-tested for artefacts under load.

**Status:** requested by the user 2026-08-20 as a standing preference.

## Outcome: tried, measured, reverted

Both cores were wired up and measured. The result contradicts the premise.

| | 1 core | 2 cores |
|---|---|---|
| Per cell | 15.3 fps | 20.5 fps |
| Total | 230 f/s | 307 f/s |
| Per-frame decode | 4.0 ms | 5.1 ms |
| Worst frame | 6.1 ms | 19 ms |
| Per-core load | 92% | 79% |

Throughput rose 34%, not the ~100% expected - and **the panel lost frame sync**:
the picture rolled vertically and glitched continuously. Reverted to one worker.

The numbers say why. Per-frame decode got *worse* with the second core, and
per-core load fell to 79% - cores were waiting, not working. The bottleneck is
PSRAM bandwidth, shared between the decoders and the display's scanout DMA, and
the DMA has a hard deadline. Adding a core adds demand to the contended resource
while adding nothing to it.

**The rule stands, but with a measured exception:** parallelise independent work
by default - unless it competes with the scanout DMA for PSRAM. On this board,
anything touching PSRAM in the hot path is bandwidth-bound, not CPU-bound, and
extra cores make it worse.

**If more speed is wanted, spend it on PSRAM traffic, not on cores.** The most
promising lead is that difference-encoded frames decode in ~1.9 ms against
~4.0 ms for full frames - better than two cores achieved, on one core. They were
abandoned because they ghosted (see [[gif-encoding-for-the-panel]]), but that
was worked around rather than diagnosed, and the cause may well be fixable.
