---
date: 2026-09-10
status: accepted
---

# Every Wi-Fi byte after pairing is an AES-128-GCM frame (protocol 7)

**Context:** the user asked that nobody on the same network be able to send
images or commands to the deck. Pairing already existed - a per-device 256-bit
secret handed out only over USB, and a mutual HMAC challenge - but after that
handshake everything travelled in plain text with no per-message check. Anyone
able to inject into the TCP stream (ARP spoofing on the LAN) could send deck
commands, or fake `EV` key presses that make the PC run whatever the key is
bound to, scripts included.

**Choice:** after the handshake, frames of
`[u16 length][ciphertext][16-byte tag]`. One key per direction:
HMAC-SHA256(secret, "decky c2s " / "decky s2c " + challenge), first 16 bytes.
The nonce is direction plus a per-direction frame counter and is never sent, so
altered, injected, replayed, reordered or reflected frames fail and end the
connection. The deck marks its challenge `aesgcm1`; the desktop refuses any
challenge without it, so the link cannot be downgraded. A new connection
receives no key events until it has authenticated and sent a command.
`DECKY_PROTOCOL` became 7.

**Why:** AES-GCM is hardware-accelerated on the ESP32-S3 and native in Node, and
gives integrity and secrecy in one primitive. The keys derive from the pairing
secret the project already had, so pairing is unchanged.

**Rejected:**

- _A shared secret compiled into every build._ The repository is public; a key
  in the firmware or app would be public too.
- _Per-message HMAC without encryption._ Stops injection just as well, but the
  AES-GCM version costs nothing extra.
- _Keeping plain text for older firmware._ Would leave the attack open; older
  firmware keeps working over USB and is offered an update.

Verified: desktop framing tests (tamper, wrong key, replay, reorder, reflection)
and a fake deck speaking the protocol. Against the real firmware over Wi-Fi it
awaits the deck losing its cable while powered.

See [[wifi-encryption]].
