---
name: release-pipeline
type: project
---

Releases are automatic. Every push to `main` runs
`.github/workflows/release.yml`; `.github/scripts/plan_release.py` releases when
firmware or desktop source paths changed since the last `v*` tag, as one release
`v<x.y.z>` holding four files: the Windows installer
(`Decky-Setup-<version>.exe`), its `.blockmap` and `latest.yml` for the updater,
and the firmware as `decky-firmware-<firmware version>.zip`. Nobody tags by
hand.

- Release number: patch bump by default; `[minor]` / `[major]` in a commit's
  first line bump more; `[skip release]` there holds the push. Markers in a
  message body never count. Raising `DeckSrc/desktop/package.json` `version`
  sets the next number. The app is stamped with it.
- Firmware version: its own number, bumped only when firmware paths changed,
  marked by a `firmware-v<x.y.z>` tag the workflow adds. The app reads the
  firmware version from the newest release's `manifest.json`, never the tag.
- Dry run from the repo root: `python .github/scripts/plan_release.py`.
- Unchanged firmware is not rebuilt: the firmware job downloads
  `decky-firmware-<version>.zip` from the newest release carrying it, checks
  each image's SHA-256, and builds only if that fails. When it does build,
  `~/.platformio` and `.pio/libdeps` come from the Actions cache, keyed on
  platformio.ini and the exact Python version. Entries unused for 7 days are
  deleted, so the first firmware build after a quiet week starts cold.
- The desktop job ends with `scripts/package-check.mjs`; a built file missing
  from the package fails the release ([[packaging-drops-files]]).

**Why:** the user wants releases without tags, only for product-code changes,
and one release showing every build file. See
[[decisions/2026-09-10-automatic-releases]].

**How to apply:** product source changes pushed to `main` publish a public
release within minutes; use `[skip release]` for work-in-progress pushes. A
commit touching tools, scripts, tests or notes only never releases.
