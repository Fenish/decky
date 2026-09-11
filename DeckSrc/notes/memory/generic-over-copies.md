---
name: generic-over-copies
description:
  Code style the user asks for - handler tables instead of long if/else chains,
  and one generic, parameterised module instead of near-identical per-type files
metadata:
  type: feedback
---

**The user's rule:** structured, object-oriented code, never spaghetti.

- **Tables, not chains.** A long `if`/`else` or `switch` over kinds becomes a
  handler table: `{name, &Class::method}` rows in the firmware, typed
  `{ [K in Kind]: handler }` records in the app. A short exhaustive `switch`
  over a small closed enum is fine.
- **One generic module, told what it is.** When two things behave alike (the
  volume and the microphone), write the shared behaviour once and have each
  caller pass what differs: the level view is `levelView(device)`, called from
  the registry for each widget type, and `SoundAction(device)` does the same in
  main. Never a per-type file that only wraps the shared one.

**Why:** people try Decky within a week of 2026-09-11, and the user does not
want to ship badly structured code. They rejected a `switch (widget.type)`, and
then separate `volume-view.ts`/`mic-view.ts` wrappers around a shared module.

**How to apply:** before adding a second, similar type, make the first one
generic and rename it for what it is. Keep per-type data in a small table inside
the generic module, looked up lazily, never read while modules load (the widget
modules import one another in a ring). Related: [[widgets]].
