# Apps (integrations), OBS first

## Decision

Third-party apps are **integrations**, one family. Each declares, in
`src/shared/integrations/<id>.ts`, its name, icon, settings fields and what
Settings says of each standing. Main has a service per app
(`src/main/integrations/<id>/`, `IntegrationService`), and each app's widgets
name it as their `group`. The window draws the picker's Apps pages, and each app's connection card, from these declarations. So a new app adds tables rows, not
screens.

- **Standings, the same for every app:** missing, closed, off (the app's API),
  denied (password or sign-in), ready.
- **Settings stay on this PC** (`%APPDATA%/Decky/integrations/<id>.json`), never
  in the profile. Secret fields are encrypted with `safeStorage`, and the window
  only hears whether one is saved.
- **Picker:** Actions → Apps → the app's keys, with Back at each step (the
  user's choice over Widgets → Apps → app, and over listing apps inside
  Widgets).

## OBS

- **What the user wanted:** only indicators of recording and streaming. Scenes
  and mutes they do with hotkeys; hotkeys cannot show state.
- **The link:** obs-websocket 5, built into OBS 28+ (`ws://host:4455`,
  `obswebsocket.json`). The password proof is base64(sha256(base64(sha256(
  password + salt)) + challenge)), checked against the protocol's worked
  example. Decky subscribes to Outputs events (1 << 6) and reads
  `GetRecordStatus` / `GetStreamStatus` on each change.
- **Widgets:** two types, `obs-record` and `obs-stream`, from one `obsKind`
  factory. They are one type per output rather than one type with an output
  field, so the picker lists each directly. The names are persisted in profiles;
  renaming them later is a `retire` migration.
- **Touch:** the user's design. The first touch counts down 5 s on the key; a
  second touch within them calls it off; then OBS starts, or stops what runs.
  The same countdown guards stopping, so a stray tap cannot end a stream.
- **Not found:** the installer's registry key, Steam's uninstall entry (app
  1905180), a Start Menu or App Paths `obs64.exe`, or a running `obs64.exe`. Any
  one counts.

## Alternatives

- **Toggle keys whose ON/OFF follows OBS, with the user's own artwork.**
  Rejected for now: a widget shows the elapsed time, and needs no new "state
  from outside Decky" concept for toggles.
- **OBS-only screens and IPC** (the first cut). The user asked to treat OBS as
  one member of a third-party family before more apps come.

## Critic

Skipped. The shape was the user's (the family, the picker path, the countdown).
What persists - widget type names, the settings file - is cheap to migrate
(`retire`, a file per app).

## Later

- The connection card moved from Settings → Apps to the app's own page
  (Actions → Apps → OBS Studio) and its keys' editor, at the user's word; an
  app's key's widget list offers only that app's widgets.
