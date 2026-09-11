"""Send one command to the deck and print what it says back.

    python tools/cmd.py SDINFO
    python tools/cmd.py DISPLAY_STATE
"""

from __future__ import annotations

import sys as _sys, pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))

import sys
import time

import deck_link


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    command = " ".join(sys.argv[1:])
    port = deck_link.open_port(deck_link.resolve_port(None))

    try:
        port.reset_input_buffer()
        port.write((command + "\n").encode())
        port.flush()

        deadline = time.time() + 180
        while time.time() < deadline:
            line = port.readline().decode(errors="replace").strip()
            if line.startswith(("OK", "ERR")):
                print(line)
                return 0 if line.startswith("OK") else 1
        print("ERR no reply")
        return 1
    finally:
        port.close()


if __name__ == "__main__":
    raise SystemExit(main())
