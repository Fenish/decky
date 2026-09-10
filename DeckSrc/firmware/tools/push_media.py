"""Put an image or an animation on one key of the deck, without reflashing.

Accepts anything Pillow can open - PNG, JPEG, GIF, WebP - and converts it to the
one format the firmware plays: a full-frame GIF. A still image becomes a
single-frame GIF, so pictures and animations travel the same path and are
decoded by the same code on the board. A second format would mean a second set
of bugs, and this decoder has already produced three.

Two conversions are not optional:

  * Full frames (`disposal=2`). The decoder on the board renders
    difference-encoded frames incorrectly - it invents colours that are not in
    the file, and because partial frames only touch part of the canvas, the
    damage never clears. Measured, not assumed; see
    notes/memory/gif-encoding-for-the-panel.md.
  * Fitting the key opening. Anything larger is rejected by the firmware.

    python tools/push_media.py 1 photo.png
    python tools/push_media.py 3 clip.gif --fps 12
    python tools/push_media.py 3 clip.gif --max-frames 60
"""

from __future__ import annotations

# Run from anywhere: the shared helper sits beside this file.
import sys as _sys, pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))

import argparse
import io
import os
import sys
import pathlib
import sys
import time
import zlib

from PIL import Image, ImageSequence

import deck_link

# The key openings. Frames must fit inside one; the firmware refuses anything
# larger rather than drawing over its neighbours.
CELL_WIDTH = 118
CELL_HEIGHT = 123
CELLS = 15
COLUMNS = 5


def describe(cell_one_based: int) -> str:
    """Name a key the way it sits on the deck."""
    index = cell_one_based - 1
    return f"key {cell_one_based} (row {index // COLUMNS + 1}, column {index % COLUMNS + 1})"


def build_pack(
    path: pathlib.Path,
    fps: float | None,
    max_frames: int | None,
    colours: int,
    size: int | None,
) -> tuple[bytes, int, int, int]:
    """Decode an image or animation into frames the deck can blit directly.

    Every pixel decision is made here rather than on the board: cropping,
    aspect, scaling and the palette. The deck receives finished frames and does
    nothing but copy them through a lookup table - no decoder runs on it at all,
    which is both faster and avoids the GIF decoder that has produced every
    rendering bug on this panel.
    """
    with Image.open(path) as source:
        source_delay = source.info.get("duration", 0) or 0

        captured = []
        for frame in ImageSequence.Iterator(source):
            rgb = frame.convert("RGB")

            captured.append(rgb)

    if not captured:
        raise ValueError("no frames in file")

    if max_frames is not None and len(captured) > max_frames:
        # Dropping frames shortens nothing - the animation still plays end to
        # end - but it does coarsen the motion, so say so rather than doing it
        # silently. Timing is preserved by stretching each remaining frame.
        print(f"  thinning {len(captured)} frames to {max_frames}; motion will be coarser")
        step = len(captured) / max_frames
        kept = [captured[int(i * step)] for i in range(max_frames)]
        captured = kept


    # Fill the key completely: crop to the opening's own proportions, then scale
    # to its exact size. Fitting inside it instead leaves a border of dead panel
    # around every picture, and stretching to it distorts them.
    #
    # Size is still a real trade rather than a detail: frames cost
    # width*height bytes each and all fifteen keys share about 6 MB of PSRAM, so
    # a smaller frame buys more of them - and more frames is what makes motion
    # look smooth. `size` scales the whole key down, keeping its shape.
    if size:
        scale = min(size / CELL_WIDTH, 1.0)
        target = (max(1, round(CELL_WIDTH * scale)), max(1, round(CELL_HEIGHT * scale)))
    else:
        target = (CELL_WIDTH, CELL_HEIGHT)

    ratio = target[0] / target[1]
    cropped = []
    for frame in captured:
        width, height = frame.size
        if width / height > ratio:
            keep = round(height * ratio)
            left = (width - keep) // 2
            frame = frame.crop((left, 0, left + keep, height))
        else:
            keep = round(width / ratio)
            top = (height - keep) // 2
            frame = frame.crop((0, top, width, top + keep))
        cropped.append(frame)
    captured = cropped

    delay = int(round(1000.0 / fps)) if fps else int(source_delay) or 66

    width, height = target
    out = bytearray()
    out += b"DECK"
    out += bytes([1, 0])
    out += width.to_bytes(2, "little")
    out += height.to_bytes(2, "little")
    out += len(captured).to_bytes(2, "little")
    out += bytes(4)  # reserved

    for frame in captured:
        if frame.size != target:
            frame = frame.resize(target, Image.LANCZOS)

        # A palette per frame: 512 bytes each, about 5% on top, and it keeps the
        # colour of footage that shifts as it plays.
        indexed = frame.convert("P", palette=Image.ADAPTIVE, colors=colours)
        table = indexed.getpalette() or []

        out += delay.to_bytes(2, "little")
        for entry in range(256):
            r, g, b = table[entry * 3 : entry * 3 + 3] or (0, 0, 0)
            rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
            out += rgb565.to_bytes(2, "little")

        out += indexed.tobytes()

    return bytes(out), width, height, len(captured)


