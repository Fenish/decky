---
name: app-self-update
type: project
---

An installed Decky updates itself: electron-updater reads `latest.yml` from the
newest GitHub release, downloads the installer, verifies its SHA-512 and runs it
silently; the installer relaunches Decky. The title bar's pill counts app and
firmware updates from the app's own GitHub check (15-minute interval) and opens
Settings → Updates; the update screen is
`features/updates/app-update-screen.tsx`, driven by `app-update:progress` events
from `src/main/updates/app-update.ts`.

- A release must carry `Decky-Setup-<v>.exe`, its `.blockmap` and `latest.yml`.
  The installer name is fixed by `build.nsis.artifactName`.
- Updates are differential. Every installer copies itself to
  `%LOCALAPPDATA%\decky-updater\installer.exe`. electron-updater compares the
  old release's blockmap (its URL is the new file's with the version swapped)
  with the new one, and fetches only the changed blocks. The result is checked
  against the SHA-512. A missing piece means a full download; nothing breaks.
  Measured between two local builds (0.2.0 → 0.2.1, app code changed): 3.2 MB
  instead of 101.4 MB, installer identical. The first differential update is
  from 0.2.4 onward: 0.2.3 and older have it disabled, and their releases carry
  no blockmap.
- `app-update.yml` inside the app comes from `build.publish` plus package.json's
  `repository`, so a fork updates from the fork.
- Development builds cannot install; they offer the browser download.
- While Decky updates, the deck shows an "Updating Decky" screen with a progress
  bar: the app sends `UPDATING <0-100>`, then `UPDATING END` on a failure or
  cancel. The firmware holds that screen for up to 3 minutes and suspends its
  host timeout meanwhile. The restart for the installer skips `BYE`, so the deck
  keeps the screen until the new version says `HELLO`.
- A slow update download was GitHub's CDN just after a release went up: curl and
  electron-updater were both slow at the same time.
- Verified against a local server with the real module: check, download and
  progress, SHA-512, cancel mid-download, "already up to date", unreachable.
  **Not yet seen on a real install:** the silent install and relaunch. The first
  test needs two releases that both contain the updater (v0.2.1 onward).

**Why:** the user wants desktop updates without a setup wizard, with progress in
the app. See [[decisions/2026-09-10-in-app-self-update]].

**How to apply:** keep `quitting = true` before `quitAndInstall`, or the
window's close-to-tray handler stops Decky from exiting for the installer. Keep
the installer, its blockmap and `latest.yml` in the release upload. Keep
electron-builder's default (differential-aware) NSIS compression: solid
compression would make every update a full download again.

Related: [[release-pipeline]].
