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

---

# AMENDMENT, same day — two corrections, one of them to this file's own claim

## 1. The eleventh file was not read, and it is not the dial

This file said *"every failure in all eleven files descends from a single call."*
**That covered a file nobody had opened.** Ten files were identified by grepping
for `failed`; the eleventh does not match that pattern because it did not fail a
test — it failed as a **suite**:

     ❯ |e2e| packages/node/src/peer-ledger.e2e.test.ts (7 tests | 7 skipped) 556153ms
    ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
     FAIL packages/node/src/peer-ledger.e2e.test.ts
    TimeoutError: page.waitForFunction: Timeout 60000ms exceeded.
     ❯ publish packages/node/src/peer-ledger.e2e.test.ts:328:18

Its `publish` helper waits 60 s for `#report` to re-render and gives up, so all
seven of its tests were **skipped**, not failed. The 34 failed tests sum exactly
across the other ten files (4+1+3+1+1+3+12+5+1+3), so this file contributes
**zero** of them while still making the suite red.

**The corrected claim: 34 failed tests across 10 files trace to the dial
timeout; 1 file fails as a suite on a render that never arrives.** They are the
same family — a wait that expires — but that peer-ledger's wait descends from the
dial is **not proven**, and is not asserted here.

This is the hazard `.planning/STATE.md` and task #48 already record: **a line
reading `7 skipped` can be a failed suite.** It caught a reader again today, in
the very document warning about it.

## 2. A directly-read `exit: 0` on this same tree, and it is not remembered — it is written down

`.planning/phases/phase-16-decomposable-tree-reduce-wiring/16-VERIFICATION.md:66`:

```yaml
- command: "/usr/bin/time -p npx vitest run --project e2e"
  exit: 0
  result: "36 files, 232 passed (232) — matches the baseline exactly.
           real 854.59 user 446.46 sys 85.58, ratio 0.62"
```

Against today's reading of the identical tree:

| | recorded (16-VERIFICATION) | measured 2026-08-19 08:42 |
|---|---|---|
| exit | **0** | **1** |
| files | 36 passed | 11 failed, 25 passed |
| tests | 232 passed | 34 failed, 191 passed, 7 skipped |
| real | 854.59 | **2177.70** |
| user | 446.46 | 408.65 |
| sys | 85.58 | 125.66 |

**The CPU is the same and the wall clock is 2.5x.** 446 s of user time then,
409 s now — the suite did the same amount of work. It spent roughly **1300
additional seconds waiting**, which is what a suite full of expiring 30 s and
60 s timeouts looks like. This comparison is evidence in its own right: the
failure is not extra work, it is work that never arrives.

Both readings claim a directly-read exit code and neither can be dismissed as
remembered. So the honest position is **not** "the verification was wrong" — it
is that this suite reaches opposite verdicts on one tree, and today's verdict has
been reproduced 3-of-3 on a quiet host while the green one has not been
re-observed since.

## What this changes, and what it does not

**Does not change:** the merge is still excluded by tree hash. `node` (2962) and
`browser` (5169) are still green, exit codes read directly.

**Does change:** `WIRE-03` and `NET-02` are marked **Done** on specs
(`static-rendezvous`, `two-tabs`) that are red right now, and Phase 16's
verification carries an `exit: 0` for a suite that currently exits 1. **Whether
to re-open those rows is the owner's call, not this document's** — the cause is
unattributed, and re-scoring a requirement on an unattributed red is precisely
the move this repo forbids ("descoped is not satisfied; unmeasured is not met"
cuts both ways).

**`perf` was never run.** It is gated behind `PERF_GATE` and matched no project.
Nothing in this document says anything about it.

---

# SECOND AMENDMENT, same day, evening — the headline of this file is RETRACTED

## The retraction, stated first

This document's central claim — **"It is deterministic, not the known flake"** —
is **false**, and it was falsified by the cheapest control available, which the
morning pass never ran: *re-run the failing spec later*.

    two-tabs.e2e.test.ts   09:20–09:40   3 failed | 3 passed   x3   EXIT=1
    two-tabs.e2e.test.ts   21:30         6 passed (6)               EXIT=0

Three reproductions inside one 40-minute window justified "reproducible in that
window". They did **not** justify "deterministic", and the word should not have
been used for a suite whose sibling file this same document quotes STATE.md
calling *green, red, green on identical code*.

## The whole-suite reading, taken this evening on the same tree

    --project e2e   36 files: 1 failed | 35 passed
                    232 tests: 1 failed | 231 passed
                    real 1049.97  user 445.27  sys 95.40

Beside the other two readings of the identical tree:

