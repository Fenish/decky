---
name: speedtest
description:
  The speed test key measures against Speedtest.net's own servers; ask
  c.speedtest.net first or a line in Istanbul is sent to Liechtenstein, and one
  dropped connection must not fail the run
metadata:
  type: project
---

The speed test widget ([[widgets]]) is Decky's own client for Speedtest.net's
published endpoints - their config, their server list, `latency.txt`,
`random<n>x<n>.jpg`, `upload.php` - in `main/widgets/speedtest.ts`. No Ookla
code or binary: `speedtest-net@1` is 2019-era with old transitive deps, and its
v2 downloads Ookla's CLI, which does not survive Electron packaging.

- **Mirror order matters more than anything else here.** Ask
  `c.speedtest.net/speedtest-servers-static.php` first, as their own client
  does: the `www` mirrors hand out a short list of whatever, and a live run
  from Istanbul picked **Schaan, Liechtenstein** at 46 ms. Keep asking while
  the best list's nearest server is over 300 km away. With c. first the same
  line found Istanbul at 7 ms, 944 Mbps each way.
- **Their servers are healthy; a failing run is our bug.** Probed from the
  user's line: config and both lists answer 200, and every Istanbul server
  serves latency, a 2 MB image and an upload. The failures were mine - one
  dropped connection rejecting `Promise.all` and killing the phase, and no
  status-code checks, so a 404 counted as a transfer of nothing.
- **Measurement:** six streams down, four up, bytes counted as they stream,
  the first 1.5 s dropped for TCP slow start. That is why no correction factor
  is needed, unlike `speedtest-net`'s 1.135/1.139, which exist because it uses
  two connections and counts only completed requests.
- **The dial follows the speed, not the clock**: the volume's 270° arc on a
  logarithmic scale to 1000 Mbps, eased 0.35 towards each reading eight times
  a second. The deck-swept ring is kept only for the hunt for a server, which
  has nothing to measure yet.
- A run saturates the line for twenty seconds and moves real data; it only
  ever runs when a finger asks.
