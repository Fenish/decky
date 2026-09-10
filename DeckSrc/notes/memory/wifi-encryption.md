---
name: wifi-encryption
type: constraint
---

From protocol 7, everything on the Wi-Fi link after the pairing handshake is
AES-128-GCM framed: `[u16 length][ciphertext][16-byte tag]`, a key per direction
from HMAC-SHA256(pairing secret, "decky c2s " / "decky s2c " + challenge), and a
per-direction frame counter as the nonce. The deck's challenge ends with
`aesgcm1`; the desktop refuses Wi-Fi to firmware without it. The framing exists
twice - `firmware/src/secure_link.cpp` and
`desktop/src/main/device/secure-channel.ts` - and the two must match byte for
byte. USB is not framed.

**Why it matters:** without it, anyone on the LAN able to inject into the TCP
stream could send deck commands or fake key presses that run the PC's bound
actions. Changing one side alone breaks every Wi-Fi connection.

See [[decisions/2026-09-10-encrypted-wifi]].
