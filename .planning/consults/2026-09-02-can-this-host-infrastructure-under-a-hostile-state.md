# Can this platform host protected infrastructure built by people, for people, under a hostile state?

**Asked by the owner 2026-09-02**, after a first answer conflated *platform* with *application*
and was corrected. The correction is accepted and this document is written on the owner's
framing: o2 is a platform, and the question is what can be **built on** it.

Written in English because every document under `.planning/` is, and CI greps them.

The answer has four parts, and only the last one is bad news.

- **As a hosting model**, the unit is a pure WASM function. None of the four application
  classes fits that unit as it stands.
- **As a substrate** — `@o2/net` used as a library rather than through job submission — three
  of the four are much closer than the hosting model suggests, and one is structurally out.
- **Encryption at rest is necessary and not sufficient**, and the reason is in this project's
  own DATA-09.
- **The blocking issue is not any of the above.** It is that participation is attributable by
  construction, and that is a deliberate load-bearing property, not an oversight.

---

## 1. Two layers, and the question lands differently on each

### 1.1 What the platform hosts today

The unit of hosted code is a WebAssembly module with a fixed entry point
(`TASK_ENTRYPOINT`, `packages/core/src/executor/wasm.ts`), invoked as a **pure function over
content-addressed input**: `(module CID, input CIDs, partition index) → output`. It gets a
virtualised deterministic WASI — fixed clock, seeded PRNG, no filesystem, no sockets — because
determinism is the property redundant execution is built on.

That model excludes, by construction and not by omission: long-lived processes, inbound
connections, sessions, presence, timers, and any I/O the host did not hand in as a CID.

So on the hosting model alone, the honest answer to *messenger / storage / publishing /
Tor-like* is **none of them**. But that is not the whole platform.

### 1.2 What the substrate already provides

Three wire protocols exist, and that is the complete list:

| Protocol | Where | What it carries |
|---|---|---|
| `/o2/rpc/1.0.0` | `packages/libp2p/src/libp2p-transport.ts:104` | every fabric verb |
| `/o2/kad/1.0.0` | `packages/libp2p/src/dht-record-index.ts:78` | the private DHT keyspace |
| `/o2/relay/1.0.0` | `packages/libp2p/src/relay-service.ts:41` | relay service accounting |

Underneath them there are four primitives an application layer could genuinely stand on:

1. **Content-addressed block exchange between peers, CID-verified.** `FetchingBlockstore` +
   `RpcBlockSource` (`packages/net/src/block.ts`) pull a block from a peer by CID and check the
   bytes hash to the CID that was asked for — *"content addressing is only a security property
   if it is actually checked"*. Concurrent requests for one CID collapse into one fetch.
   **A previous answer said this repository has no file storage. That was wrong** — what it
   lacks is durability, not the exchange. (Note this is hand-rolled over o2's own RPC: neither
   Helia nor `blockstore-idb`/`blockstore-fs` is installed, contrary to `CLAUDE.md`'s stack
   table. Only `datastore-core` and `interface-datastore` are present, transitively.)
2. **Provider discovery.** `dht-provider-announcer.ts` announces the CIDs a node holds into the
   private keyspace, behind a withholding predicate, so *who has this block* is answerable.
3. **Signed, monotonic naming.** `packages/core/src/naming.ts` resolves `key → CID` from records
   signed by pinned anchors, with per-name monotonic versions to refuse rollback. This is an
   IPNS-shaped mutable-pointer layer and it already exists.
4. **A capability chain rooted at an owner key** (`packages/core/src/capability.ts`) with
   `execute`/`read`/`delegate`, verified before instantiation — an authorisation layer an
   application can reuse rather than reinvent.

---

## 2. The four classes, and the actual distance to each

### Publishing platform — **closest; largely reachable today**

Signed name → CID → CID-verified block fetch → provider discovery is the whole of a
censorship-resistant publishing stack, and all four pieces are in the tree. Rollback is already
refused (threat model, attacker 5). What is missing is durability and a reader UI, not
mechanism.

*Estimate: 1 phase (~8 tasks) for a reader path plus a pinning policy.*

### File storage — **pull side exists, durability does not**

A node can fetch any block by CID and verify it. Nothing in the repository pins, replicates on
a policy, or guarantees a block survives — IndexedDB is evicted silently under storage pressure
(`CLAUDE.md`, DHT reality check) and there is no replication factor anywhere. Storage that
cannot promise the bytes are still there is a cache.

