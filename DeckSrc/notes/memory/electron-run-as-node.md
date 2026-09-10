---
name: electron-run-as-node
type: reference
---

Shells started by the VS Code extension here carry `ELECTRON_RUN_AS_NODE=1`. Any
Electron binary started from them - `node_modules/electron`, or the packaged
`dist/win-unpacked/Decky.exe` - runs as plain Node. It rejects Chromium switches
with "bad option", and Playwright's `_electron.launch` reports "Process failed
to launch!".

**How to apply:** remove the variable for the launch. With Playwright:
`const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;` and pass
`env`. From a shell: `env -u ELECTRON_RUN_AS_NODE`. A packaged Decky honours
`--user-data-dir=<folder>`, which keeps a test run away from the user's real
settings.

Related: [[packaging-drops-files]].
