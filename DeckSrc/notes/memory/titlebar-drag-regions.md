---
name: titlebar-drag-regions
type: constraint
---

The window is frameless; the title bar (`.custom-titlebar`) is
`-webkit-app-region: drag`, and its buttons and pill are `no-drag`. Electron
builds the drag area from the title bar's boxes in page order, later boxes
winning. A `::after` of the title bar placed over the buttons therefore
re-covered them with drag area: minimize, maximize, close and the updates pill
stopped taking clicks or hover. The same shade as a `::before` would have been
harmless only because it comes first.

**How to apply:** decoration over the title bar goes in its own element outside
it (like `.titlebar-shade`, rendered before the header), never in a
pseudo-element or child that follows the controls. `pointer-events: none` and
`z-index` do not help; the drag area ignores both.
