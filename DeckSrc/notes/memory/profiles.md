---
name: profiles
description:
  Several setups, one in use, each a folder under profiles/; a .deckyprofile
  carries one whole; what travels is declared by each kind, never listed by hand
metadata:
  type: project
---

Decky keeps several profiles: `profiles.json` names them and which is in use,
and each is a folder under `profiles/<id>/` holding `profile.json`,
`widgets.json`, `integrations/` and `files/` (`main/profile/profiles.ts`). What
belongs to the deck rather than a setup - Wi-Fi pairing, update state, window
settings - stays beside them, so switching never unpairs anything. The single
`decky.json` an older Decky kept is copied into `profiles/default/` on first
start and left where it was.

- **Switching reloads what a profile owns**, in place: `Profile.path` moves,
  `WidgetStore.usePath` and each service's `usePath` re-read from the new
  folder, `PageSync.forget()` drops what the deck held, and the usual
  `persist()` brings the deck and window to it (`Workspace.useProfile`).
  Anything new that keeps a file per profile needs a `usePath` too - the
  `IntegrationService` interface requires one, so a new app cannot forget.
- **A `.deckyprofile` is the whole setup in one file**: header, then gzip, then
  AES-256-GCM with a key inside Decky (`main/profile/bundle.ts`). That is
  obfuscation, not secrecy - every Decky opens every file - and it is written as
  such in the code and the UI. Secrets never travel: `travellingValues` drops
  any field an integration declares `secret`, and they are typed again after an
  import.
- **What travels is declared where the thing is declared**, never in an export
  list: `ACTION_FILES` in `shared/config.ts` says which fields of an action are
  paths and whether the file itself is carried (a script is, a program is not),
  and `WIDGET_FILES` does the same for widgets. Both are mapped types over every
  kind, so **a new action or widget does not compile until it says**.
  Integrations are walked from `INTEGRATIONS`, so a new app is carried the day
  it exists.
- **Importing never overwrites**: it adds a profile, writes the carried files
  into that profile's `files/` under safe names, and rewrites its keys to point
  there (`placeFiles`). A widget this Decky has retired is dropped as the file
  is read and **counted for the inspector** rather than refusing the file.
- **Nothing is written before it is seen**: one report
  (`main/profile/report.ts`) serves both importing a file and switching to a
  stored profile - pages, keys, widgets (retired ones marked), the apps it is
  set up for, and every program and script a key would run. That last list is
  the point: a profile from someone else can point keys at executables.
- **Windows learns the file type from the installer** (`fileAssociations` in
  package.json, icon built by `scripts/build-icons.mjs` from
  `Branding/decky-profile.png`) - **and a packaged Decky puts it right on every
  start**: `registerProfileType` (`main/system/file-type.ts`) writes the four
  keys under `HKCU\Software\Classes` only when they do not already point at
  this exe. That covers an in-app update, a Decky that moved, and a copy run
  from elsewhere, none of which can be relied on to re-run the installer's
  registration. No administrator; nothing written when it is already right; a
  registry that refuses is not a reason not to start. The icon ships
  **unpacked** (`extraResources`), because Windows cannot read one inside the
  asar. A dev build registers nothing - it would point the type at
  electron.exe - so the open-with path is exercised there by passing a file as
  an argument. Windows may keep showing a cached icon until its icon cache
  refreshes; the association itself takes effect at once.
- A file double-clicked while Decky is closed waits in main until the window
  asks (`profiles:waiting`); one opened while it runs arrives on
  `profiles:offer`.

See [[integrations]], [[widgets]].
