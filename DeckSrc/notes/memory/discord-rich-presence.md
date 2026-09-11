---
name: discord-rich-presence
type: constraint
---

Decky's Discord application is `1548005754705813654` ("Decky", owned by the
user). The ID is public, and Rich Presence needs nothing else: handshake on
`\\.\pipe\discord-ipc-0` with `{v: 1, client_id}`, then
`SET_ACTIVITY {pid, activity}`. No OAuth, no secret, works for every user. The
activity clears when that pid's process exits or the pipe closes. The Public Key
is only for interaction webhooks. The Client Secret must never be in the repo or
the app.

Discord shows one "Playing" (type 0) activity at a time, and the one already
there stays. With the VS Code presence ("Code") running, "Playing Decky" was
accepted but shown nowhere; the same activity as type 3, "Watching Decky",
showed next to it (tested 2026-09-11).

**Why it matters:** as "Playing", Decky's presence is either invisible or pushes
out the game a user is actually playing. Use another type, behind an on/off
setting.

Related: [[discord-mute-state]].

**Built (2026-09-11):** Settings → Show on Discord (off by default).
`src/main/discord/discord-ipc.ts` is the pipe client, reusable for Discord's
controls later. `src/main/discord/presence.ts` gathers the facts: the deck
connected, a key open in the editor, OBS outputs, updates installing, and
presses today. `src/shared/presence.ts` turns them into the card. The user
chose "presses only, no names": pages and keys are never named. The picture
is the art asset `decky`, which the user uploads in the Developer Portal. At
most one update every 4 s, and only when the card changed.
