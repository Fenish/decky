---
date: 2026-09-10
status: accepted
---

# Decky updates itself with electron-updater, shown on its own screen

**Context:** firmware already updated from inside the app; the desktop app did
not update at all. The user asked for a title-bar pill counting desktop and
firmware updates, background checks, and a desktop update that needs no setup
wizard, with progress on a screen of its own.

**Choice:** electron-updater's GitHub provider with the NSIS target. The build
config names `publish: github`, so electron-builder writes `app-update.yml` into
the app (owner and repo from package.json's `repository`) and `latest.yml` next
to the installer; the release workflow uploads it. No blockmap: the user wanted
the release page to list only the installer, `latest.yml` and the firmware zip,
so updates download the whole installer. The update is started by the user,
never downloaded behind their back: `src/main/app-update.ts` checks, downloads
with progress (cancellable), lets electron-updater verify the SHA-512, then runs
the installer silently with "run after", having lifted the close-to-tray
behaviour. The pill and the Updates section use the app's own GitHub API check,
every 15 minutes, which also finds the firmware.

**Why:** the user's words - "auto update without using the setup", "show update
progress in app ... new screen". electron-updater already handles checksums,
partial downloads, elevation for per-machine installs, and waiting for the app
to exit.

**Rejected:**

- _A hand-written downloader running the installer with `/S`._ Would repeat
  electron-updater's checksum, blockmap and elevation handling.
- _Downloading automatically in the background._ The user wants to see the
  update happen and choose when.

**Known limits:** releases up to v0.2.0 have no updater, so an installed 0.2.0
needs the next installer once by hand. Builds are unsigned: no publisher check,
and SmartScreen can warn on a first install. The silent install and relaunch
were not run on a real install before shipping; the check, download, progress,
cancel and error paths were, against a local server.

**Superseded in part (later the same day):** releases now carry the blockmap and
updates are differential. Once the measurements showed an app-only update needs
about 3 MB of the 101 MB installer, the user preferred faster downloads to a
three-file release. See [[2026-09-10-build-speed-and-size]].

See [[app-self-update]], [[release-pipeline]].
