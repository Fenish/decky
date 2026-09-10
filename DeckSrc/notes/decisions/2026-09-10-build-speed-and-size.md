---
date: 2026-09-10
status: accepted
---

# Faster releases and a smaller installer, without lossy shortcuts

**Context:** the user asked for a smaller bundle and faster builds. Measured
first: a release took about 7 minutes, 4 of them the firmware job, and 2.5 of
those were PlatformIO downloading and unpacking its platform, framework and
libraries on a fresh runner. Every new version recompiled all 194 firmware
files, because the version was a compiler flag. The installer was 110.9 MiB, of
which the app's own files are about 5 MiB; the rest is Electron. The measuring
also found that the installed app had no 3D model: electron-builder's default
ignore list drops `*.obj`.

**Choice:**

- The firmware version moves from a compiler flag to a generated header that
  only `main.cpp` includes. A new version rebuilds 1 file in 17 s instead of 194
  in 58 s.
- A release whose firmware did not change downloads the zip already released
  under that version and checks every image's SHA-256, instead of rebuilding. If
  anything fails, it builds.
- When the firmware is built, `~/.platformio` and the libraries are cached. The
  key is platformio.ini plus the exact Python version, because PlatformIO's venv
  is tied to it. The download archives are left out of the cache.
- The installer ships only the `en-US` Chromium locale and only the win32-x64
  serial binding. It leaves out source maps, serialport's C++ sources and
  node-addon-api. esptool-js becomes a devDependency: Vite already bundles it,
  so its `node_modules` copy, with pako, was dead weight.
- The model ships as a GLB, converted by `scripts/convert-model.mjs`. It keeps
  the OBJ's float32 vertices bit for bit and is 1.37 MB instead of 6.3. The
  render is byte-identical to the OBJ's.
- The two backgrounds become lossless WebP: pixel-exact and about 42% smaller.
- `scripts/package-check.mjs` fails the release if any built file is missing
  from `app.asar`.

**Measured:**

|                        | Before   | After                        |
| ---------------------- | -------- | ---------------------------- |
| Installer              | 116.2 MB | 106.3 MB, now with the model |
| Unpacked               | 383 MB   | 330 MB                       |
| `app.asar`             | 13.4 MB  | 10.1 MB                      |
| Local electron-builder | 31 s     | 23 s                         |

The CI savings are estimates until the next releases run: about 4 minutes on a
release without firmware changes, and about 2 when the firmware changes.

**Rejected:**

- _Solid 7z compression (`differentialPackage: false`)._ −9.7 MiB, but
  compression went from 10 s to 63 s here, and CI runs about 4× slower. A 16 MB
  dictionary would be the middle ground (−7.4 MiB, 22 s), but electron-builder
  does not expose it. The two goals conflicted, and speed won.
- _Lossy WebP for the backgrounds._ 70% of neighbouring pixels differ by
  dither-sized steps. The backgrounds are dithered on purpose, and q85 moved
  some pixels by 55 levels.
- _Deleting `dxcompiler.dll` / `dxil.dll`._ −6.6 MiB. WebGL does not use them,
  but it was not tested on other GPUs, and a broken first screen costs more than
  6 MiB.
- _A compiled-object cache in CI (`build_cache_dir`)._ About 45 s more per
  firmware release. Builds are not byte-reproducible (the ELF hash in the app
  descriptor changes every build), so a stale object could not be ruled out by
  comparing outputs.
- _Raising the firmware build's job count._ `-j 12` built in the same 60 s as
  Elecrow's cap of 4. The local time is not CPU-bound.
- _Caching Electron's downloads on Windows._ The CI log shows them taking under
  a second.

**Accepted afterwards:** differential updates. The user agreed to a fourth
release file if downloads got faster. The `.blockmap` is now uploaded, and an
app-only update measured 3.2 MB instead of 101.4 MB. This is also why solid
compression stays off: it would defeat the blockmap. The original note read:
uploading the `.blockmap` as a fourth release file would let updates download
only the changed parts. The user chose the short file list before this was
measured.

See [[release-pipeline]], [[packaging-drops-files]].
