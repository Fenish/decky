"""Finding and opening the deck's serial port.

Shared by the host tools so they behave the same way, and so the two things that
are easy to get wrong are only written once: which port the board is on, and not
resetting it while connecting.
"""

from __future__ import annotations

import serial
import serial.tools.list_ports

BAUD = 460800

# The panel's USB-serial bridge. Matching on the chip rather than a port number
# means the tools keep working when the board lands on a different COM port.
KNOWN_VIDS = {
    0x1A86,  # WCH CH340 / CH9102
    0x10C4,  # Silicon Labs CP210x
    0x0403,  # FTDI
    0x303A,  # Espressif native USB
}


def find_port() -> str:
    """Locate the deck.

    Returns the port name. Raises if there is nothing plausible, or if several
    candidates are attached and the choice would be a guess.
    """
    candidates = [p for p in serial.tools.list_ports.comports() if p.vid in KNOWN_VIDS]

    if not candidates:
        # Fall back to anything that looks like a USB serial device.
        candidates = [
            p
            for p in serial.tools.list_ports.comports()
            if p.vid is not None or "USB" in (p.description or "")
        ]

    if not candidates:
        raise RuntimeError("no serial device found - is the deck plugged in?")

    if len(candidates) > 1:
        listed = ", ".join(f"{p.device} ({p.description})" for p in candidates)
        raise RuntimeError(
            f"several serial devices found; pass --port. Candidates: {listed}"
        )

    return candidates[0].device


def resolve_port(requested: str | None) -> str:
    """Use the port that was asked for, or find one."""
    if requested:
        return requested
    port = find_port()
    print(f"using {port}")
    return port


def open_port(name: str, baud: int = BAUD, timeout: float = 1.0) -> serial.Serial:
    """Open the port without resetting the board.

    pyserial asserts DTR when it opens a port, and on this board DTR is wired to
    the reset line - so a plain `serial.Serial(...)` reboots the deck before the
    command is even sent. Setting the lines low before opening avoids the pulse.
    """
    port = serial.Serial()
    port.port = name
    port.baudrate = baud
    port.timeout = timeout
    port.dtr = False
    port.rts = False
    port.open()
    return port
