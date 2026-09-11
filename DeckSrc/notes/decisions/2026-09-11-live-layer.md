# Live pictures kept apart from a page's own

**Problem (user report):** changing one setting of a widget on the Debug page (8
live widgets) took about 5 s to reach the deck, which did nothing else
meanwhile. Measured afterwards on the deck: 10.4 s.

**Cause:** `LIVE` patches drew into the page copy's own pixels. An edit makes a
new version of the page, copied from the one shown, patches and all. So the app
re-sent every patched key whole (a raw 29 KB `PUSH` each). That kept the
committed pixels matching the signature, which the SD card copy is checked
against on load. Then it patched them live again.

**Measured, not guessed:** the app's own drawing per edit is 11-77 ms of widget
pictures and 0.3 s for every page. Not the problem.

**Decided:**

- **The deck keeps a per-key live picture apart from the page's own.**
  - `LIVE` writes into the live picture. A new version carries the live pictures
    and their sliding text (`live=<mask>` in the `CACHE` reply). The app sends
    only keys whose own picture changed.
  - Keys go as `PATCH`: the LIVE patch format against what the key holds.
  - `LIVE … 0 0 0` drops a live picture: for a widget moved or gone.
- **No new flag.** Nothing with `live=1` was ever released (HEAD's firmware has
  none of it), so the new meaning takes over `live=1`. The old re-send path is
  deleted rather than kept alongside.
- **Result on the deck, Debug page:**
  - volume arc→bar: 0.66 s, down from 10.4 s. One 2.7 KB patch, 0.4 s of it the
    card save.
  - Later the same day, the user still felt the deck freeze on an edit. `COMMIT`
    held the deck 550-570 ms for its card save, whether the edit was one key or
    a whole page. The deck now shows the page first and saves it in slices
    between frames: `COMMIT` answers in 6 ms, and a small edit takes 66-86 ms
    from `CACHE` to the reply.
  - loading that page whole: 22 KB, down from 311 KB.

## Critique (fresh agent, one round)

Verdict: sound with caveats.

1. **Silent fallback on low PSRAM.** Patching own pixels when a live buffer
   doesn't fit would write a card copy that says `stored=1` but never loads.
   **Accepted, changed:** no fallback. `LIVE` is refused (`ERR live memory`), so
   own pixels always stay as sent. The deck reports carried live pictures
   (`live=`), so the app never guesses what a new copy shows. The critic
   proposed a full dirty-mask protocol; refusing made it unnecessary.
2. **The card save as the next floor.** Measured at 406-458 ms per commit, and
   it freezes the deck meanwhile. **Accepted as real; not done now.** It needs a
   background save across cores and a lock around the card. Left as the next
   speed step.
3. **Live buffers breaking PSRAM into pieces.** Page slots could then fail to
   allocate. **Accepted:**
   - live pictures always leave the floor plus one page's worth in one piece;
   - page allocation checks the largest free block;
   - slots keep their buffers instead of freeing them.
4. **Smaller points, all accepted:**
   - the zero-byte drop;
   - dropping live pictures on `HELLO`;
   - seeding the new copy from the base's live keys minus the keys re-sent;
   - sliding text drawn over the live picture.

Did it matter? Point 1 changed the design, and 3 prevented a failure the user's
profile doesn't hit but larger ones would. Worth it.
