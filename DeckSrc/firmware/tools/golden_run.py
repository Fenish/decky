"""The firmware's golden run: every command the desktop uses, in a fixed order,
with every reply kept and the screen captured at still moments. A change that
should not alter what the deck does - a restructure, a refactor - must leave
every reply and every pixel as it was.

    python tools/golden_run.py record     the build before the change: keep its run
    python tools/golden_run.py check      the build after: run again and compare

Runs go to tools/golden/runs/ (not kept in git). The deck is restarted first, so
nothing a previous run left in memory changes the replies; the app must be
closed, as for flashing. A run takes about a minute, most of it the two
SCREEN captures (768 KB each over USB).

The looks and the Now playing key in tools/golden/ are the desktop app's own
output (src/renderer/src/features/widgets/wheel.ts and artwork.ts), fixed so
runs compare. When a look's format changes, the old build cannot read new
fixtures, so that change is checked by eye; then make new fixtures from the
app and record again.
"""

from __future__ import annotations

import pathlib as _pathlib
import sys as _sys

_sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parent))

import json
import random
import re
import sys
import time
import zlib
from pathlib import Path

import deck_link
from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent / "golden"
W, H = 118, 123
KEY = W * H * 2
PAGE = 50
TILE = 32


# ---- key pictures, the same every run ----
def rgb565(r: int, g: int, b: int) -> int:
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def picture(fn) -> bytes:
    out = bytearray(KEY)
    for y in range(H):
        for x in range(W):
            c = fn(x, y)
            out[(y * W + x) * 2] = c & 255
            out[(y * W + x) * 2 + 1] = c >> 8
    return bytes(out)


# ---- the LIVE/PATCH format (desktop: src/shared/live-patch.ts) ----
def _pixel(img: bytes, i: int) -> int:
    return img[i * 2] | (img[i * 2 + 1] << 8)


def _encode_box(out: bytearray, img: bytes, x: int, y: int, w: int, h: int) -> None:
    out += bytes([x, y, w, h])
    pixels = [
        _pixel(img, row * W + col) for row in range(y, y + h) for col in range(x, x + w)
    ]
    i = 0
    while i < len(pixels):
        run = 1
        while i + run < len(pixels) and run < 128 and pixels[i + run] == pixels[i]:
            run += 1
        if run >= 3:
            out += bytes([127 + run, pixels[i] & 255, pixels[i] >> 8])
            i += run
            continue
        start = i
        while (
            i < len(pixels)
            and i - start < 128
            and not (
                i + 2 < len(pixels) and pixels[i] == pixels[i + 1] == pixels[i + 2]
            )
        ):
            i += 1
        out.append(i - start - 1)
        for k in range(start, i):
            out += bytes([pixels[k] & 255, pixels[k] >> 8])


def patch(prev: bytes | None, nxt: bytes) -> bytes:
    """What changed from `prev` to `nxt`, box by 32 x 32 tile; the whole key without `prev`."""
    out = bytearray()
    if prev is None:
        _encode_box(out, nxt, 0, 0, W, H)
        return bytes(out)
    for ty in range(0, H, TILE):
        for tx in range(0, W, TILE):
            l, t, r, b = W, H, -1, -1
            for y in range(ty, min(H, ty + TILE)):
                for x in range(tx, min(W, tx + TILE)):
                    i = (y * W + x) * 2
                    if prev[i] != nxt[i] or prev[i + 1] != nxt[i + 1]:
                        l, r, t, b = min(l, x), max(r, x), min(t, y), max(b, y)
            if r >= 0:
                _encode_box(out, nxt, l, t, r - l + 1, b - t + 1)
    return bytes(out)