def push(
    port_name: str, baud: int, cell_zero_based: int, blob: bytes, progress: bool = True
) -> str:
    """Send one payload and return the board's final reply."""
    crc = zlib.crc32(blob) & 0xFFFFFFFF

    with deck_link.open_port(port_name, baud, timeout=1.0) as port:
        port.reset_input_buffer()

        # Retry the handshake: a board still booting - after a flash, or after
        # someone opened a terminal on it - misses the first command entirely.
        ready = False
        for attempt in range(3):
            port.reset_input_buffer()
            port.write(f"PUSH {cell_zero_based} {len(blob)} {crc}\n".encode())
            port.flush()

            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                line = port.readline().decode(errors="replace").strip()
                if line == "READY":
                    ready = True
                    break
                if line.startswith("ERR"):
                    return line
            if ready:
                break

        if not ready:
            return "ERR no READY from board"

        # 128 bytes, because that is the size of the chip's hardware receive
        # FIFO. Measured, not guessed: 128-byte blocks arrive intact, 256-byte
        # blocks lose bytes, and streaming without acknowledgements loses a
        # hundred-odd near the end.
        block = 128
        sent = 0
        while sent < len(blob):
            chunk = blob[sent : sent + block]
            port.write(chunk)
            port.flush()
            sent += len(chunk)

            deadline = time.monotonic() + 5.0
            acked = False
            while time.monotonic() < deadline:
                line = port.readline().decode(errors="replace").strip()
                if line == "A":
                    acked = True
                    break
                if line.startswith("ERR"):
                    return line
            if not acked:
                return f"ERR no ack after {sent} of {len(blob)} bytes"

            if progress and sent % (block * 64) == 0:
                print(f"  {sent * 100 // len(blob)}%", end="\r", flush=True)

        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            line = port.readline().decode(errors="replace").strip()
            if line.startswith(("OK", "ERR")):
                return line

    return "ERR no reply after upload"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("cell", type=int, help=f"which key, 1 to {CELLS}")
    parser.add_argument("file", type=pathlib.Path)
    parser.add_argument(
        "--port", default=None, help="serial port; found automatically if omitted"
    )
    parser.add_argument("--baud", type=int, default=deck_link.BAUD)
    parser.add_argument(
        "--fps",
        type=float,
        default=None,
        help="override playback rate; the board sustains about 15",
    )
    parser.add_argument(
        "--max-frames", type=int, default=None, help="thin long animations to this many frames"
    )
    parser.add_argument("--colours", type=int, default=256, help="palette size per frame")
    parser.add_argument(
        "--size",
        type=int,
        default=None,
        help="scale the key down to this width; smaller leaves room for more frames",
    )
    parser.add_argument(
        "--save", type=pathlib.Path, default=None, help="also write the pack here"
    )
    args = parser.parse_args()

    if not 1 <= args.cell <= CELLS:
        print(f"cell must be 1..{CELLS}", file=sys.stderr)
        return 1
    if not args.file.is_file():
        print(f"no such file: {args.file}", file=sys.stderr)
        return 1

    blob, width, height, frames = build_pack(
        args.file, args.fps, args.max_frames, args.colours, args.size
    )

    if args.save:
        args.save.write_bytes(blob)

    kind = "still image" if frames == 1 else f"{frames} frame animation"
    print(
        f"{args.file.name}: {kind}, {width}x{height}, "
        f"{len(blob) / 1024:.1f} KB -> {describe(args.cell)}"
    )

    reply = push(deck_link.resolve_port(args.port), args.baud, args.cell - 1, blob)
    print(reply)
    return 0 if reply.startswith("OK") else 1


if __name__ == "__main__":
    raise SystemExit(main())
