# Phase 18 — Discovery, Capacity & Placement — CONTEXT

**Written 2026-08-01, before any plan exists.** Every `file:line` below was read from source
during the discuss step, not copied from a planning document. Where a planning document was
found to be wrong, that is called out rather than quietly corrected.

---

## The finding that changes this phase's shape

**Criterion 1 cannot be met by wiring. Half its mechanism does not exist.**

`discoverExecutors` (`packages/core/src/discovery.ts:237-296`) intersects two lookups on the
`RecordIndex` port (`core/src/discovery.ts:137-142`):

| Half | Production state |
|---|---|
| `recordsFor(nodeKey)` — signed certificate + capability record | **Live.** Both tiers publish: `fabric-node.ts:630`, `browser-node.ts:450`, handed to `serveAgent` as `index:` at `fabric-node.ts:1278` / `browser-node.ts:988` |
| `providers(cid)` — who holds this block | **Empty, always.** `MemoryRecordIndex.provide()` (`core/src/discovery.ts:363-368`) has **zero callers outside tests** anywhere in the repo |

`fabric-node.ts:1272-1274` states it in its own comment: *"`providers` still answers `[]`,
because `provide()` is never called."* `packages/net/src/discovery.test.ts:157` hand-calls
`index.provide(inputCid, nodeKey)` in its fixture — which is why the discovery tests pass
over a mechanism production does not have. **A plan that says "wire up `discoverExecutors`"
is planning against the fixture, not against the node.**

## Three more measured facts that reorder the work

1. **`bin/agent.ts` has no flag that dials a peer.** Eleven flags parsed at
   `bin/agent.ts:52-180`; `--provider-addr` (`:108`) is a **one-shot enrollment dial**
   (`fabric-node.ts:537`) and establishes no ongoing peering. A node started by this binary
   has zero peers. **So criterion 2d is a prerequisite for criterion 1, not a sibling** — with
   no peers, there is nobody to ask for providers or records, and criterion 1's "no static
   peer list" run cannot happen at all.

2. **`DutyCycleGovernor` has zero production callers** (`core/src/governor.ts:29-60`; only
   `governor.test.ts` constructs it). `FabricNode` composes **no governor** — its stack is
   `CountingExecutor(guardSovereignty(provenance(compute), sovereignty))`
   (`fabric-node.ts:1202`). The browser tier composes `VisibilityGovernor`
   (`browser-node.ts:804-808`, `:884`), a *different* class whose `dutyCycle` is a getter
   driven by `visibilitychange` (`visibility-governor.ts:100-114`) with **no external
   setter**. Criterion 3 ("user-set at runtime … both tiers … honoured immediately") is
   therefore **new construction on both tiers**, not wiring.

3. **The production placement path is not the offer machinery.** `runResilient`
   (`coordinator.ts:304`) has **zero callers outside tests**, and it is the only production
   path to `placeWithOffers` (`coordinator.ts:376`). `planWithOffers` (`placement.ts:217`)
   has **zero callers through any path**. Production `submitJob` places via `planPlacement`
   from `sovereignty.ts` (`core/src/job/submit.ts:24,219`). `admission.node.test.ts:274-279`
   says so outright. So criterion 2 is a change to the submit path, not a hook-up.

`ReservationWatcher` (`reservation-watch.ts:96-190`) is constructed only in tests;
`bin/seed.ts` does not install one (`bin/seed.ts:43-49`), and `FabricNode` only *accepts* one
as an option (`fabric-node.ts:408`, consumed `:963-965`). Criterion 4 is wiring.

---

## Owner rulings, 2026-08-01

### D1 — Content routing: each node answers `providers(cid)` from its own blockstore

A node is **authoritative about what it holds**, so the answer is computed at ask time from
the store rather than replicated in advance. `RecordIndex` is an interface and
`MemoryRecordIndex` is only one implementation, so this needs no port change and **no new
wire frame** — the `providers` request already exists and is already served.

Two consequences a plan must carry:

- **`RpcRecordIndex.providers` must merge across peers.** Today it returns the *first
  non-empty* answer (`packages/net/src/discovery.ts:44-51`). With every node answering only
  for itself, first-non-empty finds exactly one provider and power-of-d sampling has nothing
  to sample. It must union across all peers asked.
- **The reach is directly-connected peers only.** No transitive routing, no DHT. That is the
  fabric's existing shape rather than a new restriction — but it must be *stated* in the
  requirement's status, not implied, and it is the honest limit of what criterion 1 proves.

