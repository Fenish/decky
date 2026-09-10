---
name: connection-priority
type: preference
---

USB first, Wi-Fi only when no cable answers; when the cable returns, USB takes
over again. No manual transport switch, no "preferred connection" setting - the
user explicitly does not want connection modes.

**Why it matters:** the user changed this several times before settling it, and
both "no switching at all" and a preference toggle were built and removed. Do
not reintroduce either.

See [[decisions/2026-09-10-usb-first]].
