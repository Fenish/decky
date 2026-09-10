"""Stamp the firmware with its version before it compiles.

PlatformIO runs this as a pre-script. The version comes from, in order:

1. the DECKY_FW_VERSION environment variable, which the release workflow sets
   to the firmware version it is releasing;
2. `git describe` against the newest `firmware-v*` tag - the release workflow
   adds one whenever the firmware version rises - so a local build after a
   release reads like "1.4.0-3-gabc1234-dirty";
3. "dev", when there is no tag or no git at all.

The desktop app only treats plain release numbers as updates, so local builds
never prompt anyone to "update" to an older release.
"""

import os
import re
import subprocess

Import("env")  # noqa: F821 - provided by PlatformIO


def describe() -> str:
    explicit = os.environ.get("DECKY_FW_VERSION", "").strip()
    if explicit:
        return explicit.removeprefix("firmware-v").removeprefix("v")
    try:
        described = subprocess.run(
            ["git", "describe", "--tags", "--match", "firmware-v*", "--dirty"],
            cwd=env.subst("$PROJECT_DIR"),  # noqa: F821
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return "dev"
    if described.returncode != 0:
        return "dev"
    return described.stdout.strip().removeprefix("firmware-v")


version = describe()
if not re.fullmatch(r"[\w.+-]{1,48}", version):
    version = "dev"

env.Append(CPPDEFINES=[("DECKY_FW_VERSION", env.StringifyMacro(version))])  # noqa: F821
env.Replace(DECKY_FW_VERSION_PLAIN=version)  # noqa: F821 - read by bundle_for_desktop.py
print(f"Decky firmware version: {version}")
