---
id: 260823-fkf
slug: wire-dht-registration-and-discovery
date: 2026-08-23
status: complete
---

# The DHT is used for registration and discovery

## The headline, and it is not the one the task started from

The task began from a stale doc claim — *"`@libp2p/kad-dht` NOT INSTALLED — no DHT exists in
this repository today"* — which `CLAUDE.md` already carried a SUPERSEDED note against. That
was never the work. The work turned out to be that **the DHT was installed, constructed,
protocol-isolated, validated, and completely inert**, and that two of the four reasons were
settings rather than missing code and could only be found by running it.

### What a grep found

1. **`.recordIndex` had no reader.** It occurred exactly twice repo-wide, both assignments.
   `discoverCandidates` built its own bare `RpcRecordIndex` internally with no field to hand
   it one, so the composed `DhtRecordIndex` both tiers build was never consulted by anything.
2. **`dht.provide` was called nowhere**, so the DHT half of `DhtRecordIndex.providers` was
   empty by construction.

### What only running it found

3. **`peerInfoMapper` was left at its Amino default.** `kad-dht` defaults it to
   `removePrivateAddressesMapper` (`src/kad-dht.ts:179`) and `onPeerConnect` drops a peer
   left with no addresses after mapping (`:403-406`). Measured on two loopback nodes: both
   in `server` mode, both advertising `/o2/kad/1.0.0`, identify complete, each holding the
   other as a peer — and `put` yielded **no events at all** while `getClosestPeers` never
   returned. **Every routing table in the fabric was empty**, on loopback, on a LAN, and
   behind a relay. Both tiers now pass `passthroughMapper`: membership of `/o2/kad/1.0.0` is
   decided by a certificate, not by address class.
4. **`validators` was registered and `selectors` was not.** `bestRecord` throws
   `MissingSelectorError` for an unknown namespace (`record/selectors.ts:23-25`), so the
   keyspace accepted every write and errored on **every read** — swallowed by
   `DhtRecordIndex`'s own query catch and presenting as *"the DHT holds nothing"*. Both tiers
   now register `o2RecordSelector`, which prefers the freshest capability record.

**A private DHT needs four settings, not two**: `protocol`, `clientMode`, `peerInfoMapper`,
`selectors`. Two of them were missing and nothing said so.

## A claim this task made and had to withdraw

The plan opened with *"`publishRecords` has zero production callers"*. **That was wrong.** The
grep behind it searched `publishNodeRecords|o2RecordValidator|PublishOutcome` and never
searched the symbol. Both factories called it — once, at start, fire-and-forget. The
correction is recorded in the plan rather than deleted, because the wrong reading is what
shaped the plan.

What is true is narrower and was found by measurement: a one-shot put cannot reach a peer
that arrives after it resolves. It is **not** true that it "reached nobody" — a `put` against
an empty routing table does not fail, it *waits*, because kad's `getClosestPeers` blocks
rather than answering `[]`. So the one-shot covered a node's first peer and only its first.

## What changed

- **`RecordPublisher`** (`packages/libp2p/src/dht-registration.ts`) publishes at start and
  again on every `peer:identify`, collapsing a burst of arrivals onto one in-flight put plus
  at most one follow-up. `peer:identify` and not `peer:connect`: kad populates its routing
  table through a topology registered on the DHT protocol, which fires once identify has said
  what the peer speaks.
- **`PublishOutcome.published` carries `peers`**, counted from `PEER_RESPONSE`. The old shape
  could not distinguish *published* from *did not throw*, which is exactly how a put that
  reached nobody read as a successful registration. Exposed as `registrationPeers` on both
  node classes.
- **`DhtProviderAnnouncer` + `ObservingBlockstore`**
  (`packages/libp2p/src/dht-provider-announcer.ts`) — provider announcement, under the owner
  ruling of 2026-08-23. It deliberately does not announce inside `Blockstore.put`; a sweep
  asks `withholdingFrom`'s predicate per CID first, and retracts with `cancelReprovide` what
  has since turned sovereign. It sweeps on peer arrival *and* on a collapsed microtask after
  a put, because a requestor connects first and stores its blocks afterwards.
- **`submit.ts` marks a shard sovereign before it puts the bytes.** It was `put` then `add`,
  which left a window one `await` wide in which a sovereign block was resident and nothing
  recorded it as sovereign. Nothing read that window while `providers` was answered at ask
  time; a provider record is the first thing that reads the store's *arrivals*. Reversing it
  closes the window at its source. The reversed failure is the harmless one — a CID marked
  sovereign that the node does not hold is never advertised and never served, because
  `SelfRecordIndex.providers` checks `store.has` first.
- **`CandidateOptions.index`** — required, `RecordIndex | 'asks-connected-peers-only'`. The
  sentinel builds exactly the `RpcRecordIndex(rpc, peers)` the function always built, so no
  existing behaviour became a default somebody omitted. `bin/agent.ts` and `demo/main.ts`
  pass their composed index; `bin/bench.ts` keeps the sentinel with a stated reason (its
  requestor is a hand-assembled endpoint over the memory network, not a `FabricNode`).

## The proof, and the two fixtures that were discarded

`packages/node/src/dht-registration.node.test.ts` reads across two real nodes through an index
built with `recordsFallback: 'answers-from-the-dht-alone'` — **no non-DHT path is in the
frame**.

**Two earlier fixtures passed and were thrown away, because a planted `'publishes-once'` left
both green.** A proof that cannot fail is not a proof, and this is what that rule caught:

1. *Enrol alpha, dial beta, read.* Enrolment dials the provider, so alpha starts with a peer
   and the one-shot lands on it.
2. *Restart alpha alone, then let beta arrive.* Also green — the one-shot simply blocks on the
   empty table until the first peer arrives, then completes.

The surviving case reads the record **after alpha and the provider have both stopped**, so
whatever beta answers, the keyspace put there while they were up. Three plants watched red:

| Plant | Observed |
|-------|----------|
| `publisher.start(onPeerArrival)` → `'publishes-once'` | `the keyspace held nothing for alpha once its publisher had gone: expected undefined to be defined` |
| `dht.provide` → `dht.getClosestPeers` in the announcer | `expected [] to include '68a0e13a…'` |
| `selectors` entry removed from `fabric-node.ts` | `the keyspace held nothing for alpha once its publisher had gone` |

Each restored by the surgical inverse of the plant, `cmp` against a pre-plant snapshot exit 0.

## Open decision, left to the owner rather than decided here

**A provider record already replicated survives retraction.** `cancelReprovide` stops this
node republishing; it does not un-tell the peers that stored the record, and those copies live
until `PROVIDERS_VALIDITY` — 48 h. So a block that was public when swept and becomes sovereign
afterwards stays discoverable-as-provided for up to that long. The common path — put and mark
inside one `submitJob` call — is closed. This residual is a property of announcing into a
distributed store at all, and it is the cost the ruling that asked for provider announcement
buys. Shortening `providers.validity` would trade it against normal operation and was not
taken unilaterally.

## Not done, and named

- **No periodic republish.** Registration republishes on peer arrival only. `kad-dht`
  republishes *provider* records itself (`reprovider.ts`) but not `put` values, so a fabric
  whose peer set is stable for longer than a record's lifetime would want a timer. Nothing
  here is timed, deliberately; this is the next thing to add if a long-running deployment
  shows records ageing out.
- **`features: []` is still honest rather than a stub** — `wasm-feature-detect` remains
  uninstalled, unchanged by this task.
