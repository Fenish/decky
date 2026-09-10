---
date: 2026-09-10
status: accepted
---

# One automatic release per product change, firmware versioned separately

**Context:** releases were tag-driven: `firmware-v*` published firmware files,
`desktop-v*` published the installer. The user found two kinds of release
confusing, wanted one release showing every build file, and wanted no manual
tags: a change to firmware or desktop sources should release by itself, while
tools and other files should not.

**Choice:** `.github/workflows/release.yml` runs on every push to `main`.
`.github/scripts/plan_release.py` decides: a release happens when product code
(firmware `src`, `include`, `lib`, `patches`, `scripts`, `platformio.ini`,
partition table, board file; desktop `src`, `resources`, `package.json`,
lockfile, build config) changed since the last `v*` tag. One release `v<x.y.z>`
carries the Windows installer and the firmware files. The release number bumps
the patch by default; `[minor]` / `[major]` in a commit's first line bump more,
`[skip release]` holds a push back, and raising `package.json`'s version sets
the number. The firmware keeps its own version, bumped only when firmware code
changed and marked by a `firmware-v*` tag; the app reads it from the newest
release's `manifest.json`.

**Why:** the user's words: "if src changes create release", "fully auto", and
seeing all build files in one release. A separate firmware version keeps a
desktop-only release from asking anyone to reflash.

**Rejected:**

- _Separate automatic tracks_ (`firmware-v*` and `v*` releases). Cleaner version
  histories, but two kinds of release, which the user did not want.
- _Release Please or semantic-release._ Release Please needs a release pull
  request merged by hand; both need conventional commit messages.
- _Firmware version equal to the release number._ Every app-only release would
  offer a pointless deck reflash.

**Known cost:** a firmware-only change still produces a new app version, because
the installer carries the new firmware. Any edit under a firmware source path,
comments included, raises the firmware version.

See [[release-pipeline]].
