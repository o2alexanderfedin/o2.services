---
id: 260823-fkf
slug: wire-dht-registration-and-discovery
date: 2026-08-23
mode: quick
status: in-progress
---

# Wire the DHT into registration and discovery

## What was measured before planning

`@libp2p/kad-dht@16.4.0` is installed, pinned exactly in three workspace manifests, and
`kadDHT()` is constructed on both tiers (`fabric-node.ts:1979`, `browser-node.ts:1430`) on
the private protocol `/o2/kad/1.0.0` with `o2RecordValidator` registered. The docs claim
*"NOT INSTALLED — no DHT exists in this repository today"* is stale and already carries a
SUPERSEDED note in `CLAUDE.md`. **That is not the work.** What is missing is that nothing
uses it:

1. ~~**`publishRecords` has zero production callers.**~~ **WRONG, corrected 2026-08-23
   during execution, and the correction is kept rather than deleted because the wrong
   reading is what shaped this plan.** The grep that produced it searched
   `publishNodeRecords|o2RecordValidator|PublishOutcome` and never searched the symbol
   itself. `publishRecords` *is* called from both factories — `fabric-node.ts:2806` and
   `browser-node.ts:2175` — **once, at start, fire-and-forget**. What is true is narrower
   and was found by measurement rather than by grep: that one-shot could not reach a peer
   that arrives after it resolves, which is every peer but the first.
2. **`.recordIndex` occurs exactly twice repo-wide, both assignments**
   (`fabric-node.ts:1633`, `browser-node.ts:1152`). The composed `DhtRecordIndex` has no
   reader. `discoverCandidates` builds its own bare `RpcRecordIndex` at
   `discover-candidates.ts:194` with no field to hand it one.
3. **Nothing calls `dht.provide`**, so the DHT leg of `providers()` is permanently empty.

**Two defects found only by running it, neither of which any grep would have shown, and
both of which made the keyspace inert regardless of who called what:**

4. **`peerInfoMapper` was left at its default, `removePrivateAddressesMapper`**
   (`kad-dht/src/kad-dht.ts:179`), and `onPeerConnect` drops a peer left with no addresses
   after mapping (`:403-406`). Measured on two loopback nodes: both in `server` mode, both
   advertising `/o2/kad/1.0.0`, identify complete, each holding the other as a peer — and a
   `put` yielding **no events at all** while `getClosestPeers` never returned. The routing
   tables were empty because every address was private. That default is right for Amino and
   wrong for a private keyspace whose peers are on loopback, on a LAN, and behind relays.
5. **No `selectors` entry for the `o2` namespace.** `bestRecord` throws
   `MissingSelectorError` for an unknown namespace (`record/selectors.ts:23-25`), so the
   keyspace accepted every write and errored on **every read** — swallowed by
   `DhtRecordIndex`'s own catch and presenting as *"the DHT holds nothing"*.

## Owner ruling taken during planning

Provider announcement was scoped out and then ruled **in** by the owner mid-task:
*"ensure анонс провайдеров is implemented and wired correctly"*. It is therefore Task 3.

## Tasks

### Task 1 — Registration: publish this node's records into the keyspace

- **files**: `packages/libp2p/src/dht-registration.ts`, `packages/node/src/fabric-node.ts`,
  `packages/browser/src/browser-node.ts`
- **action**: A `RecordPublisher` that puts this node's `NodeRecords` under `/o2/<nodeKey>`
  at start and again when a peer arrives. `kad-dht`'s `put` stores locally and *then* walks
  to the closest peers, so a start-time put on an empty routing table reaches nobody and
  still reports success — the outcome therefore counts `PEER_RESPONSE` events so
  "published to N peers" is a number rather than an absence of an exception. Non-fatal by
  design: publishing is something a node does on the way up, and a start path that aborted
  here would make the DHT a hard dependency of booting.
- **verify**: unit test over a fake `KadDHT`; the two node factories construct it from the
  identical expression.
- **done**: a started node holding a certificate has its records in the keyspace.

### Task 2 — Discovery: give `discoverCandidates` the composed index

- **files**: `packages/net/src/discover-candidates.ts`, `packages/node/src/bin/agent.ts`,
  `packages/node/src/bin/bench.ts`, `packages/browser/demo/main.ts`
- **action**: a required named option `index: RecordIndex | 'asks-connected-peers-only'`,
  following the repo idiom (`recordsFallback: RecordIndex | 'answers-from-the-dht-alone'`).
  The sentinel builds today's bare `RpcRecordIndex`, so no existing behaviour is a default
  somebody omitted. Both node factories pass their composed `DhtRecordIndex`.
- **verify**: `serve-agent-hooks.node.test.ts:802` asserts `occurrences(BENCH, 'await
  discoverCandidates(') === 1` — the call shape changes, the count must not.
- **done**: `.recordIndex` has a reader on both tiers.

### Task 3 — Provider announcement, swept rather than announced on put

- **files**: `packages/libp2p/src/dht-provider-announcer.ts` (new), both node factories
- **action**: **Announce-on-put is unsound in this repository and the reason is a measured
  ordering, not a preference.** `submit.ts:2664` does `blockstore.put(encoded.bytes)` and
  marks the CID sovereign on the *next line* (`:2671`). A decorator announcing inside `put`
  would therefore publish a sovereign block's provider record microseconds before anything
  recorded it as sovereign — the exact side channel `withholdingFrom`'s docblock exists to
  close (*"a node never advertises a block its own `block` branch would refuse to serve"*).
  So the store decorator **records the CID and announces nothing**, and a sweep asks the
  withholding predicate per CID before announcing — which is the same "consulted per
  lookup" property `SelfRecordIndex` is built on, at sweep granularity. A CID whose
  predicate has turned true is retracted with `cancelReprovide`.
- **residual, named rather than left to be found**: retraction stops *future* republishing;
  a provider record already replicated to other peers lives until `PROVIDERS_VALIDITY`
  (48 h, `node_modules/@libp2p/kad-dht/src/constants.ts:12`). A block that was public when
  swept and became sovereign afterwards stays discoverable-as-provided until then. The
  common path — put and mark inside one `submitJob` call — is fully closed, because the
  sweep is not the put.
- **done**: `findProviders` can answer non-empty, and never for a withheld block.

### Task 4 — Proof

- **files**: `packages/node/src/dht-registration.node.test.ts` (new)
- **action**: two in-process `FabricNode`s. A publishes; B reads through a
  `DhtRecordIndex` built with `recordsFallback: 'answers-from-the-dht-alone'` — the
  sentinel exists precisely so a case can prove the DHT carried the answer with no RPC
  fallback in the frame — and gets A's records back.
- **verify**: `npx vitest run --project node`, exit code read directly on the next line.
- **done**: the record travelled over the DHT, and a planted mutation reddens it.

### Task 5 — Documents

- **files**: `CLAUDE.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`
- **action**: the `NET-06` row asserts *".recordIndex occurs exactly twice repo-wide, both
  assignments"* and `requirements-ledger.node.test.ts:1343-1348` carries the same claim;
  `attestation-ui.e2e.test.ts:1198` says *"It does not read the DHT"*. Wiring a reader
  falsifies all three — they are corrected in the same change rather than left to be found.

## Guards this change is expected to move

- `packages/node/src/requirements-ledger.node.test.ts` (NET-06 wording)
- `packages/node/src/serve-agent-hooks.node.test.ts:802` (bench call count)
- `packages/node/src/attestation-ui.e2e.test.ts:1198` (does-not-read-the-DHT)
- `packages/node/src/mutation-ledger.ts:1458` (`withholdingFrom(egressDisposition),` find-string)