*Estimate: 1–2 phases (~12 tasks): a pinning/replication policy, a durability measurement, and
an eviction-survival criterion.*

### Messenger — **no delivery primitive**

There is no pub/sub: `@libp2p/gossipsub` is **not installed** and appears nowhere in
`packages/`, despite being recommended in `CLAUDE.md`'s stack table. DHT records expire by an
alarm-driven sweep (`dht-record-sweep.ts`), so they are not a mailbox. Delivery to an offline
peer, ordering, and presence have no home. The pieces to build one exist (RPC, DHT, capability
chain), which makes this a build, not a port.

*Estimate: 1 phase (~8 tasks) to install and wire pub/sub; a real messenger is an application
project on top of that, not a phase.*

### Tor-like service — **structurally out, and this is the one hard no**

Three independent reasons, each sufficient:

- **The verb set is closed.** `AgentRequest` is a fixed union of twelve kinds
  (`packages/net/src/protocol.ts:102-191`): `exec`, `commit`, `reveal`, `block`, `providers`,
  `records`, `offer`, `reservations`, `report`, `combine`, `enrol`, `enrol-challenge`. **There
  is no forwarding verb and no seam to add one.** (`CapabilityExtension` in `discovery.ts` is a
  forward-compatible seam for *capability records*, not for protocol verbs — it solves a
  signature-recomputation defect, not extensibility of the wire.)
- **Circuit Relay v2 is single-hop and non-private.** The relay sees both PeerIds by protocol
  necessity, and this project's own documents call it a signalling channel rather than a data
  path.
- **Onion routing is a different protocol stack**, not a feature: layered encryption, circuit
  construction, guard selection, a directory system, and traffic padding. None of it composes
  onto a request/response job protocol.

*Estimate: not a phase. A separate protocol stack, and a separate project.*

### The gate for "general platform"

The single thing that converts o2 from *a fabric that runs functions* into *a platform that
hosts applications* is **an application-registered protocol seam**: a way for an application to
add a verb (or its own libp2p protocol) without editing `@o2/net`. Today that union is closed,
which is a defensible security decision — every admitted verb is a surface — but it is also
exactly what "platform" means and it is not there yet.

*Estimate: 1 phase (~10 tasks): a namespaced extension kind, an authorisation rule for who may
register one, and a refusal path that names the unknown verb rather than dropping it.*

---

## 3. Does at-rest encryption solve the data problem?

**It closes one attack and leaves five open. Necessary, not sufficient.**

What it closes: a **powered-off, locked** device that is seized yields ciphertext instead of the
owner's data and the node's identity. Today it yields both — see §4.1.

What it does not touch:

1. **Execution requires plaintext.** This is DATA-09 turned around and pointed at the owner:
   *"executing requires decryption, which would expose plaintext to a non-owner node."* The
   same physics applies to the owner's own tab — a node that is computing is holding the
   cleartext in memory. A device seized while running, or unlocked under compulsion, is not
   protected by any at-rest scheme.
2. **The IP address.** Encryption says nothing about who saw you connect.
3. **The membership record.** A certificate binds `nodeKey ↔ userKey` and names its provider;
   encrypting the local copy does not un-issue it.
4. **The signed egress manifest** (`packages/net/src/egress.ts:32-45`) records `to` and `bytes`
   and is signed *to make it attributable*. That is an accountability feature and, in this
   threat model, an evidence artifact.
5. **Traffic analysis**, declared out of scope in `.planning/THREAT-MODEL.md:157`.

One implementation note that decides the shape. The visitor's owner key is already safe by a
better mechanism than encryption: it is generated non-extractable
(`packages/browser/src/visitor-key.ts:134`), so `exportKey` fails and the private half never
leaves the browser. **The node seed cannot use that mechanism** — libp2p needs the raw Ed25519
bytes for the Noise handshake and for signing — so for the seed, at-rest encryption is not one
option among several; it is the only one.

---

## 4. The safety gaps, and what closing them costs

Effort is given in this repository's own unit — plans and tasks, by analogy to phases already
planned (Phase 35 = 8 tasks, Phase 36 = 10 tasks). These are **estimates**, not measurements.

### 4.1 Node seed stored in the clear — *scheduled as a phase*

Both tiers persist a raw 32-byte Ed25519 seed:

- Browser: `packages/browser/src/idb-identity-store.ts:95` and `:138` — `put(STORE, seed,
  SEED_KEY)` into IndexedDB, no encryption, no passphrase. Also the provider key (`:161`,
  `:172`) and the certificate (`:188`).
