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

# Into a header in the build folder rather than a compiler flag: a flag reaches
# every file, so each new commit or tag recompiled all ~200 of them. Only
# decky_version.h includes this, and it is rewritten only when the version
# changes, so a new version recompiles main.cpp and nothing else.
generated = os.path.join(env.subst("$BUILD_DIR"), "generated")  # noqa: F821
os.makedirs(generated, exist_ok=True)
header = os.path.join(generated, "decky_fw_version.h")
content = f'#pragma once\n#define DECKY_FW_VERSION "{version}"\n'
try:
    with open(header, encoding="utf-8") as file:
        current = file.read()
except OSError:
    current = ""
if current != content:
    with open(header, "w", encoding="utf-8") as file:
        file.write(content)
env.Append(CPPPATH=[generated])  # noqa: F821
env.Replace(DECKY_FW_VERSION_PLAIN=version)  # noqa: F821 - read by bundle_for_desktop.py
print(f"Decky firmware version: {version}")
