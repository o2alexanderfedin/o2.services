# The e2e project is red, deterministically, and the merge did not cause it

**Taken 2026-08-19, on `main` at `af8828f`.** Read this before trusting any
"all five projects green" line dated 2026-08-19.

## The reading

`--project e2e` — **EXIT=1, 11 files failed / 25 passed, 34 tests failed / 191
passed / 7 skipped (232)**, `real 2177.70 user 408.65 sys 125.66`.

The other projects are green in the same sweep, exit codes read directly on the
line after the command:

| project | exit | files | tests | real | (user+sys)/real |
|---|---|---|---|---|---|
| node | **0** | 197 passed | 2962 passed, 1 skipped | 446.31 | 1.83 |
| browser | **0** | 300 passed | 5169 passed | 116.60 | 2.00 |
| e2e | **1** | 11 failed, 25 passed | 34 failed | 2177.70 | 0.25 |
| perf | n/a | — | — | 1.44 | — |

`perf` is **not a defect**: the project is gated behind `PERF_GATE`
(`vitest.config.ts:818`), so `--project perf` matches nothing unless that env
var is set. `Error: No projects matched the filter "perf"`. That red was the
reader's invocation error and is recorded here so nobody re-files it.

## The merge is excluded as a cause, by tree hash and not by argument

`git diff 432a68d af8828f --stat` is empty and both trees hash to
`8a12b1b4e5d36a8f05269814748c09930ba1503b`. The merge of
`feature/phase-20-checkpoint-agent` into `develop` and `main` introduced **zero
content change**. Whatever reddens e2e reddens the branch it came from.

## One root cause, thirty-four symptoms

Every failure in all eleven files descends from a single call:

    window.o2.dial(<peer's /webrtc address>)  ->  TimeoutError: signal timed out

Everything after it cascades — `hook` is left `undefined`, so assertions read
`Cannot read properties of undefined`, `expected undefined to be defined`, and
`page.fill` waits out its 30 s on controls that never render. The failing files
are the multi-tab ones: `two-tabs`, `static-rendezvous`, `demo-byo`, `demo-pi`,
`quorum-ui`, `colouring-demo`, `demo-liveness`, `demo-fabric`, `seed-discovery`,
`background-tab`.

**The lone-tab arm passes in the same run** — `demo-pi`'s solo case maps
1 000 000 terms over 4 shards and renders every region. So the bundle builds, the
page loads, and the fabric computes. What fails is browser-to-browser WebRTC.

`waitForWebrtc` **succeeds** before the failing dial, so the dialled peer did get
a `/webrtc` address, which means it holds a relay reservation. The relay
signalled; the direct leg is what never completes. Firefox says so in its own
words: `WebRTC: ICE failed, add a TURN server`.

## It is deterministic, not the known flake

`two-tabs.e2e.test.ts` was run three times, alone, at load 5.60 / 10.54 / 13.63:
**3 failed | 3 passed every time**, EXIT=1 every time. CPU share 0.11 — the
process is waiting on timeouts, not competing for CPU.

This matters because `.planning/STATE.md:191` records
`demo-pi.e2e.test.ts IS A KNOWN FLAKE - green, red, green on identical code`.
That record covers **one** file. It does not cover the other ten, and it does not
explain a 3-of-3 reproduction.

## Starvation is excluded, and so is the environment

- Not starvation: reproduces at load 5.60 with CPU share 0.11.
- Not concurrent test runs: the 8 `vitest|playwright` process matches at the time
  were long-lived `@playwright/mcp` servers, days old. No other vitest was running.
- Not the network: `github.com` 200 in 0.66 s, `stun.l.google.com` resolves
  (74.125.250.129) and udp/19302 accepts.
- Not mDNS (Chromium hides WebRTC host candidates behind `.local` names):
  `mDNSResponder` up 25 days, `Alexanders-MacBook-Pro.local` resolves.
- Not the firewall: `socketfilterfw --getglobalstate` = disabled.
- Not a truncated artifact from the full disk: the volume did hit **0 bytes free**
  around 06:50–07:30, but no zero-length files exist under `node_modules`, and the
  repo files with mtimes in that window are exactly the ones `git checkout`
  rewrote during the merges — the tree is clean.
- `packages/browser/dist` is rebuilt per run (mtime 09:20), so the served bundle
  is not stale.

## What is NOT established

**Why the direct WebRTC leg fails.** The leading unproven lead: this host exposes
23 interfaces, of which only three carry IPv4 (`lo0` 127.0.0.1, `en0`
10.144.82.249, `bridge100` 192.168.139.3 — a VM bridge), with several IPv6-only
`utun*` tunnels up. ICE candidate selection across that set is a known way for a
loopback WebRTC connection to fail. **This was not measured.** Do not write it
down as the cause until someone reads the candidate pairs out of
`about:webrtc` / `chrome://webrtc-internals` on a failing dial.

**Whether this predates 2026-08-19.** A same-day note claims
`--project e2e` at 232 tests EXIT=0, on this identical tree. A directly-read
EXIT=1 now beats a remembered EXIT=0 then. Either that reading was not taken
from the exit code on the line after the command, or something outside the tree
changed between them. The repo already warns about exactly this
(`.planning/STATE.md`, task #48: a skipped-looking line can mean a failed suite).

## Why it matters

`static-rendezvous.e2e.test.ts` is the named proof of **WIRE-03**, and
`two-tabs.e2e.test.ts` of **NET-02** — both rows marked **Done**. A Done row
whose spec is red is a row to re-open or re-attribute, not to leave standing.

## Next measurement

Open a failing dial under `chrome://webrtc-internals`, read the candidate pairs,
and record which pair is selected and where it stalls. That is the one reading
that turns the interface hypothesis into a cause or kills it.
