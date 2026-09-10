#pragma once

// The protocol spoken over USB and Wi-Fi. Raise it whenever the desktop has to
// change with the firmware; the desktop reads it from the ID reply and the
// firmware bundle script reads it from here, so this line is the only copy.
#define DECKY_PROTOCOL 7

// Written by scripts/firmware_version.py into the build folder, from the
// release tag or `git describe`. A build outside that script is a development
// build and says so.
#if __has_include("decky_fw_version.h")
#include "decky_fw_version.h"
#endif
#ifndef DECKY_FW_VERSION
#define DECKY_FW_VERSION "dev"
#endif