class Deck:
    """The deck's command line, with every reply logged, normalised where it
    varies for reasons that are not the firmware's."""

    def __init__(self, port_name: str):
        self.port = deck_link.open_port(port_name, timeout=0.002)
        # A bytearray: a 768 KB screen dump appended to an immutable bytes object
        # copies it at every read, and the driver drops bytes while Python catches up.
        self.buffer = bytearray()
        self.log: list[str] = []
        # RTS is the chip's reset line: every run starts from a fresh deck, once
        # it has said BOOT (its card mounted, its links up).
        self.port.reset_input_buffer()
        self.port.rts = True
        time.sleep(0.1)
        self.port.rts = False
        end = time.time() + 15
        while time.time() < end and b"BOOT decky" not in self.buffer:
            self._fill()
        if b"BOOT decky" not in self.buffer:
            raise RuntimeError("the deck did not start again after the reset")
        self.buffer = self.buffer[self.buffer.index(b"BOOT decky") :]
        self.buffer = (
            self.buffer[self.buffer.index(b"\n") + 1 :]
            if b"\n" in self.buffer
            else bytearray()
        )

    def _fill(self) -> None:
        self.buffer += self.port.read(max(1, self.port.in_waiting))

    def line(self, timeout: float = 10) -> str:
        end = time.time() + timeout
        while time.time() < end:
            if b"\n" in self.buffer:
                raw, self.buffer = self.buffer.split(b"\n", 1)
                text = raw.decode("utf-8", "replace").strip()
                if text and not text.startswith(("EV ", "PAGE ", "BOOT")):
                    return text
                continue
            self._fill()
        return "(timeout)"

    def note(self, what: str, reply: str) -> str:
        reply = re.sub(r"reset=\w+", "reset=*", reply)
        # The version stamp follows git (commits since the last firmware tag).
        reply = re.sub(r"fw=\S+", "fw=*", reply)
        # A signature this run made up.
        reply = re.sub(r"base=\d+", "base=*", reply)
        # The card keeps ON pictures from earlier runs.
        if what.startswith("ALT"):
            reply = re.sub(r"cached=\d", "cached=*", reply)
        self.log.append(f"{what} -> {reply}")
        return reply

    def ask(self, command: str, label: str | None = None) -> str:
        self.port.write((command + "\n").encode())
        while True:
            reply = self.line()
            if reply.startswith(("OK", "ERR", "(timeout)")):
                return self.note(label or command, reply)

    def push(self, header: str, data: bytes, label: str | None = None) -> str:
        self.port.write((header + "\n").encode())
        reply = self.line()
        if not reply.startswith("READY"):
            return self.note(label or header, reply)
        block = int(reply.split()[1]) if len(reply.split()) > 1 else 128
        for i in range(0, len(data), block):
            self.port.write(data[i : i + block])
            ack = self.line()
            if ack != "A":
                return self.note(label or header, f"no ack: {ack}")
        return self.note(label or header, self.line())

    def screen(self, path: Path) -> None:
        self.port.write(b"SCREEN\n")
        # Its header, `OK screen <w> <h> <bytes>`; anything else before it is
        # a stray line, reported and passed over.
        head = self.line(5)
        while head != "(timeout)" and not re.fullmatch(r"OK screen \d+ \d+ \d+", head):
            print(f"  (before SCREEN, passed over: {head!r})", file=sys.stderr)
            head = self.line(5)
        if head == "(timeout)":
            raise RuntimeError("SCREEN did not answer")
        size = int(head.split()[4])
        end = time.time() + 40
        while len(self.buffer) < size and time.time() < end:
            self._fill()
        data, self.buffer = bytes(self.buffer[:size]), self.buffer[size:]
        if len(data) != size:
            raise RuntimeError(f"SCREEN sent {len(data)} of {size} bytes")
        self.note("SCREEN", self.line(5))
        rgb = bytearray(800 * 480 * 3)
        for i in range(800 * 480):
            c = data[i * 2] | (data[i * 2 + 1] << 8)
            rgb[i * 3] = (c >> 11) * 255 // 31
            rgb[i * 3 + 1] = ((c >> 5) & 63) * 255 // 63
            rgb[i * 3 + 2] = (c & 31) * 255 // 31
        Image.frombytes("RGB", (800, 480), bytes(rgb)).save(path)


