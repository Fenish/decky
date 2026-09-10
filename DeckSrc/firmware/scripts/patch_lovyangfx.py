from pathlib import Path
from shutil import copyfile
from SCons.Script import SetOption

Import("env")

SetOption("num_jobs", 4)

project_dir = Path(env.subst("$PROJECT_DIR"))
library_dir = Path(env.subst("$PROJECT_LIBDEPS_DIR")) / env.subst("$PIOENV") / "LovyanGFX"
driver_dir = library_dir / "src" / "lgfx" / "v1" / "platforms" / "esp32s3"
patch_dir = project_dir / "patches" / "LovyanGFX" / "esp32s3"

for filename in ("Bus_RGB.hpp", "Bus_RGB.cpp"):
    source = patch_dir / filename
    destination = driver_dir / filename
    if not source.is_file():
        raise RuntimeError(f"Missing LovyanGFX patch: {source}")
    if not destination.is_file():
        raise RuntimeError(f"LovyanGFX 1.2.25 driver not found: {destination}")
    if destination.read_bytes() != source.read_bytes():
        copyfile(source, destination)
