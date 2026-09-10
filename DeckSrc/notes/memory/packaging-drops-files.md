---
name: packaging-drops-files
type: project
---

electron-builder silently leaves files out of the installed app by extension:
its default ignore list includes `obj`, `o`, `a`, `mk`, `cc`, `d.ts`, `pdb` and
more (`excludedExts` in app-builder-lib's `fileMatcher`). `build.files` cannot
bring them back. `disableDefaultIgnoredFiles` can, but it drops every other
default ignore with it.

This is how the installed Decky lost its 3D model. The dev build and the UI
checks served `out/` directly and never noticed. The model is now a GLB, and
`scripts/package-check.mjs` compares `out/` and `resources/` with the packed
`app.asar`. It runs after `pnpm dist`, `pnpm package` and in the release
workflow, where a missing file fails the release.

**Why:** nothing tested the packaged app. The failure was silent: the
Disconnected page fell back to a still image after its 6 s deadline.

**How to apply:** give assets extensions outside that list, and keep the package
check in the build. When checking the packaged app itself, launch
`dist/win-unpacked/Decky.exe` with Playwright's `_electron` and a separate
`--user-data-dir` (see [[electron-run-as-node]]).

Related: [[release-pipeline]], [[decisions/2026-09-10-build-speed-and-size]].