Rejected: announce-on-write (adds a wire frame, adds staleness — a node that evicts a block
still reads as a provider — and lets an unverified peer grow your map without bound, needing
its own cap); delegated HTTP routing via Helia (this repo depends on Helia nowhere today; a
public router returns IPFS PeerIds that carry neither a certificate nor a capability record,
so its answers cannot feed `discoverExecutors` without a second lookup anyway — **and Phase
21's open question already owns whether Helia enters this repo at all**).

### D2 — Criterion 2c: publish the slot count in the `offer` response

The offer answer gains what the node can run at once and what it is running now; the
requestor bounds **its own** placement across shards. Reserves nothing, so there is no
reservation to leak and no expiry to manage.

**This is advisory and must be described as advisory.** A dishonest requestor can still
over-commit — but the authoritative bound never moved: SCHED-06 (closed by Phase 13.1) makes
the `exec` branch refuse for real (`agent.ts:729-730`, `capacity.offer(...)` reserving, with
`release` in a `finally` at `:817`). What D2 removes is wasted round trips, not the bound.

Rejected: carrying a shard id on `exec` so an offer reservation can be redeemed. That is
precisely what Phase 13.1 **removed**, for a reason recorded at `agent.ts:616-652` — an offer
reservation had no release anywhere on the wire, and the demo's liveness probe
(`{kind:'offer', shardId:'probe'}` on every `computePeers()` call) leaked one slot per peer
per call, permanently. Restoring it needs a reservation expiry, a wall-clock bound inside
admission, and a way to tell a probe from a real offer — three new things where D2 needs one
field.

### D3 — the re-ask policy (criterion 6) is already closed

Landed 2026-08-01 on `develop` (`351bde1`) ahead of this phase being planned.
`PeerVerifier` splits `PeerFailure` into refusals that can change and refusals that cannot,
and refreshes the retryable ones lazily from `verifiedPeers`. Ledger entries M33/M34/M35.
**Criterion 6 needs no plan** — it needs a verifier to confirm it, nothing more.

---

## Standing constraints that bind this phase specifically

- **ALL NODES HAVE EQUAL FUNCTIONALITY. The only difference is discovery.** Phases 16 and 17
  each shipped a violation and neither was caught in-process. Criterion 3 touches both tiers
  and D1 touches both tiers — if any decision here keys on node kind, it is wrong. Grep for
  the mechanism, never the vocabulary.
- **`packages/net/src/discovery.test.ts:352`** — *"no longer bounds anything across shards —
  four land on one 1-slot node"* — pins the current over-commit as a recorded consequence
  (four shards, `[only, only, only, only]` at `:384-389`, zero rejections at `:390`,
  `peakInFlight` 0 at `:395`). **It is expected to turn red when 2c lands.** Rewrite it to
  assert the new bound; do not delete it and do not "fix" it early.
- **An optional hook with a silent default is a hole.** Options take `T | '<named-absence>'`.
- **Vocabulary discipline** — read the `BANNED` array from `vocabulary.node.test.ts`; never
  enumerate it in prose. It reads working-tree content of tracked files.
- **Run vitest by project** (`node` / `browser` / `e2e` / `perf`), never by bare path.
- **Assume every `file:line` in an unexecuted plan is stale.** Phase 15's four plans carried
  41 wrong citations. Re-read before relying on one.
- **Plant every reddening claim; never restate one.** Roughly a quarter of them are wrong.
- **A `wave` field can lie where `depends_on` cannot.** Derive waves from `depends_on` *and*
  `files_modified` overlap.

## Ordering this phase's own work

Measured from the facts above, not asserted:

1. **2d (dial flag) first.** Nothing else can be exercised through `bin/agent.ts` until a
   spawned node can be told about a peer.
2. **D1 (provider answering + merge) next.** Criterion 1 depends on it and on 2d.
3. **2 / 2b / 2c (placement + admission)** after discovery can return more than one candidate
   — power-of-d has nothing to sample otherwise.
4. **3 (governor), 4 (ReservationWatcher), 5 (sovereignty before cost)** are independent of
   each other and of the chain above.
5. **6** is closed; it needs verification only.

## Open question for the planner to resolve against source, not assume

Criterion 2 requires offer-based placement on the path a real job takes, but production
`submitJob` uses `planPlacement` (`sovereignty.ts`). Whether that path is **replaced** by
`planWithOffers` or **composed** with it is a design decision, and criterion 5 constrains it:
sovereignty must be filtered *before* cost is scored, never scored against it. `placement.ts`
already contains a sovereignty gate — read it and determine which arrangement preserves
criterion 5 rather than choosing by preference. State the answer in the plan with citations.
