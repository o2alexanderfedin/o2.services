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
