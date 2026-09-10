---
name: release-pipeline
type: project
---

Releases are automatic. Every push to `main` runs
`.github/workflows/release.yml`; `.github/scripts/plan_release.py` releases when
firmware or desktop source paths changed since the last `v*` tag, as one release
`v<x.y.z>` holding the Windows installer (`Decky-Setup-<version>.exe`) and the
firmware files. Nobody tags by hand.

- Release number: patch bump by default; `[minor]` / `[major]` in a commit's
  first line bump more; `[skip release]` there holds the push. Markers in a
  message body never count. Raising `DeckSrc/desktop/package.json` `version`
  sets the next number. The app is stamped with it.
- Firmware version: its own number, bumped only when firmware paths changed,
  marked by a `firmware-v<x.y.z>` tag the workflow adds. The app reads the
  firmware version from the newest release's `manifest.json`, never the tag.
- Dry run from the repo root: `python .github/scripts/plan_release.py`.

**Why:** the user wants releases without tags, only for product-code changes,
and one release showing every build file. See
[[decisions/2026-09-10-automatic-releases]].

**How to apply:** product source changes pushed to `main` publish a public
release within minutes; use `[skip release]` for work-in-progress pushes. A
commit touching tools, scripts, tests or notes only never releases.
