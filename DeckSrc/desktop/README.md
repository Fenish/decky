# Decky desktop

The Windows app for Decky: it draws the keys, sends them to the deck over USB or Wi-Fi, and runs
what a press asks for. This file is how to install, run, build and package it. What it does and why
it does it that way is in [`../notes/`](../notes/).

## Requirements

- Windows 10 or 11
- Node 22.16 or newer, and pnpm 10 (`corepack enable` gives you the pinned one)
- Google Chrome, for the UI and visual checks only
- PlatformIO, only if you also want the firmware bundled into the installer

## Install and run

From `DeckSrc/desktop`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`dev` and `preview` first run `scripts/ensure-electron.mjs`, which installs the Electron executable
when it is missing. Without it, Electron 44's on-demand installation conflicts with electron-vite
5's direct `path.txt` lookup and fails with `Error: Electron uninstall`.

Closing the window keeps Decky in the tray so its keys go on working; quit from the tray menu.

## Checks

Each exits on its own, so they can be chained in CI:

```powershell
pnpm typecheck     # both TypeScript projects
pnpm lint          # ESLint, Prettier included
pnpm test          # unit tests (vitest)
pnpm test:ui       # builds, then drives the built app in headless Chrome
pnpm test:visual   # the UI checks plus the disconnected screen
pnpm test:connection
```

The browser checks need Chrome installed. They route the built files straight to the page, with no
server and no Electron launch. Screenshots and other artifacts land in `output/`.

## Package

```powershell
pnpm package   # dist/win-unpacked/Decky.exe
pnpm dist      # NSIS installer
```

Both run `scripts/package-check.mjs`, which fails the build if a file that should be in the package
is missing. Builds are not code-signed; signing needs a publisher certificate.

To bundle firmware with the installer, build it first: `pio run -d ../firmware` copies the images
and `manifest.json` into `resources/firmware/`, which is gitignored and packed into the installer.
Without them the app still builds, and installs firmware it downloads from GitHub instead.

## Assets

Both scripts write files that are committed, so run them only when the source art changes:

```powershell
node scripts/build-icons.mjs     # resources/icon.png and icon.ico from Branding/logo-app.png
node scripts/convert-model.mjs   # public/models/decky.glb from the OBJ
```

## Where Decky keeps things

In `%APPDATA%/Decky`: `decky.json` (the profile), `widgets.json` (counters, timers),
`presence.json`, `wifi-pair.json`, `integrations/*.json`, and the logs `deck.log` and `discord.log`.

## Releases

A push to `main` that changes desktop or firmware sources builds and publishes both as one release
(`.github/workflows/release.yml`). The version counts up by itself: the patch number by default,
`[minor]` or `[major]` in the first line of a commit for a bigger step, `[skip release]` to hold a
push back. Setting `version` in `package.json` fixes the next number.
