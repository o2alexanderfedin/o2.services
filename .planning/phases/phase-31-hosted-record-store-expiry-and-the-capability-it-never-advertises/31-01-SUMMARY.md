---
phase: 31-hosted-record-store-expiry-and-the-capability-it-never-advertises
plan: 1
subsystem: hosted-tier
tags: [cloudflare, durable-objects, kad-dht, expiry, alarms, capabilities, workerd, e2e]
requires:
  - .planning/phases/phase-30-inbound-listener-correctness-and-hibernation/30-01-SUMMARY.md
provides:
  - "HOST-03 Done — a record written by one peer and read back by a second after the writer stopped"
  - "HOST-04 Done with granularity stated — the hosted capability record carries no execution, guarded ahead of its publisher"
  - "HOST-09 Done — the reschedule floor, which is the half `getAlarm()` never covered"
  - "HOST-14 Done — the sweep run against a record kad-dht itself wrote"
  - "HOST-13 Partial — the driver is built and the platform firing it is unmeasured"
  - "two corrections to criterion 1, each found by a plant that stayed green"
affects:
  - packages/cloudflare/src/hosted-capabilities.ts
  - packages/cloudflare/src/hosted-capabilities.test.ts
  - packages/cloudflare/src/hosted-record-store.e2e.test.ts
  - packages/cloudflare/src/expiry-alarm.ts
  - packages/cloudflare/src/expiry-alarm.test.ts
  - packages/cloudflare/src/hosted-libp2p.node.test.ts
  - packages/cloudflare/src/index.ts
  - packages/node/src/reachability-guard.node.test.ts
  - packages/node/src/requirements-ledger.node.test.ts
  - vitest.config.ts
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
tech-stack:
  added: []
  patterns:
    - "a bound is enforced on the one reading every path takes, never at the call sites"
    - "a guard over a producer is written before the publisher exists, because that is the window it exists for"
    - "a plant that stays green is a finding about the criterion, not a step to skip"
decisions:
  - "HOST-04 takes the omission route, not the critical-extension route — the extension route costs a recorded owner deferral of 2026-08-11"
  - "The reschedule floor is 60 s, derived as a bound on invocations per hour rather than chosen"
  - "`hostedCapabilities` is registered as unreachable with its reason, rather than given an invented caller"
metrics:
  duration: ~2 h
  completed: 2026-08-30
---

# Phase 31 — Hosted Record Store, Its Expiry, and the Capability It Never Advertises

## Most of this phase was already written, and the value was in finding out which part was not

`hostedDhtInit()` already stated all four private-DHT settings. `expiry-alarm.ts` already
armed a Durable Object alarm, swept both prefixes and re-armed from a `finally`.
`sweepValueRecords` and `sweepProviderRecords` already existed and were read. What did **not**
exist was two things and a proof:

1. **A reschedule floor** — `HOST-09`'s second clause, and the one the existing `getAlarm()`
   check does not cover.
2. **A capability record for this tier** — `HOST-04`, which had a ruling and no guard.
3. **Any behavioural evidence** that the hosted node holds and answers records at all.

## The two plants that stayed GREEN, which is the phase's real result

Criterion 1 named two plants. Both were run against a write-then-read through the object and
**both left it green.**

- **`peerInfoMapper`.** Replacing `passthroughMapper` with the library default changed nothing
  observable, because both peers are directly connected to the object and the object answers
  from its own store. No routing table is consulted. The arrangement that sees the mapper is
  one where the object must answer *about a third peer*: `findPeer` for a holder announcing
  only `127.0.0.1`. There the default mapper turns it red — `NotFoundError: Not found` — and
  that case now exists.

- **`selectors`.** Measured against the library rather than argued: `bestRecord` is called from
  exactly one place, `@libp2p/kad-dht/dist/src/content-fetching/index.js:170`, inside the
  **querying** node's own `getValue`. No RPC handler calls it. So the hosted node's selectors
  govern reads the hosted node *performs*, never reads performed *through* it, and the plant
  the criterion describes cannot redden that arrangement at all. `MissingSelectorError` is now
  watched where it actually arises — at a reader that registered none — and the error is not
  swallowed: `content-fetching` rethrows unless `err.name === 'InvalidParametersError'`, and
  this one's name is `MissingSelectorError` (`dist/src/errors.js:25`).

Both are corrections to the criterion, made against a measurement. Neither narrows what counts
as passing: the mechanisms are still proved, at the node they belong to.

## A third false green, caught by one probe

The first version of the read-back case used a **fixed** seed. `wrangler dev` persists Durable
Object storage under `.wrangler/state`, so a record from an earlier run was still there. A
probe that **skipped the `put` entirely** still got a `VALUE` back — an older run's record
under the same key. The byte-exact assertion caught it (`issuedAt` differed); a
`toBeDefined()` would not have. Every run now uses a fresh random key.

