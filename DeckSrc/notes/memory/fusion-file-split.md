---
name: fusion-file-split
type: environment
---

The design lives in the "3d print" Fusion project, split across three files —
`streamdeck` (the deck itself), `streamdeck_clamping_unit`, `streamdeck_strut` —
plus `streamdeck_assembly`, which references all three for joint testing.

**Why it matters:** editing the wrong file, or checking the assembly instead of
the part, silently diverges the design. See [[fusion-source-of-truth]].
