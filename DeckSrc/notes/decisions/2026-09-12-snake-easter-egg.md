---
name: 2026-09-12-snake-easter-egg
description:
  Five taps on an empty key play snake on the deck; one board behind the fifteen
  windows, steered by swiping, with the panel crushing into falling tiles at
  either end
metadata:
  type: decision
---

# Snake on the deck, and how it takes the panel

**Decision.** Five taps in a row on a key with nothing assigned to it start
snake on the deck itself (`firmware/src/game/snake.cpp`). The deck draws and
plays it; the window only keeps the score. When it ends the deck draws its own
page again, and the keys work as before.

**One board, not fifteen little ones.** The board is a single 20x12 grid over
the whole panel, and each key opening shows a 4x4 corner of it. The snake runs
behind the printed ribs and comes out the other side. Fifteen separate boards
was the alternative; it makes the ribs into walls, which is not a board.

**Swiping, not pressing.** A key press is a tile of the board, not a direction:
there is no natural place for four arrows on a grid that is also the playfield.
So a finger dragged anywhere across the panel turns the snake - 24 px in a
direction is a flick, less is a wobble - and the count-down before the first
move says SWIPE TO MOVE, a word to a key, because nothing else would tell you.
`KeyListener` gained a raw `touched(x, y, down, now)` for this: the game needs
the finger before the grid has decided which key it is over.

**The crush comes from the framebuffer.** Both ends of the game shatter what is
on screen into tiles that fall out of their openings. The tiles are the
picture's own colours, sampled one pixel per tile straight from
`panel::framebuffer()` (8x8 tiles a key, 960 in all, about 5 KB). Nothing has to
be kept, no page has to be re-read, and the memory the widgets needed back
yesterday ([[widgets]]) is untouched.

**Nothing else may draw while it runs.** Live patches, wheels and page states go
on arriving from the desktop during a game. They are all taken - the deck keeps
them - but the drawing is gated behind one predicate, `Deck::panel_free()`,
which now also covers the status screen and page changes it used to be spelled
out for at six call sites. The page is drawn whole when the panel comes back, so
everything that arrived meanwhile appears at once. Pausing the desktop's sends
instead was the alternative: more moving parts, and a deck that could still be
drawn over by anything that forgot.

**Why the desktop counts the taps.** The deck does not know which of its keys
are empty - it has pictures, not meaning. The desktop does, so `EmptyTaps` in
`deck-events.ts` counts taps on one empty key within 2.5 s of each other and
sends `GAME snake`; the deck's part is `GAME snake|off` and `EV GAME
SCORE|OVER`.

**Would change it.** A board that is too fast or too small to be fun on a real
panel (220 ms a step, down to 90 ms). Anyone finding it by accident - five taps
on an empty key is meant to be deliberate, and nothing on screen hints at it.
