# Chromium's mDNS ICE obfuscation is what reddens the tab-to-tab e2e specs

**Taken 2026-08-21, on `fix/demo-failures-absence-line` at `a75750a`.**

This closes the question left open by
[`2026-08-19-e2e-webrtc-dial-red.md`](./2026-08-19-e2e-webrtc-dial-red.md), whose final
section names the residue exactly: *"Still not attributed: **why** the 08:42 window
failed."* There is now a mechanism, measured outside this repository, and a fix measured
on the real gate.

---

## The mechanism

Chromium replaces host ICE candidates with ephemeral `<uuid>.local` names
(`WebRtcHideLocalIpsWithMdns`) so a page cannot read the machine's LAN address. A peer
receiving one must resolve it over mDNS to obtain a usable candidate pair. When that
resolution does not work, two tabs on one machine are left holding only their
server-reflexive candidates — and srflx↔srflx between two tabs behind a single public IP
requires NAT hairpinning.

Nothing fails at any single layer, so the dial does not error. It waits, and the spec
reports `TimeoutError: signal timed out`.

## The measurement, taken outside this repository first

A bare `RTCPeerConnection` with one data channel between two Chromium browser contexts.
No libp2p, no relay, no o2 source of any kind — so the reading is of the browser and the
host, and cannot be a statement about this codebase.

| mDNS obfuscation | candidates offered | result |
|---|---|---|
| on (Chromium default) | `<uuid>.local` host + srflx | **`failed` after 30 s** |
| off (`--disable-features=WebRtcHideLocalIpsWithMdns`) | host `10.144.82.249` + srflx | **connected in 225 ms** |

One variable, opposite outcomes. This is the reading the 08-19 file asked for and did not
take — it excluded mDNS on the grounds that *"`mDNSResponder` up 25 days,
`Alexanders-MacBook-Pro.local` resolves"*. **That exclusion was wrong, and the reason is
worth keeping:** the daemon being healthy and the host's own name resolving says nothing
about whether Chromium's *ephemeral per-session* `.local` ICE names resolve. Two different
questions; the easy one was measured and the answer was applied to the hard one.

## Then on the real gate

The probe proves a browser fact. It does not prove the suite's fact, so the flag was
planted into `demo-byo.e2e.test.ts` alone and then restored by the surgical inverse
(`cmp` clean against a snapshot taken immediately before planting):

| | mDNS on | flag planted |
|---|---|---|
| result | **12 failed** | **17 passed** |
| real | 235.13 s | **6.48 s** |

