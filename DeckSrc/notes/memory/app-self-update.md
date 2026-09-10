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
from `src/main/app-update.ts`.

- A release must carry `Decky-Setup-<v>.exe` and `latest.yml`. There is no
  blockmap (the user wanted a short file list), so updates download the whole
  installer; `disableDifferentialDownload` stops the updater looking for one. The installer name is fixed by
  `build.nsis.artifactName`.
- `app-update.yml` inside the app comes from `build.publish` plus package.json's
  `repository`, so a fork updates from the fork.
- Development builds cannot install; they offer the browser download.
- Verified against a local server with the real module: check, download and
  progress, SHA-512, cancel mid-download, "already up to date", unreachable.
  **Not yet seen on a real install:** the silent install and relaunch. The first
  test needs two releases that both contain the updater (v0.2.1 onward).

**Why:** the user wants desktop updates without a setup wizard, with progress in
the app. See [[decisions/2026-09-10-in-app-self-update]].

**How to apply:** keep `quitting = true` before `quitAndInstall`, or the
window's close-to-tray handler stops Decky from exiting for the installer. Keep
the three update files in the release upload.

Related: [[release-pipeline]].
