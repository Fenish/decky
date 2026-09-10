"""Read one cell's pixels back off the panel and save them as a PNG.

Reads the frame buffer the panel is actually scanning, so the result is what is
on the glass rather than what the firmware believes it drew. Use it when an
artefact is easier to measure than to describe.

    python tools/dump_cell.py 0
    python tools/dump_cell.py 0 --port COM4 --out scratch/cell0.png
"""

from __future__ import annotations

import sys as _sys, pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))

import argparse
import pathlib
import sys
import time

import deck_link
from PIL import Image


def rgb565_to_rgb(value: int) -> tuple[int, int, int]:
    """Expand one little-endian RGB565 pixel to 8 bits per channel."""
    r = (value >> 11) & 0x1F
    g = (value >> 5) & 0x3F
    b = value & 0x1F
    # Replicate the high bits into the low ones so full-scale stays full-scale.
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def read_until(port: serial.Serial, marker: bytes, limit: float) -> bytes:
    """Read until a marker appears or the deadline passes."""
    buffer = bytearray()
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        chunk = port.read(4096)
        if chunk:
            buffer += chunk
            if marker in buffer:
                return bytes(buffer)
    return bytes(buffer)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell", type=int, help="cell index, 0-14")
    parser.add_argument("--port", default=None,
                        help="serial port; found automatically if omitted")
    parser.add_argument("--baud", type=int, default=460800)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    out = pathlib.Path(args.out) if args.out else pathlib.Path(f"cell{args.cell}.png")
    out.parent.mkdir(parents=True, exist_ok=True)

    with deck_link.open_port(deck_link.resolve_port(args.port), args.baud, timeout=0.4) as port:
        # Do not touch DTR/RTS: that resets the board, and the artefact being
        # investigated may not survive a restart.
        port.reset_input_buffer()
        port.write(f"DUMP {args.cell}\n".encode())
        port.flush()

        blob = read_until(port, b"DUMPEND", limit=25.0)

    start = blob.find(b"DUMPBEGIN ")
    if start < 0:
        print("no DUMPBEGIN in reply; is the firmware running?", file=sys.stderr)
        return 1

    header_end = blob.index(b"\n", start)
    header = blob[start:header_end].decode(errors="replace").split()
    _, index, x, width, height = header[0], *header[1:5]
    width, height = int(width), int(height)

    payload = blob[header_end + 1 :]
    needed = width * height * 2
    if len(payload) < needed:
        print(f"short read: {len(payload)} of {needed} bytes", file=sys.stderr)
        return 1
    payload = payload[:needed]

    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for row in range(height):
        base = row * width * 2
        for column in range(width):
            offset = base + column * 2
            value = payload[offset] | (payload[offset + 1] << 8)
            pixels[column, row] = rgb565_to_rgb(value)

    image.save(out)

    colours = image.getcolors(maxcolors=1 << 20) or []
    colours.sort(reverse=True)
    print(f"cell {index} at x={x}, {width}x{height} -> {out}")
    print(f"distinct colours: {len(colours)}")
    for count, colour in colours[:8]:
        print(f"  {colour}  {count:6d} px  ({100 * count / (width * height):.1f}%)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
