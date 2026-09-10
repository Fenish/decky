"""Hand every successful firmware build to the desktop app.

PlatformIO runs this as a post-script. After firmware.bin is linked it copies
the four images the deck needs into desktop/resources/firmware/ and writes
manifest.json beside them. The desktop app installs exactly what the manifest
lists; electron-builder packs resources/ into the installer, so a release
carries the firmware it was built with.

The images stay separate on purpose. PlatformIO also produces a merged
firmware.factory.bin, but that runs contiguously from 0x0 through the NVS
partition, and writing it would erase the deck's Wi-Fi credentials and pairing
secret on every update.

Addresses come from PlatformIO's own upload settings (FLASH_EXTRA_IMAGES and
the application offset), so this cannot drift from what `pio run -t upload`
writes. Set DECKY_BUNDLE_DIR to send the bundle somewhere else, as CI does.
"""

import hashlib
import json
import os
import re
import shutil
from pathlib import Path

Import("env")  # noqa: F821 - provided by PlatformIO


def digest(path: Path, algorithm: str) -> str:
    return hashlib.new(algorithm, path.read_bytes()).hexdigest()


def protocol(project: Path) -> int:
    header = (project / "include" / "decky_version.h").read_text(encoding="utf-8")
    match = re.search(r"#define\s+DECKY_PROTOCOL\s+(\d+)", header)
    if not match:
        raise RuntimeError("DECKY_PROTOCOL is missing from include/decky_version.h")
    return int(match.group(1))


def bundle(source, target, env):  # noqa: ARG001 - SCons callback signature
    project = Path(env.subst("$PROJECT_DIR"))
    destination = Path(
        os.environ.get("DECKY_BUNDLE_DIR")
        or project.parent / "desktop" / "resources" / "firmware"
    )
    if not destination.parent.exists():
        print(f"Decky bundle skipped: {destination.parent} does not exist")
        return

    images = [
        (int(offset, 16), Path(env.subst(path)))
        for offset, path in env.get("FLASH_EXTRA_IMAGES", [])
    ]
    images.append(
        (
            int(env.subst(env.get("ESP32_APP_OFFSET", "0x10000")), 16),
            Path(env.subst("$BUILD_DIR/${PROGNAME}.bin")),
        )
    )
    images.sort()

    destination.mkdir(parents=True, exist_ok=True)
    parts = []
    for address, path in images:
        if not path.exists():
            raise RuntimeError(f"Decky bundle: {path} was not built")
        shutil.copyfile(path, destination / path.name)
        parts.append(
            {
                "file": path.name,
                "address": address,
                "size": path.stat().st_size,
                "sha256": digest(path, "sha256"),
                "md5": digest(path, "md5"),
            }
        )

    manifest = {
        "name": "decky",
        "version": env.get("DECKY_FW_VERSION_PLAIN", "dev"),
        "protocol": protocol(project),
        "chip": "esp32s3",
        "flashSize": "4MB",
        "parts": parts,
    }
    # Written last: a manifest that exists always describes a complete set of images.
    (destination / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Decky firmware {manifest['version']} (protocol {manifest['protocol']}) bundled to {destination}"
    )


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", bundle)  # noqa: F821
