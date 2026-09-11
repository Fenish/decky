---
name: discord-rpc-control
type: constraint
---

With a StreamKit-route token (see [[discord-mute-state]]), Discord granted every
extra scope asked for:
`rpc rpc.voice.write rpc.video.write rpc.screenshare.write rpc.notifications.read`
(2026-09-11). So the commands exist for mute/deafen, volumes, devices,
push-to-talk, soundboard, camera (`TOGGLE_VIDEO`), screen share
(`TOGGLE_SCREENSHARE`), and join/leave (`SELECT_VOICE_CHANNEL`).

What Decky can see:

- **Who is in any voice channel, without joining:** `GET_CHANNEL` returns each
  person's user (id, names, avatar hash) and mute/deafen. All 237 channels
  across 22 servers took 213 ms. Subscribing to `VOICE_STATE_CREATE` for a
  channel you are not in is accepted.
- **Camera and screen-share status do not come through RPC.** A voice state
  holds only `mute, deaf, self_mute, self_deaf, suppress`. Windows records them
  instead:
  `HKCU\...\CapabilityAccessManager\ConsentStore\{webcam, graphicsCaptureProgrammatic, graphicsCaptureWithoutBorder}\NonPackaged\*Discord.exe*`,
  where `LastUsedTimeStop` is 0 while in use. Discord's Clips recording counts
  as screen capture too.

On this PC, standalone Node (25) is reset by `discord.com` and
`cdn.discordapp.com`, while Electron's Node and `net.fetch` reach both. Run
Discord network tests through Electron (`ELECTRON_RUN_AS_NODE=1`, output
redirected to a file, since Electron is a GUI program).

**Notifications are events only, never counts.** No RPC command reads unread or
mention counts or read state (the client's full command list, datamined
2026-09-11). `NOTIFICATION_CREATE` (needs `rpc` and `rpc.notifications.read`)
fires from Discord's NotificationStore on a new message that would notify - not
while Discord's window is focused, not while a game with Discord's overlay is in
front (the overlay shows it instead), but even with desktop notifications set to
never. One that came before the link is never sent. `GET_CHANNEL` gives a
channel's last messages, with no read state; DMs cannot be listed over RPC. Old
mentions would need Discord's REST API with the user's account token -
self-botting, against Discord's terms: never offer it. The taskbar button's UIA
help text ("0 notifications") is Windows' own toast count, not Discord's badge,
and Discord's window title carries no count.

**Just started, Discord lists no devices yet.** The RPC voice settings take the
device in use from saved settings but `available_devices` from the media engine,
which fills it a moment later; `VOICE_SETTINGS_UPDATE` is sent at once on
SUBSCRIBE and again on any change. Until then the list holds one stand-in with
the default device's id `"default"` ("No Input Devices"), so an unlisted list is
"only that", not "empty". Anything drawn from the list must wait for the real
one (the switchers stay out of reach until then), or it changes twice.

**Deafened is muted, but `mute` does not say so.** Discord's `isSelfMute()`
includes deafened; the RPC reports the stored `mute`. Mute shows `mute || deaf`,
and `SET_VOICE_SETTINGS {mute: false}` while deafened undeafens.

**discord.log** (`%APPDATA%/Decky`) records the link coming and going and the
devices: read it first when a Discord start misbehaves.

**Discord's refusal echoes the token.** `AUTHENTICATE` with a bad token errors
`4009 Invalid access token: <the token>`. A script must not print RPC error
messages from `AUTHENTICATE` raw. A new Authorize (Decky's) ends the token an
earlier one gave (the lab's was refused after Decky authorized, 2026-09-11).

**Why it matters:** a Discord integration can drive almost everything from RPC,
but its camera and screen-share keys must read their state from Windows.

Related: [[discord-rich-presence]], [[electron-run-as-node]].