## What the read-back case actually proves, and why the writer is stopped

Two peers, each dialling only the object and never each other. Peer A publishes; **A is then
stopped**; B reads the same bytes back. Stopping A is what makes *through the hosted node* a
reading rather than a hope — kad-dht is iterative, so with both peers up B can learn A from the
object's routing table and fetch from A directly, and the case would pass with the object
storing nothing at all.

**Not proved: that the writer is a browser**, which is criterion 1's own word. These are Node
peers over WebSockets. Recorded as the criterion's open half.

## HOST-09 — the floor, and where the hot loop actually is

`arm()`'s `getAlarm()` check answers *is one pending*. It says nothing about how far ahead the
next one is set, and the path that would run hot is not `arm()`: `run()`'s `finally` sets
unconditionally, because the platform clears the alarm before calling the handler. So a sweep
handed a tiny interval re-arms at that interval on every firing, on an object nobody is
watching, with no hard spending ceiling behind it.

`MIN_RESCHEDULE_INTERVAL_MS` is 60 s and the number is derived: an alarm firing every `f` ms
costs `3_600_000 / f` invocations an hour, so the floor caps a runaway at 60 an hour instead of
unbounded, against the 4 an hour `providerRecordPolicy` actually asks for. It is fifteen times
tighter than the real schedule, so it is inert on every path this tier takes.

The clamp is on `intervalMs` — the one reading both paths take — and not at the two `setAlarm`
call sites, because a clamp at a call site is a clamp the third call site is written without.

**HOST-09's letter says "`getAlarm()` before every `setAlarm()`" and the re-arm does not
check.** That is stated in the code rather than left for a verifier to find: on that path the
platform has already cleared the alarm, so there is nothing to push forward and the check has
no subject. Adding it would read as compliance and measure nothing.

## HOST-04 — the omission, and the route not taken

`hostedCapabilities()` signs `features: []` and `sovereignFor: []` as literals. Plants: one
engine feature, one sovereign key — each watched red, each restored `cmp`-clean.

The **stronger** form would have the scheduler *refuse* this tier rather than merely not learn
of it: a **critical** `CapabilityExtension` is refused by name on every existing reader with no
core change. It is not taken, and the reason is checkable rather than aesthetic — the first
production extension producer reddens `packages/node/src/extension-sequencing.node.test.ts`
unless `DiscoveryOptions.understands` gains a production caller, and **not wiring that is a
recorded owner ruling of 2026-08-11**. The requirement's own words settle it: *the requirement
is the omission, not a workaround for the refusal.*

**The granularity is stated rather than implied.** The hosted node holds no certificate, and
`NodeRecords` requires one beside the capabilities, so this tier publishes no records at all
today — HOST-04's *published* half is satisfied by an absence. The guard is over the producer,
written ahead of its caller on purpose: the moment to fix what a record claims is before the
first one leaves. `cloudflare/hostedCapabilities` is therefore registered as unreachable, with
its reason, and it is the first row on this tier whose closing condition is **not** a deploy.

## HOST-14 — "records the fabric actually wrote"

That clause is the whole difference from `dht-record-sweep.test.ts`, which seeds a store by
hand. Here `kadDHT()`'s own `put` does the writing: its first act is a local store
(`content-fetching/index.js:100-107`), so the bytes, the `/dht/record` prefix and the key
derivation are the library's. The sweep deletes one millisecond past `capabilities.expiresAt`
and an anti-vacuity case one millisecond before keeps it — same record, one variable. Planted
by making the sweep's decision constant-`keep`; watched red, restored `cmp`-clean.

**A second measurement fell out of it.** `put` never returns on a node with an empty routing
table, because it pipes `getClosestPeers` after the local store — the same reading taken on
2026-08-23 on two server-mode nodes, reproduced here as a 30 s test timeout and bounded with an
abort. The abort is not a way around the subject: the local store has already happened.

## What is open

- **Criterion 2** — a provider record published at T and gone at T + validity, **observed on
  the deployed object**. Nothing here was taken on a deployed object. `HOST-13` carries the
  same gap and is `Partial`, in the re-read register as `entry-point-not-driven`, because the
  open leg contains no symbol and no caller: every entry point on this tier is invoked by the
  Workers runtime and by nothing in this repository.
- **Criterion 1's word *browser*.**

## Verification

```
npx vitest run --project node   → see 31-01 commit message for the counts
npx vitest run --project e2e    → hosted-record-store.e2e.test.ts 3/3
npx tsc --noEmit -p packages/cloudflare → exit 0
```
