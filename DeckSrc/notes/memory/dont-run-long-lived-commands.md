---
name: dont-run-long-lived-commands
type: feedback
---

Do not start long-lived or interactive commands - `pnpm dev`, `npm run dev`,
`electron .`, watch servers. The user runs those. Build, typecheck, lint and
flash commands that finish on their own are fine.

**Why:** they hang in this environment rather than returning, and a hung command
has twice cost real time here - once leaving `esptool` stuck mid-write, which
left the board unbootable.

**How to apply:** finish with something that exits (`npm run build`,
`npm run typecheck`, `npm run lint`), report what is ready, and let the user
start the app. If a change needs to be seen running, say so and hand it over
rather than launching it.

See [[flashing-the-panel]].