| | 16-VERIFICATION (recorded) | 2026-08-19 08:42 | 2026-08-19 21:15 |
|---|---|---|---|
| exit | 0 | 1 | 1 |
| tests failed | 0 | **34** | **1** |
| real | 854.59 | **2177.70** | 1049.97 |
| user | 446.46 | 408.65 | **445.27** |

**User time is 446 / 409 / 445 across all three.** The suite always does the same
work. What moved is `real` — and the morning's extra ~1100 s was time spent
waiting on timeouts that never resolved. The evening run lands back beside the
recorded baseline on both axes. **The morning run was the outlier, not the norm,
and this file previously had it the other way round.**

## Browser-to-browser WebRTC is not broken, and that was measurable all along

A throwaway probe reproduced `two-tabs`' harness exactly — same relay
(`admits-any-peer`, `maxReservations: 16`, `/ip4/127.0.0.1/tcp/0/ws`), same vite
root, same `openTab` sequence — and called `window.o2.dial()` on the peer's
`/p2p-circuit/webrtc` address. **It connected every time**: six dials across
three configurations (with `trustAnchors`, without, and with libp2p's in-page
`debug` logging on and off, the last pair run specifically to rule out the
logging itself perturbing timing).

    >>> DIAL: {"ok":true,"id":"12D3KooWGstbd8WvfNMhZH9RPvq7gC5mXoGskxqdu16winS4wubR"}

The libp2p trace shows the full expected path: reservation created on the relay,
`/webrtc` listener up, outbound WebRTC connection, muxer open, `/ipfs/id/1.0.0`
negotiated. So the morning's `TimeoutError: signal timed out` was a dial that did
not complete **in that window**, not a dial path that cannot complete.

## The one failure that remains, and it is a different file

`many-tabs.e2e.test.ts` — green this morning, red this evening — fails at suite
level with:

    ConnectionFailedError: Could not connect to ws://127.0.0.1:64595

16 tabs opening WebSockets to the relay at once, one of which does not connect.
**In isolation it passes 2 of 2, in 9.20 s and 7.92 s, against 39.61 s inside the
suite** — and it did that at load **141**, so this is not raw CPU starvation but
resource pressure accumulated across 35 preceding e2e files (sockets, contexts,
browser processes). Recorded as a suite-internal contention symptom.

## What is now established, and what is not

**Established:** there is **no code regression**. 231 of 232 e2e tests pass on the
identical tree, `node` (2962) and `browser` (5169) are green, and the merge was
already excluded by tree hash (`8a12b1b4…`, unchanged).

**Withdrawn:** the suggestion that `WIRE-03` and `NET-02` might need re-opening.
Their specs — `static-rendezvous`, `two-tabs` — **pass**. Nothing about those rows
should have been put in question on a single suite reading, and putting it there
was the error this amendment exists to undo.

**Still not attributed:** *why* the 08:42 window failed. Load does not explain it
on its own — `two-tabs` failed 3/3 at loads 5.60/10.54/13.63 and passed 6/6 later
at 11.81. Excluded by measurement: the merge (tree hash), the network, STUN, mDNS,
the firewall, a stale bundle, disk truncation, concurrent vitest runs. The honest
label is **an unattributed window**, and it is the same shape as task #42
(`--project browser` deadlocked 33 minutes, did not reproduce).

## The method lesson, which is the durable part

The morning pass excluded six environmental causes by measurement and then
skipped the **seventh and cheapest**: run it again later. Three reproductions in
one window read as determinism only because nothing outside that window was
sampled. **For an intermittent suite, a repeat separated in time is not one more
data point — it is the control.**

---

# ATTRIBUTED 2026-08-21 — the varying quantity has a name

This file's closing residue — *"Still not attributed: why the 08:42 window failed"* — is
answered, in [`2026-08-21-chromium-mdns-ice-blocks-tab-to-tab.md`](./2026-08-21-chromium-mdns-ice-blocks-tab-to-tab.md).

Chromium's ephemeral `<uuid>.local` ICE candidate names do not always resolve on this
host. Measured with a bare `RTCPeerConnection` outside this repository: obfuscation on →
`failed` after 30 s; off → **connected in 225 ms**. On the real gate, `demo-byo` goes from
12 failed / 235 s to 17 passed / 6.48 s.

**One correction to this file.** Its exclusion list says *"Not mDNS … `mDNSResponder` up
25 days, `Alexanders-MacBook-Pro.local` resolves."* That measured the daemon's health and
the host's own name, and neither answers whether Chromium's *per-session ephemeral* names
resolve. The exclusion did not hold.

**What is still not established** is that this is what varied in the 08:42 window
specifically — that window cannot be re-instrumented. It is the leading candidate because
the mechanism produces this file's exact signature (a dial that waits rather than fails,
unchanged user time, wall clock inflated by expiring timeouts), and this file's own lesson
holds against over-reading it.