def run(out: Path, port_name: str) -> str:
    out.mkdir(parents=True, exist_ok=True)
    labels = json.loads((HERE / "labels.json").read_text())["labels"]
    looks = {name: (HERE / f"{name}.look").read_bytes() for name in labels}
    crc = zlib.crc32

    rng = random.Random(7)
    noise = [rng.getrandbits(16) for _ in range(W * H)]
    gradient = picture(lambda x, y: rgb565(x * 2, y * 2, 128))
    speckle = picture(lambda x, y: noise[y * W + x])
    stripes = picture(
        lambda x, y: rgb565(255, 200, 40) if (x // 8) % 2 else rgb565(20, 20, 60)
    )
    toggle_off = picture(
        lambda x, y: rgb565(40, 90, 200) if 20 < x < 98 and 20 < y < 103 else 0
    )
    toggle_on = picture(
        lambda x, y: (
            rgb565(250, 250, 250)
            if 20 < x < 98 and 20 < y < 103
            else rgb565(40, 90, 200)
        )
    )
    checker = picture(
        lambda x, y: (
            rgb565(230, 60, 60) if ((x // 10) + (y // 10)) % 2 else rgb565(10, 10, 10)
        )
    )
    circle = picture(
        lambda x, y: (
            rgb565(90, 220, 140) if (x - 59) ** 2 + (y - 61) ** 2 < 40**2 else 0
        )
    )
    changed = picture(
        lambda x, y: rgb565(200, 100, 250) if (x + y) % 16 < 8 else rgb565(30, 0, 60)
    )
    # A new signature each run, so the card never has the page: one pixel
    # under the die, which draws the whole key itself.
    nonce = bytearray(KEY)
    nonce[0:2] = rgb565(1, 1, (int(time.time()) & 31) << 3).to_bytes(2, "little")

    keys = [bytes(KEY)] * 15
    keys[3] = bytes(nonce)
    keys[6], keys[7], keys[8], keys[9], keys[12] = (
        gradient,
        speckle,
        stripes,
        toggle_off,
        circle,
    )

    deck = Deck(port_name)
    deck.ask("ID", label="ID")
    deck.ask("HELLO 1 20")
    deck.ask("BLOCK 2048")
    sig = crc(b"".join(keys))
    deck.ask(f"CACHE {PAGE} {sig}", label="CACHE new")
    for c in range(15):
        if not any(keys[c]):
            deck.ask(f"BLANK {c}")
            continue
        p = patch(None, keys[c])
        deck.push(f"PATCH {c} {len(p)} {crc(p)}", p, label=f"PATCH {c}")
    deck.ask(f"COMMIT {sig}", label="COMMIT")
    deck.push(f"ALT {PAGE} {sig} 9 {KEY} {crc(toggle_on)}", toggle_on, label="ALT 9")
    deck.ask(f"STATE {PAGE} {sig} {1 << 9}", label="STATE on 9")
    p = patch(None, (HERE / "media.key").read_bytes())
    deck.push(f"LIVE {PAGE} {sig} 5 0 {len(p)} {crc(p)}", p, label="LIVE 5 media")
    text = (HERE / "media.slide").read_bytes()
    deck.push(f"SLIDE {PAGE} {sig} 5 {len(text)} {crc(text)}", text, label="SLIDE 5")
    p = patch(None, checker)
    deck.push(f"LIVE {PAGE} {sig} 11 0 {len(p)} {crc(p)}", p, label="LIVE 11 checker")
    p2 = patch(checker, circle)
    deck.push(
        f"LIVE {PAGE} {sig} 11 {crc(checker)} {len(p2)} {crc(p2)}",
        p2,
        label="LIVE 11 delta",
    )
    deck.push(
        f"LIVE {PAGE} {sig} 11 {crc(checker)} {len(p2)} {crc(p2)}",
        p2,
        label="LIVE 11 stale base",
    )
    deck.push(
        f"LIVE {PAGE} {sig} 11 0 {len(p)} {crc(p)}", p, label="LIVE 11 checker again"
    )
    wheels = [(0, "timer"), (1, "arc"), (2, "bar"), (3, "die"), (4, "list")]
    for cell, name in wheels:
        spec = looks[name]
        deck.push(
            f"WHEEL {PAGE} {sig} {cell} {labels[name]} {len(spec)} {crc(spec)}",
            spec,
            label=f"WHEEL {cell} {name}",
        )
    time.sleep(0.6)
    deck.screen(out / "1-page.png")

    # A new version: key 7 changes; live pictures and the text carry over.
    keys2 = list(keys)
    keys2[7] = changed
    sig2 = crc(b"".join(keys2))
    deck.ask(f"CACHE {PAGE} {sig2}", label="CACHE version")
    p = patch(keys[7], keys2[7])
    deck.push(f"PATCH 7 {len(p)} {crc(p)}", p, label="PATCH 7 delta")
    deck.ask(f"COMMIT {sig2}", label="COMMIT version")
    deck.push(
        f"ALT {PAGE} {sig2} 9 {KEY} {crc(toggle_on)}", toggle_on, label="ALT 9 version"
    )
    deck.ask(f"STATE {PAGE} {sig2} {1 << 9}", label="STATE version")
    for cell, name in wheels:
        deck.ask(
            f"WHEELAT {PAGE} {sig2} {cell} {labels[name]} {crc(looks[name])}",
            label=f"WHEELAT {cell} {name}",
        )
    deck.ask(f"LIVE {PAGE} {sig2} 11 0 0 0", label="LIVE 11 drop")
    deck.ask(f"STATE {PAGE} {sig2} 0", label="STATE off")
    deck.ask(f"WHEELAT {PAGE} {sig2} 1 80 {crc(looks['arc'])}", label="WHEELAT 1 80")
    time.sleep(0.6)
    deck.screen(out / "2-version.png")

    # What the deck refuses.
    deck.ask(f"LIVE {PAGE} 12345 3 0 10 0", label="LIVE unknown page")
    deck.ask(f"SLIDE {PAGE} {sig2} 99 0 0", label="SLIDE bad cell")
    deck.ask(f"WHEELAT {PAGE} {sig2} 0 1 424242", label="WHEELAT unknown look")
    deck.ask("PATCH 3 10 0", label="PATCH nothing pending")
    deck.ask("COMMIT 1", label="COMMIT nothing pending")
    deck.ask(f"STATE {PAGE} {sig2} 99999", label="STATE bad mask")
    deck.ask(f"STATE {PAGE} {sig2} 1", label="STATE no ON picture")
    deck.ask("BOGUS 1 2 3", label="unknown command")
    deck.ask(f"SLIDE {PAGE} {sig2} 5 0 0", label="SLIDE 5 off")
    deck.ask("PING", label="PING")
    display = deck.ask("DISPLAY_STATE", label="DISPLAY_STATE")
    deck.ask("BLOCK 128")
    deck.port.close()

    replies = [entry for entry in deck.log if not entry.startswith("DISPLAY_STATE")]
    (out / "replies.txt").write_text("\n".join(replies) + "\n")
    return display


def compare(reference: Path, latest: Path) -> bool:
    before = (reference / "replies.txt").read_text().splitlines()
    now = (latest / "replies.txt").read_text().splitlines()
    same = True
    for i, (a, b) in enumerate(zip(before, now)):
        if a != b:
            same = False
            print(f"reply {i}: was  {a}\n          now  {b}")
    if len(before) != len(now):
        same = False
        print(f"{len(before)} replies before, {len(now)} now")
    for name in ("1-page.png", "2-version.png"):
        box = ImageChops.difference(
            Image.open(reference / name), Image.open(latest / name)
        ).getbbox()
        if box:
            same = False
            print(f"{name}: pixels differ within {box}")
    return same


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("record", "check"):
        print(__doc__)
        return 1
    port = deck_link.resolve_port(sys.argv[2] if len(sys.argv) > 2 else None)
    runs = HERE / "runs"
    if sys.argv[1] == "record":
        display = run(runs / "reference", port)
        print(f"recorded tools/golden/runs/reference\n{display}")
        return 0
    display = run(runs / "latest", port)
    print(display)
    if compare(runs / "reference", runs / "latest"):
        print("IDENTICAL")
        return 0
    print("DIFFERENT")
    return 1


if __name__ == "__main__":
    sys.exit(main())