- Node: `packages/node/src/identity-store.ts:67-86`, a raw file, protected by filesystem mode
  only — which does nothing against a seized or imaged disk.

Argon2id appears in the design and **only in a comment**
(`packages/node/src/capability-fixture.ts:18`); it is not implemented anywhere.

*Estimate: 1 phase, ~8 tasks. Added to the v2.0 roadmap as Phase 42 / **AUTH-06**.*

### 4.2 Peer IP exposure — *partly addressable inside Phase 34*

WebRTC is the only browser↔browser transport and ICE hands each peer the other's candidates.
No `iceTransportPolicy` is set anywhere; TURN is not yet configured (the credential is still an
open item in `.planning/OWNER-ACTIONS.md`). Forcing `iceTransportPolicy: 'relay'` keeps peers
from learning each other's addresses, at the price of paying for all traffic and moving the
knowledge to the TURN operator — the same trade Tor makes and states.

*Estimate: ~3 tasks, inside Phase 34, which already brings TURN up.*

### 4.3 The halt directive is unauthenticated at the client

`AdmissionDirective` (`packages/libp2p/src/admission-directive.ts`) carries no signature and
`packages/browser/src/kill-switch.ts` verifies none — the tab believes the endpoint it dials.
The write side is protected by an operator secret (`O2_ADMISSION_KEY`, `worker.ts:183`), so this
is not open to anyone, and the client **fails open**: `halted()` is `false` before the first
successful read and a failed poll never induces a halt. Blocking the endpoint therefore cannot
stop a fabric that was never halted. What remains is that whoever controls the endpoint can halt
a region, and a node cannot check who said so.

*Estimate: ~4 tasks — sign the directive, pin the operator key beside the provider keys, and
let a node refuse a directive it cannot verify.*

### 4.4 The egress manifest is an evidence artifact

`to` + `bytes`, signed by the owner. Making the signature opt-in, and keeping the manifest
local unless explicitly exported, preserves its purpose (the owner checking their own guard) and
removes its use as a record against the owner.

*Estimate: ~3 tasks.*

### 4.5 Membership is visible at up to two places

The certificate binds `nodeKey ↔ userKey` and names the provider, so a provider holds a list of
its members. Federation helps — provider keys are pinned **per verifier** and several providers
coexist by construction (`packages/core/src/enrollment.ts:93`), verification is offline with no
live authority consulted (`:1528`) — so a community can run its own and there is no single
registry to seize. It distributes the risk; it does not remove it.

The relay is the potential second place: `RelayAdmission`
(`packages/libp2p/src/relay-admission.ts`) can gate reservations on a certificate chaining to a
pinned issuer. Today every node in the repository is `'admits-any-peer'`, so the relay learns
nothing extra — but turning admission on would make membership visible to the relay operator
too. Worth deciding deliberately rather than discovering later.

Removing attribution rather than distributing it means **anonymous credentials**: prove
membership without naming which member. That collides head-on with `composeQuorum`'s
one-replica-per-operator rule, which needs operators to be distinguishable. The resolution is
per-epoch pseudonyms (a Privacy Pass shape) — distinguishable within an epoch, unlinkable
across them.

*Estimate: 2–3 phases, ~20 tasks, plus a design spec. This is the largest item here and it
reopens a settled security decision.*

### 4.6 No transport obfuscation

WSS to three static, enumerable hostnames. No pluggable transports, no bridges, no bridge
distribution. Blockable by name.

*Estimate: 2 phases, ~16 tasks — and it needs infrastructure this project does not currently
run (a bridge pool and a distribution channel that resists enumeration).*

---

## 5. Where this architecture actually fits today

Not *against the secret police*. **Against legal compulsion of a cloud provider** — an
organisation, an NGO, a newsroom inside such a jurisdiction that must not hand raw data to a
third party and needs verifiable evidence that what was computed is what was asked for. There,
data-does-not-move plus signed artifact names plus offline certificate verification work exactly
as claimed, and the fabric's own threat model is honest about the rest.

The project's threat model already says the important sentence
(`.planning/THREAT-MODEL.md:157`). Nothing in this document contradicts it; it applies it to a
population the model was not written for.

**Positioning caution, once:** this is the class of software where being wrong costs people
their freedom. Tor, Signal and Briar carry external audits for that reason. Marketing o2 for
this use before §4.1, §4.2 and §4.5 are closed and independently reviewed would be premature.
