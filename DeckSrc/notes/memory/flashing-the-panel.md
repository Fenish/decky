---
name: flashing-the-panel
type: environment
---

The panel is flashed over its CH340 USB-serial bridge (VID_1A86 / PID_7523),
which needs WCH's `CH341SER` driver on Windows — it is not inbox, and Windows
only offers it once the device enumerates. **The COM port moves** — it has been
COM4 and was COM5 on 2026-09-09, so look it up rather than trusting a number
written down here. MAC `a4:cb:8f:cd:d2:74`.

**Use 460800 baud, not 921600.** The board definition defaults to 921600 and a
full flash read failed there with a corrupt-data error; 460800 read all 4 MB
cleanly. `upload_speed` is pinned in `firmware/platformio.ini`.

Build and flash:

```
PYTHONIOENCODING=utf-8 python -m platformio run -d firmware -t upload --upload-port COM5
```

**Set `PYTHONIOENCODING=utf-8`.** Without it the upload dies with a
`UnicodeEncodeError` from cp1252 part way through esptool's progress bar — and
PlatformIO still prints `[SUCCESS]` afterwards, so the failure is silent and
the flash state is unknown. With it, the run ends with `Hash of data verified`,
which is the only line that actually confirms the write.

**The desktop app flashes the deck itself** (Settings → Firmware, or the
Disconnected page for a new board) - see [[firmware-install]]. Decky holds the
port while running, including from the tray, so quit it before flashing by other
means.

**Windows error 31 on open ("a device attached to the system is not
functioning")** means the CH340 driver is wedged. Retrying does not clear it and
restarting the device needs admin rights; replugging the USB cable does.

**Why it matters:** at 921600 the failure looks like a broken board rather than
a baud problem, and a `[SUCCESS]` after a swallowed encoding error looks like a
flash that happened. A 4 MB image of the original factory flash is kept in
`factory-backup/` **at the repository root** — the board can always be put
back.

See [[firmware-build-status]], [[dont-run-long-lived-commands]].
