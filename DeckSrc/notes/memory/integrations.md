---
name: integrations
description:
  Third-party apps Decky talks to (OBS first) - one family declared in
  shared/integrations, a service per app in main, widgets grouped by app; how to
  add one
metadata:
  type: project
---

**The family:** an app is declared once in `src/shared/integrations/<id>.ts`:
name, icon, settings fields (text, or secret), and for each standing (missing,
closed, off, denied, ready) a `brief`, the full `says`, and the card's button
(`buttons`: open, download or settings), plus its `download` page.
`INTEGRATIONS` names them all.

- **Main:** each app has a service (`src/main/integrations/<id>/`,
  `IntegrationService`: load, sync, status, check, save, open, stop) and a row
  in `IntegrationServices`. `WidgetReadings` syncs and stops them with pings and
  feeds.
- **Settings:** `integrations/settings-store.ts` keeps each app's settings in
  `%APPDATA%/Decky/integrations/<id>.json`, secrets encrypted, never in the
  profile.
- **Window:** the IPC is generic (`integration:status` / `integration:save` /
  `integration:open` / `integration:download` / `integration:status` events).
  The picker (Actions → Apps → app) is drawn from the declarations. Each app's
  page opens with its connection in one line (a brief standing from `brief`, and
  the standing's button: Open OBS while closed, Get OBS while missing, else
  Connect… or Edit opening a dialog with its fields and the full `says`), then a
  rule, then its keys; the same line is in its keys' editor. The user wanted it
  there, not in Settings, and the Apps rows as bare names.

**OBS:** obs-websocket 5 (OBS 28+, default `localhost:4455`). Widgets
`obs-record` and `obs-stream` come from `obsKind`, `group: "obs"`.

- A touch counts down 5 s before start or stop; a second touch calls it off.
- **Follow OBS's events, never re-asked statuses:** obs-websocket answers
  requests on a pool of threads, so answers can come back out of order. A status
  asked for during a stop once kept the Recording key running. Keys follow the
  events' `outputState` in order (`STATES` in `obs-service.ts`); the status is
  read only as the link opens.
- The link is kept while any OBS key exists, from Decky's start
  ([[boot-loads-everything]]). It retries every 3 s while OBS is closed or its
  server is off, every 15 s while OBS is not installed, and waits for new
  settings after a refused password.
- On the user's PC OBS is installed (registry `HKLM\SOFTWARE\OBS Studio`,
  default value the install folder; `bin\64bit\obs64.exe` under it).
  `ObsFinder.launch` starts it from that folder; never start OBS from a
  session - the user starts apps.

**How to apply:** a new app follows the README's "A new app needs" paragraph. It
is a new id, its declaration, its service folder and a row in each table; its
screens follow. Keep per-app specifics in tables inside its own module
([[generic-over-copies]]). Its widgets go through the widget registries as usual
([[widgets]]).

**Discord (2026-09-11):** the second app. Its keys:

- **Mute, Deafen, Camera, Screen share, Noise suppression, Echo cancellation,
  Auto gain, Leave call** are app controls: the Action
  `{ kind: "app", app, control }`, declared in the app's `controls`. A toggle
  key's ON and OFF follow the app (`AppControls`, `KeyStateStore.follow`), and a
  press never flips it. The user wanted toggles so they can draw their own ON
  and OFF - Leave call too (red while in a call). The window never says ON and
  OFF for them: each control declares its `states` words (Unmuted/Muted, Not in
  a call/In a call), used by the editor's look switch and the key's corner
  (`stateNames`). The user asked for that.
- **Out of reach, every key of the app looks disabled** - widgets and control
  keys alike: grey icon, the one slash (`strike` in canvas-kit), grey label.
  Control keys get it in their page pictures (`renderKey`'s `disabled`, from the
  window's `useAppsDown`). The user asked for it for all of them; a new app's
  keys should follow it too.
- **Never change toggle ON pictures with runtime state.** The deck takes ON
  pictures (`ALT`) only whole (29 KB), reloading one from its card only by the
  same checksum. Changing them on Discord's reach froze the deck for seconds
  each time (2026-09-12). The disabled look is on the OFF picture only; an app
  out of reach reports no control state, so its toggles show OFF.
- Noise suppression is Discord's **Standard** mode: the RPC's
  `SET_VOICE_SETTINGS` has only a `noise_suppression` boolean
  (`setNoiseSuppression`; Discord's own client code, datamined). Krisp
  (`noiseCancellation` in its settings) cannot be set over RPC; the user
  accepted that.
- **Widgets** (`discord-*`, `group: "discord"`): Voice channel, Current call,
  Mic and Output switchers, Notifications. The voice keys show avatars only,
  past four "+n", green while you are in it, speaking rings in your own call.
  **Use current** fills the channel ID (`integration:call`, "currentChannel").
  Every Discord widget draws the key's own library icon (in the key's colour, at
  its Icon size) when it has nothing else to show - the user asked for that and
  for per-key design choices (layout, name on/off) in the Appearance tab
  (`WidgetView.appearance`, `icon: true`).

It reaches Discord's RPC as **StreamKit** (`207646673902501888`; see
[[discord-mute-state]], [[discord-rpc-control]]). This is unofficial: Discord
shows "Discord StreamKit Overlay". The token lasts 7 days, has no refresh, and
is kept encrypted in `integrations/discord.json`.

- Camera and share state come from Windows (the helper's `capture`), which
  Discord's RPC does not report.
- Starting a screen share opens Discord's picker, so Discord is brought to the
  front by starting it again through its `Update.exe`, which leaves its view as
  it was. Never use a bare `discord://` for that: it navigates to Home (the user
  saw /@me open). `discord://-/channels/<guild|@me>/<channel>` is right only
  where going there is wanted (a notification's conversation).
- A token's scopes come back in `AUTHENTICATE`. One given before a scope was
  asked for (notifications) keeps working; only the key needing it waits for
  Authorize again.
- The Windows helper is shared: whoever needs it calls `hold(who, needed)`.
