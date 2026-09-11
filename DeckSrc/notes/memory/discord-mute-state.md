---
name: discord-mute-state
type: constraint
---

Discord's own mute and deafen can be read with no sign-in from its local
storage: `%APPDATA%\discord\Local Storage\leveldb`, key
`_https://discord.com\x00\x01MediaEngineStore`, JSON `default.mute` and
`default.deaf` (the value starts with a byte: 0x01 Latin-1, 0x00 UTF-16). Take
the entry with the highest sequence number across the `.log` (plain) and `.ldb`
(snappy-compressed tables) files; both open fine while Discord runs.

It is saved 5.0-5.2 s after the first change of a burst: Chromium's fixed commit
delay, timed on 2026-09-11 against click times. A change undone within those 5 s
never reaches the disk. Read-only, and Discord's internals: an update may move
it.

The official way, RPC `GET_VOICE_SETTINGS` / `VOICE_SETTINGS_UPDATE` over
`\\.\pipe\discord-ipc-0`, needs the `rpc` or `rpc.voice.read` OAuth scope.
Without it the pipe answers `4006 Not authenticated or invalid scope`. RPC is a
closed private beta; the docs say an unapproved app gets it only for its owner
and up to 50 testers. In practice, on 2026-09-11, the Decky app (see
[[discord-rich-presence]]) was refused both scopes for fenish, the account
Discord was logged into: the Authorize popup shows, and clicking Authorize
returns `5000 invalid_scope`. Unexplained: the app may be under a Team, or new
apps may get no RPC access at all (`rpc_application_state` 0).

UI Automation does not work: while Discord sits in the tray its window exposes 6
frame panes and no web content.

The StreamKit route works (2026-09-11): AUTHORIZE `['rpc']` as Discord's own
approved StreamKit Overlay app (`207646673902501888`) over the pipe, then POST
`{code}` to `https://streamkit.discord.com/overlay/token`. That returns only
`{access_token}`: no refresh token, 7 days. `VOICE_SETTINGS_UPDATE` then arrives
the instant mute or deafen changes. Unofficial: Decky poses as StreamKit, the
popup and Authorized Apps say "Discord StreamKit Overlay", and Discord can end
it anytime. Rich Presence shown from those events lags after rapid toggling:
Discord throttles activity updates, not the events.

**Why it matters:** Decky's own app cannot get realtime voice state. Local
storage works for everyone but runs about 5 s behind, which the user found too
slow for a key. StreamKit is realtime but unofficial.

Related: [[discord-rich-presence]], [[integrations]],
[[2026-09-11-integrations]].