The green run was **read, not counted** — 3 distinct peer ids, 6 shards across 2 replicas,
real placement, 21 egress frames over 7130 bytes, provenance refusals present, `complete`
in 408 ms. A suite that goes green by skipping is a failure this repo has already been
caught by once (task #48), so the counting was not treated as sufficient.

## It is not this branch, and that was bisected rather than argued

`demo-byo` alone:

| tree | result | real |
|---|---|---|
| `a75750a` (HEAD) | 12 failed | 236.23 |
| `50a9cb1` (before both fixes on this branch) | 12 failed | 235.13 |
| `a75750a`, third reading | 12 failed | 234.84 |

Identical first failure each time. Neither fix on this branch is implicated.

---

## Reconciling with 2026-08-19, which measured the opposite

That file's second amendment records a probe that **connected 6 times out of 6** with the
obfuscation left on, and concluded *"browser-to-browser WebRTC is not broken"*.

**Both readings are correct.** They were taken two days apart, and the difference is the
host: these `.local` names resolve in some windows and not in others. That is precisely
the shape the 08-19 file described from the outside — 34 failures in the morning window,
1 in the evening, identical tree, identical user time — without being able to name what
varied.

So the contribution here is not that the earlier reading was mistaken. It is that the
varying quantity now has a name, and it is not in this repository.

**What this does not establish:** that mDNS resolution is what varied *in the 08:42 window
on 2026-08-19*. That window was not instrumented and cannot now be. It is the leading
candidate because a mechanism finally exists that produces exactly its signature — a dial
that waits rather than fails, unchanged user time, wall clock inflated by expiring
timeouts — but it is a candidate, not a finding. The 08-19 file's own lesson applies to
this one: an explanation that fits the arithmetic is not thereby proven.

---

## What was changed, and what it costs

`packages/node/src/e2e-browser-launch.ts` — test-only, deliberately **not** barrel-exported
(`capability-fixture.ts`'s precedent and its reason). Every e2e launch site now routes
through it: 32 `.launch()` calls across 32 files plus one `launchPersistentContext`.

The flag is applied **by browser name**, because several fixtures launch from a
`BrowserType` table that also holds firefox and webkit and a Chromium switch on Firefox's
command line is not a no-op. Firefox's equivalent lever
(`media.peerconnection.ice.obfuscate_host_addresses` via `firefoxUserPrefs`) is
**deliberately not set**: `[firefox] ICE failed` console lines appear in green-era logs
too, so those arms may pass unchanged. Measure before reaching for it.

### The cost, stated rather than absorbed

**This removes real coverage.** The suite no longer exercises Chromium's mDNS candidate
resolution at all. The phone-and-laptop LAN topology the demo is *about* exchanges
obfuscated candidates for real, in production, and nothing here tests that any more.

It is worth taking because the alternative is the failure mode this repo's own conventions
name: leaving it in makes every browser-tab spec's verdict depend on whether the host's
local network permits mDNS multicast that day, which *"silently encodes the machine, the
load and the I/O weather of the day it was written"*. A suite that reaches opposite
verdicts on one tree — which is exactly what the 08-19 file documents, three times — is
not measuring the tree.

## For the owner

**The host condition is real outside the tests.** Two tabs of the actual demo, in a real
browser on this machine, cannot dial each other right now. The flag shields the gate and
nothing else. The standard first reset is `sudo killall -HUP mDNSResponder`, or a reboot;
both are the owner's call, not this document's.

---

# THE GATE, after the change — and one hypothesis this file had to drop

## Green, and it is the first fully green e2e reading on record

    --project e2e   38 files passed (38)
                    235 tests passed (235)
                    E2E_EXIT=0
                    real 725.92  user 414.25  sys 77.63

Beside every other whole-suite reading of this project:

| | 16-VERIFICATION (recorded) | 08-19 morning | 08-19 evening | 08-21 first | 08-21 control |
|---|---|---|---|---|---|
| exit | 0 | 1 | 1 | 1 | **0** |
| files failed | 0 | 11 | 1 | 2 | **0** |
| tests failed | 0 | 34 | 1 | 2 | **0** |
| real | 854.59 | 2177.70 | 1049.97 | 830.23 | **725.92** |
| user | 446.46 | 408.65 | 445.27 | 422.26 | **414.25** |

**User time is 446 / 409 / 445 / 422 / 414 across all five.** The suite always did the
same work; what moved was time spent waiting. This reading is the only one where nothing
waited.

## The two reds in the first post-fix sweep, and why they are not re-attributed

The 02:16 sweep left `static-rendezvous.e2e.test.ts` (2 tests) and
`peer-ledger.e2e.test.ts` (as a suite, on a 60 s `waitForFunction`). Both were run alone:

    static-rendezvous   5 passed (5)   real 8.11   exit 0
    peer-ledger         7 passed (7)   real 8.69   exit 0

and both then passed inside the control sweep above.

**"Passes in isolation" is a claim, not a diagnosis** — this repo has one recorded
instance of it being simply false, so it is not the evidence here. The evidence is the
control sweep, in which they passed *in place*, under the same accumulated load. The
honest label is the one already recorded for `many-tabs` on 2026-08-19 evening:
suite-internal contention across the preceding files, non-reproducing. **Nothing further
is claimed about them**, and in particular the tempting story — that chromium's 225 ms
connect reorders peer introductions and makes a peer re-dial one it already knew — is
NOT asserted. It fits the arithmetic, and this file's predecessor died twice on
explanations that fit the arithmetic.

What must *not* happen if they return: `static-rendezvous`'s
`attempted === undiscovered` is the specification ("the fabric introduces every pair
exactly once"), and `publish`'s wait is a condition rather than a sleep. Loosening either
would close the gap by redefining passing.

## peer-ledger converts, and that retires a reader hazard

`peer-ledger.e2e.test.ts` has a history of failing **as a suite** while printing
`7 skipped` — the exact hazard task #48 records, which caught a reader inside the very
document warning about it. It burned 556 153 ms doing so.

It now runs in **8.69 s and passes all 7**. So that long-standing skip was this same root
wearing #48's costume: a `waitForFunction` waiting on a render that could not arrive
because the dial underneath it never completed.

## The hypothesis this file had to drop: firefox and webkit were never the problem

The two survivors were both webkit-side assertions, which made the obvious next step
Firefox's `media.peerconnection.ice.obfuscate_host_addresses` pref. **It was measured
first, and the measurement refused it.**

Same bare-`RTCPeerConnection` probe, cross-engine, obfuscation left at Chromium-style
defaults:

    webkit <-> firefox   opened=true   1134 ms
    webkit host candidate:  56b7b263-....local
    firefox host candidate: 013fb4cd-....local

Both sides offered `.local` names, **both resolved them, and the channel opened.** So the
pref would have changed nothing, and it was not set. Setting it would have been a fix
applied to a mechanism that was never broken.

**This narrows the fault.** It is not "this host cannot resolve mDNS ICE candidates" — it
is specific to **Chromium's** ephemeral names on this host. Firefox and WebKit register
and resolve each other's fine.

**Dated to its own window, because that discipline is the whole lesson of the file this
one amends:** the cross-engine probe ran at **02:35**, *after* the 02:16–02:30 sweep. It
is a reading of that window and is not evidence about any other. On a host already shown
to vary between windows, applying it further would repeat the 08-19 error exactly.

## One thing the green run establishes that nothing else could

`cold-start-seed-race.e2e.test.ts` had never completed a run before this one. Its three
trials printed:

    [cold-start trial 0] release-spread=2ms distinct=1 of 4 changed-across-restart=0
    [cold-start trial 1] release-spread=1ms distinct=1 of 4 changed-across-restart=0
    [cold-start trial 2] release-spread=2ms distinct=1 of 4 changed-across-restart=0

Its own docblock warns that a green here cannot distinguish *"the race is rare"* from
*"the tabs never overlapped"*. **A 1–2 ms release spread is the answer to that**: four
tabs released within two milliseconds of each other is genuine overlap, and they produced
**one** identity, unchanged across restart. That is task #49's fix confirmed in production
shape, by the reading its author said would be needed to tell the two cases apart.
