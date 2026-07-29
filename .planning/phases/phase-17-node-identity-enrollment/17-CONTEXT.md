# Phase 17: Node Identity & Enrollment - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Mode:** Autonomous — decisions below resolved from the existing `enrollment.ts` API, the
Phase 11 hook contract, and the Phase 12/13 spawn-and-wire precedents. Three grey areas
are resolved here with reasoning; two gaps that the phase's own criteria cannot close are
flagged in "Risks" rather than folded into a decision.

<domain>
## Phase Boundary

Every mechanism this phase needs exists and is unit-verified from Phase 6. None of it is
reachable from a runnable entry point:

- `requestEnrollment` — `packages/core/src/enrollment.ts:135`
- `EnrollmentAuthority` — `packages/core/src/enrollment.ts:166`
- `verifyCertificate` — `packages/core/src/enrollment.ts:265`
- `possessionChallenge` — `packages/core/src/enrollment.ts:117`
- `publishCapabilities` — `packages/core/src/discovery.ts:101`

A running node's identity today is the libp2p peer id and nothing else:
`FabricNode.peerId` is `this.libp2p.peerId.toString()` (`packages/node/src/fabric-node.ts:430-432`),
the executor id is the same string (`fabric-node.ts:377`), and `createLibp2p`
(`fabric-node.ts:303`) is called with **no `privateKey`**, so libp2p mints a fresh
ephemeral key on every process start. Nothing on disk survives a restart except blocks.

**In scope:** AUTH-01, AUTH-02, AUTH-04 —

> - [ ] **AUTH-01**: A node's identity key is generated on-device and its public half
>       is signed into a provider-issued certificate
> - [ ] **AUTH-02**: A node verifies a peer's provider-signed certificate offline,
>       with no live certificate authority
> - [ ] **AUTH-04**: Enrollment is provider-gated and rate-limited, so mass fake-node
>       creation is costly

(quoted verbatim from `.planning/REQUIREMENTS.md:180-187`)

**Out of scope:** `discoverExecutors` and the query side of record lookup (Phase 18 —
SCHED-01; this phase makes a node *publish* its own records, it does not make a requestor
*query* them to pick executors). `resolveReplicaSets` and owner-domain attestation
(Phase 19 — AUTH-05). Capability chains on dispatch (Phase 15 — AUTH-03; a chain says the
*caller* may ask, a certificate says the *node* is enrolled; they compose and neither
substitutes). Browser-tier identity persistence (`BrowserNode.start()` has no runtime test
anywhere and is blocked on the multi-browser standard recorded against Phase 19 in
`.planning/ROADMAP.md:465`; see "Deferred"). Making enrollment genuinely *expensive*
rather than *rate-limited* (`enrollment.ts:22-30` states this gap itself; see "Risks").
</domain>

<decisions>
## Implementation Decisions

### 1. One key, two encodings — the on-device identity key *is* the libp2p key

`NodeCertificate.nodeKey` is a hex ed25519 public key (`enrollment.ts:80`). The transport
addresses peers by libp2p peer id string (`Libp2pTransport.send` calls
`peerIdFromString(to)`, `packages/libp2p/src/libp2p-transport.ts:127`; `get peers()` maps
`libp2p.getPeers()` to strings, `:156-158`). `RecordIndex.providers` returns
`PublicKeyHex` (`packages/core/src/discovery.ts:139`). **Those are two different
namespaces today and nothing bridges them** — the Phase 6 tests only work because
`MemoryNetwork` lets a node pick its own address, so `sovereign-execution.test.ts:150`
sets `nodeId = toHex(ed25519.getPublicKey(priv))` and the two namespaces are made
identical by fiat in the fixture.

Resolve it by construction rather than by a lookup table: generate **one** 32-byte
ed25519 seed on-device, use it for both.

```ts
// @o2/libp2p — allowed to import @libp2p/*, unlike @o2/core and @o2/net
const privateKey = await generateKeyPairFromSeed('Ed25519', seed)   // @libp2p/crypto@5.1.21
const libp2p = await createLibp2p({ privateKey, /* … */ })          // libp2p/dist/src/index.d.ts:41
const nodeKey = toHex(ed25519.getPublicKey(seed))                   // @o2/core
```

Four things fall out of this and none of them needs extra machinery:

- `peerId ↔ nodeKey` is a **pure function in both directions** —
  `peerIdFromPublicKey(publicKeyFromRaw(fromHex(nodeKey)))`
  (`@libp2p/peer-id/dist/src/index.d.ts:21`, `@libp2p/crypto/dist/src/keys/index.d.ts:45`).
  A node that has authenticated a peer over Noise therefore already knows which `nodeKey`
  that peer must present, and can refuse a certificate naming a different one.
- The Noise handshake **is** the proof of possession for the certificate's subject key.
  `EnrollmentAuthority.enrol` verifies its own `proofOfPossession` (`enrollment.ts:195-211`)
  at issuance; after that the peer id in every connection re-proves it on every dial.
- The peer id becomes **stable across restarts**, which Phase 18's reservation/bootstrap
  work needs anyway and which is impossible today.
- Criterion 1's "advertised identity being a certificate rather than a bare libp2p peer
  ID" becomes structurally checkable rather than a matter of what gets printed.

**This rests on the two derivations agreeing, and the dependency source settles it.**
`node_modules/@libp2p/crypto/dist/src/keys/ed25519/index.js:13-15` defines
`derivePublicKey(privateKey) { return ed.getPublicKey(privateKey) }` over
`ed25519` imported from `@noble/curves/ed25519.js` (`:2`), and `generateKeyFromSeed`
calls it at `:41` under the comment *"the seed is used directly as private key"*. The
browser build does the same at `index.browser.js:31-38`. Both sides of the equality are
the same noble call on the same bytes, so it is not a hope. Confirmed empirically on this
machine for seeds of `0x00`, `0x07` and `0xff` — equal in all three, `0x07` giving
`ea4a6c63e29c520a…`.

**Assert it anyway, and keep the assertion.** Three lines that pin the dependency against
a future rewrite of `generateKeyFromSeed` are worth having; a stop-and-report gate and a
wire-format contingency for a question one file answers are not, and the priority they
consumed is re-spent on the two checks that *are* unsettled — the blockstore count
collision (Risk 1) and the `peer:connect` ordering (Risk 6).

### 2. Where the key lives, and what happens when there is nowhere to put it

`<blockstoreDir>/.identity.key`, 32 raw bytes, written with the tmp-name-then-`rename`
pattern `FsBlockstore.put` already uses (`packages/node/src/fs-blockstore.ts:65-69`) so a
process killed mid-write leaves no half-written key. `mode: 0o600` on create. Lives in
`@o2/node` — `node:fs` is forbidden in `@o2/core`/`@o2/net`/`@o2/libp2p`/`@o2/browser` by
`purity.node.test.ts:46-58`.

**The leading dot is load-bearing, and it comes with a one-line change to
`FsBlockstore.open`.** That filter is not a safety net for leftover temporary files — it
*is* the block counter. `fs-blockstore.ts:44-46` reads
`const blocks = entries.filter((name) => !name.startsWith('.tmp-')); return new
FsBlockstore(dir, blocks.length)`, so **every entry that is not `.tmp-` prefixed is
counted as a block**. An `identity.key` sitting in that directory is a block as far as
`size` is concerned. The consequence is not hypothetical:
`packages/node/src/fabric-node.node.test.ts:206` captures
`sizeBeforeRestart = worker.store.size` — the in-memory counter, which only ever counted
real `put()`s because the directory was empty when `open()` ran — and `:214` asserts
`expect(reopened.size).toBe(sizeBeforeRestart)` after a second `FsBlockstore.open(workerDir)`,
which now counts the identity file too. That is N+1 against N, and it fails.

So: name the three files `.identity.key`, `.provider.key` and `.certificate.json`, and
widen the filter in `FsBlockstore.open` from `!name.startsWith('.tmp-')` to
`!name.startsWith('.')`. A block file name is `cid.toString()` — base32-lowercase, which
never begins with a dot — so the widened predicate excludes exactly the non-block entries
and nothing else, and it subsumes the `.tmp-` case rather than replacing it. A sibling
directory outside `blockstoreDir` was considered and rejected: two agents spawned into
`<workdir>/alice` and `<workdir>/bob` would share one parent, so a sibling identity
directory would give them one identity.

`packages/node/src/fabric-node.node.test.ts` therefore joins the regression bar in
decision 9's third row. Phase 17 **runs** that file and does not modify it — Phases 14, 15
and 21 all edit it (`CONFLICTS.md`), and this phase has no reason to.

`FabricNodeOptions.blockstoreDir` is optional and the fallback is `MemoryBlockstore`
(`fabric-node.ts:271-274`). When it is absent there is nowhere to persist, so the identity
is **generated fresh per process and not persisted** — which is exactly the framing the
existing option doc already uses: *"Persistence is a deployment choice — whether this
process should survive its own restart — and not a kind of node"* (`fabric-node.ts:104-113`).
No new option, no new branch on node kind.

### 3. Key generation is `crypto.getRandomValues`, never `crypto.subtle`

`ed25519.keygen()` bottoms out in `@noble/hashes`'s `randomBytes`, which reads
`crypto.getRandomValues` and throws if it is absent — verified at
`node_modules/@noble/hashes/utils.js:546-559`, and `subtle` appears nowhere in that path.
That is the *same* API `start-probe.ts:31` already probes for, with the comment
*"Deliberately **not** `crypto.subtle`"*. So the kernel constraint holds without any
special handling, and a LAN `http://` origin can still generate an identity. Nothing
written in this phase may reach for `crypto.subtle` to hash, sign, or generate.

**What that sentence can and cannot claim about the dependency, read rather than
assumed.** The derivation this phase calls is `subtle`-free in both builds:
`generateKeyFromSeed` is `ed.getPublicKey(seed)` in `index.js:41` and in
`index.browser.js:31-38` alike. But `@libp2p/crypto`'s **browser** entry evaluates
`crypto.get().subtle.generateKey({ name: 'Ed25519' }, …)` at module load
(`index.browser.js:11-20`) to memoise whether WebCrypto can do Ed25519, and `crypto.get()`
throws `WebCryptoMissingError` when `subtle` is absent (`dist/src/webcrypto/index.js:5-15`)
— *inside a `try/catch` that returns `false`*. So a missing `subtle` does not break the
module; it sets `ed25519Supported = false` and routes `hashAndSign`/`hashAndVerify` to
noble (`index.browser.js:72-79`, `:91-100`).

The accurate claim is therefore **"identity generation and derivation do not require
`crypto.subtle`"**, not "nothing on this path touches it". And it is **unmeasured** in an
insecure context: both vitest projects run on a secure origin, so the `subtle`-absent
branch is never taken anywhere in this repository. What would measure it is serving the
demo bundle over plain `http://` on a LAN address and generating an identity in that tab —
Phase 19's multi-browser standard is the first place that becomes runnable.

### 4. Enrollment travels as an eighth wire request kind — not a sixth entry point

`protocol.ts` documents seven request kinds (`packages/net/src/protocol.ts:55-83`) and
this phase adds `enrol`. The alternative — a standalone provider binary — is refused
because `.planning/ROADMAP.md`, section `### Phase 22: Reachability Guard`, fixes the reachability guard's universe at **five**
runnable entry points (`bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`,
the browser demo). Adding a sixth would put Phase 22 in conflict with Phase 17 on day one.

The wire work is smaller than it looks, because the certificate half already exists and is
already exercised end to end by `parseCertificate`/`certificateToValue`
(`protocol.ts:150`, `:172`, reached from `encodeResponse` `:446-452` and `parseResponse`
`:501-508`). What is new: canonical encode/parse for `EnrollmentRequest`
(`enrollment.ts:124-132`) and for `EnrollmentResult`'s refusal arm
(`EnrollmentRefusal`, `enrollment.ts:144-146` — two kinds, `bad-proof-of-possession` and
`rate-limited` with `limit`/`windowMs`/`retryAfterMs`). Follow `parseCertificate`'s
discipline exactly: every field required and typed, `null` on anything malformed, and no
judgement about validity in the parser (`protocol.ts:164-171` says why).

### 5. Issuance is an eighth `serveAgent` hook — configuration, not a class

```ts
readonly enroll: EnrollmentAuthority | 'issues-no-certificates'
```

Every node has the identical code; whether a given process holds a provider private key is
a per-node setting, and the repository already has the precedent written down for exactly
this shape. `bin/agent.ts:26-31` says of `--owner-id`: *"this is a per-node clearance flag,
not a node kind: every agent process built by this binary has identical capability
regardless of whether it is passed."* The same sentence applies verbatim here, and the
planner should write it into the new option's doc comment so the next reader does not have
to re-derive it.

**Blast radius, stated because it touches two guard tests:**

| Site | What changes |
|---|---|
| `packages/net/src/agent.ts:66-153` | new member on `AgentOptions`, plus the `enrol` branch in the handler after `:192` |
| `packages/node/src/fabric-node.ts:411-425` | one more line in the `serveAgent` call |
| `packages/browser/src/browser-node.ts:264-278` | one more line |
| `packages/node/src/bin/bench.ts:144-158` and `:170-184` | one more line each |
| `packages/net/src/agent-contract.test.ts:22-40` | `buildFull()` gains the member; the describe title *"requires all seven hooks"* and its per-hook `@ts-expect-error` case list must gain an eighth |
| `packages/node/src/serve-agent-hooks.node.test.ts:28-52` | the sentinel-occurrence counts gain a row per file |

Every other `serveAgent` call site is a test (`packages/net/src/{discovery,distributed,start-report,rendezvous,sovereign-egress,submit-with-egress,churn,sovereign-execution}.test.ts`, 14 calls) and each needs the sentinel added or `tsc --noEmit` fails — which is the contract working as designed, not a defect.

### 6. The provider key is generated on-device too; no key material on argv

`--issues-certificates` (boolean). On first start with that flag the process generates
`<blockstoreDir>/.provider.key` the same way it generates `.identity.key`, constructs
`new EnrollmentAuthority({ providerPrivateKey })` (`enrollment.ts:175-181`), and prints
`issuerKey` (`enrollment.ts:183-185`) as a field on the existing one-line stdout handshake
(`bin/agent.ts:58`). A test harness pins the issuer by reading that line — the same
mechanism `two-process.node.test.ts:52-76` already uses for `peerId`/`multiaddrs`.

Deliberately **not** `--provider-key <hex>`: argv is world-readable in `ps`. Deliberately a
*separate* file from `.identity.key`, so `issuer !== nodeKey` always holds and a
provider-signed certificate is never confusable with a self-signed one.

### 7. A node serves its own records through the `index` hook that already exists

Criterion 2 needs node B to *obtain* node A's certificate across a process boundary. The
request kind (`records`), its wire encoding, and its handler branch all exist
(`protocol.ts:66`, `:92`, `agent.ts:176-181`) — and are dead in production, because every
production call site passes `'serves-no-records'`: `fabric-node.ts:420`,
`browser-node.ts:273`, `bench.ts:153`, `bench.ts:178`.

Phase 17 supplies a `RecordIndex` holding **this node's own** `{certificate, capabilities}`
and nothing else. `MemoryRecordIndex` (`discovery.ts:358-382`) is sufficient: `publish()`
the node's own `NodeRecords`, `provide()` nothing. Publishing the capability half means
calling `publishCapabilities` (`discovery.ts:101`), which also has no production caller
today, with:

- `features: []` — no feature-detection dependency exists in this repository
  (`wasm-feature-detect` is recommended in CLAUDE.md and is *not installed*; nothing in
  `packages/browser/src/wasm-probes.ts` detects engine features, it builds probe modules).
  An empty list is honest and harmless: `discoverExecutors` only excludes on
  `requiredFeatures` a caller asked for (`discovery.ts:278-284`). Populating it is Phase 18's
  problem, and this is recorded under "Deferred" rather than left to be discovered.
- `sovereignFor: sovereignty.canExecuteSovereign ? [certificate.userKey] : []` — **derived
  from the certificate, not from the owner label.** `CapabilityRecord.sovereignFor` is
  `readonly PublicKeyHex[]` (`packages/core/src/discovery.ts:81`) and its only consumer
  compares it against a *user key*: `discovery.ts:286-290`,
  `if (sovereignFor !== undefined && !capabilities.sovereignFor.includes(sovereignFor))`
  where `ExecutorQuery.sovereignFor` is `PublicKeyHex` (`:157`) — the same hex ed25519 key
  the certificate carries as `userKey`. `OwnerId` is an opaque string
  (`packages/core/src/sovereignty.ts:27`). Publishing `sovereignty.ownerId` there would
  bake an operator's label into a signed statement that Phase 18's sovereign branch can
  never match, which is the exact defect decision 10 forbids — *a signed certificate is
  the worst possible place for a field with two answers* — applied to the one field this
  phase would otherwise have chosen to configure rather than derive. The repository's own
  fixture avoids it by making the owner id *be* a hex key
  (`sovereign-execution.test.ts:105`, `:150`, `:157`); deriving from `certificate.userKey`
  gets the same result without depending on an operator having typed a hex string into
  `--owner-id`. Reuse the already-hoisted `sovereignty` local at `fabric-node.ts:348` for
  `canExecuteSovereign`; do not re-default it.

Phase 17 **publishes**; Phase 18 **queries**. `RpcRecordIndex` (`packages/net/src/discovery.ts:35-69`)
is the query adapter and **stays uncalled by production in this phase** — see decision 8
for why the verification gate does not route through it, and "Deferred" for the statement
that its first production caller is Phase 18's `discoverExecutors` wiring. Inventing a
production caller for it here to have one would be this milestone's own defect, committed
in the opposite direction.

### 8. The verification gate goes at the existing peer-list thunk, not in the transport

"Before treating it as a legitimate peer" needs a place where an unverified peer stops
being usable. There is already exactly the right seam, and it is a thunk:

- `fabric-node.ts:359` — `new RpcBlockSource(rpc, () => transport.peers)`
- `fabric-node.ts:422` — `reservations: () => node.reservedPeerIds`

Replace the first with `() => node.verifiedPeers`. An unverified peer is then never asked
for a block and never appears as a dispatch candidate, structurally, with no `if` anywhere
that could be forgotten. `Transport` stays a three-member datagram port that knows nothing
about certificates — the property `libp2p-transport.ts`'s module comment exists to protect.

Mechanics: subscribe to `libp2p`'s `'peer:connect'` / `'peer:disconnect'`
(`@libp2p/interface/dist/src/index.d.ts:249`, `:265`), and on connect derive the expected
`nodeKey` from the peer id (decision 1), ask that peer for its records over the existing
`records` request, and run `verifyCertificate(certificate, trustedIssuers, Date.now())`
(`enrollment.ts:265`), additionally requiring `certificate.nodeKey === expectedNodeKey`.
Cache the `CertificateResult` per peer. `verifiedPeers` is the subset whose cached result
is `ok`, **plus every peer when no trust anchors are configured** — see decision 9.

Three mechanics details, each of them a thing the obvious implementation gets wrong:

- **Ask the peer directly; do not route through `RpcRecordIndex`.** That class deliberately
  erases the distinction a per-peer verdict needs. `packages/net/src/discovery.ts:62-68`
  wraps `rpc.request` in `try/catch` and returns `null` on failure with the comment
  *"unreachable peer — ask the next one"*; `recordsFor` (`:53-60`) then falls out of the
  loop and returns `undefined`. An unreachable peer and a peer answering `records: null`
  are the same `undefined`, and there is no surviving error object for an `unreachable`
  verdict's `detail` to come from. Skip-and-continue is correct for discovery and wrong
  for a verdict. The verifier issues
  `rpc.request(peerId, encodeRequest({ kind: 'records', nodeKey: expected }))` inside its
  own `try/catch` — `encodeRequest`/`parseResponse` are already exported from the `@o2/net`
  barrel (`packages/net/src/index.ts:13`) — and maps `RpcFailure.detail` to `unreachable`,
  a parsed response that is not `kind: 'records'` to `unanswerable-peer`, and
  `records === null` to `no-records`.
- **Subscribe only when there is something to verify.** `verifyCertificate` refuses against
  an empty anchor set at `enrollment.ts:270-276`, so a node with no `--trusted-issuer` that
  kicked off `verify` on every connect would populate a cached verdict
  (`untrusted-issuer`, or `no-records`) for every peer it ever meets, and would emit an
  unrequested `records` request through `EgressGuard` for a result nothing reads — on
  every `FabricNode` in the repository, none of which pins an anchor. `PeerVerifier.start`
  therefore returns before adding either listener when `trustedIssuers.size === 0`. That is
  what makes decision 9's third row true *by construction* rather than by winning a race
  against an in-flight RPC.
- **Seed the cache from the peers that are already connected.** `fabric-node.ts:340-342`
  dials every `relayAddrs` entry *before* `transport`, `rpc` or the verifier exist, so
  those `peer:connect` events fire with no listener attached. Without seeding, a node
  configured with both `relayAddrs` and `trustedIssuers` — the browser topology
  `FabricNodeOptions.relayAddrs` exists for — can never get a verdict for the one peer it
  is reachable through, and can therefore never fetch a block, permanently, with no error
  anywhere. `start` iterates `options.peers()` once, after attaching the listeners, and
  kicks off `verify` for each.

Every refusal already has a named reason and a kind:
`untrusted-issuer` (`enrollment.ts:270-276`), `bad-signature` (`:284-290`),
`not-yet-valid` (`:292-298`), `expired` (`:299-305`). Criterion 2's "named reason" needs
no new vocabulary; it needs those strings surfaced where a test can read them.

### 9. Absence is stated, never defaulted; failure is fatal exactly when it was asked for

Three states, and each one is written down rather than inferred:

| Configuration | Behaviour |
|---|---|
| no `--provider-addr` | identity key still generated and persisted; `certificate` is `null`; the node starts |
| `--provider-addr` given, enrollment fails | `start()` rejects, process exits non-zero with the refusal reason on stderr |
| no `--trusted-issuer` | `verifiedPeers === transport.peers`; the node states it verifies nobody |

The middle row is the one that matters. `.planning/PROJECT.md`'s Key Decision **"An
optional hook with a silent default is a hole"** is exactly the failure being avoided: a
node told to enrol, unable to, and running anyway is a node whose identity claim is
silently absent. The existing spawn harnesses already surface this correctly — an early
exit is reported as `agent <name> exited early with <code>: <stderr>`
(`two-process.node.test.ts:71-74`, `egress-refusal.node.test.ts:86-89`).

The third row is the regression bar for this whole phase: `two-process.node.test.ts`,
`egress-refusal.node.test.ts`, `sovereignty-placement.node.test.ts`, `bin/bench.ts` and
`SeedServer.start` (`packages/node/src/seed-server.ts:191-195`) all construct nodes with
no new flags, and **all of them must keep passing unchanged**.

### 10. Certificate fields that could be lied about are derived, not configured

`--user-key <hex>` and `--operator-id <id>` are **required** when `--provider-addr` is
given; omitting either exits 2 with usage, matching `bin/agent.ts:37-42`'s existing shape.
A default would write a placeholder into a signed statement — and `operatorId` is the unit
of quorum diversity (`enrollment.ts:83-84`), so a silent default would make every node one
operator, or every node its own, and Phase 19 would inherit a meaningless anti-affinity
rule.

`discoverability` and `relayIds` are **derived, never passed**:

```ts
discoverability: canRelay ? 'seed' : 'via-relay',
relayIds: canRelay ? [] : peerIdsOf(options.relayAddrs ?? []),
```

`canRelay` already exists at `fabric-node.ts:289` and is derived from the listen list for
precisely this reason — *"An option would be a lie waiting to happen: any boolean can be
set on a node with no socket, and then 'does this node relay?' has two answers that can
disagree"* (`fabric-node.ts:35-47`). A signed certificate is the worst possible place for
a field with two answers.

**Assumption (labelled):** `--user-key` is not unified with `--owner-id`. They are
different types today — `OwnerId` is an opaque string (`packages/core/src/sovereignty.ts:27`),
`PublicKeyHex` is a hex ed25519 key (`packages/core/src/capability.ts:46`). An operator
who passes the same hex string for both reproduces the repository's own fixture exactly.
Unifying them is AUTH-05 / Phase 19's decision, not this phase's.

### 11. A persisted, unexpired certificate is reused on restart

Store the issued certificate as JSON next to the key
(`<blockstoreDir>/.certificate.json` — decision 2's dot rule applies to it too). On start,
if it parses, **`peerIdForNodeKey(loaded.nodeKey) === identity.peerId`**, and it is
unexpired against `Date.now()`, reuse it and do not contact the provider. Otherwise enrol.

That middle check is written through `peerIdForNodeKey` rather than as
`loaded.nodeKey === identity.nodeKey` on purpose, and it is not decoration. It is the
identical guarantee — the nodeKey → peerId derivation is injective, so the two conditions
agree on every well-formed input — plus one more: a `nodeKey` that is not valid lowercase
hex yields `null`, which is not `identity.peerId`, so a hand-edited or older-build file
fails closed instead of being compared string-to-string. And it makes `peerIdForNodeKey` a
function production calls, which matters for a reason beyond this file: a capability
exported from a package barrel with no traced call path from one of the five runnable entry
points is precisely what Phase 22's guard is specified to fail on
(`.planning/ROADMAP.md`, section `### Phase 22: Reachability Guard`, criterion 1). Shipping a new instance of that defect five
phases before the guard lands would open Phase 22 with a self-inflicted failure.

This is what makes criterion 1's *"for the first time"* clause measurable rather than
decorative: restart the same agent against the same directory and
`EnrollmentAuthority.issuedWithin(userKey, now)` (`enrollment.ts:188-190`) on the provider
must still read **1**, not 2.
</decisions>

<code_context>
## Existing Code Insights

### `enrollment.ts` — complete, exported, and called by nothing outside a test

`packages/core/src/enrollment.ts`. Barrel re-export at `packages/core/src/index.ts:224-243`.
Classification of every hit, per the method this milestone exists because nobody applied:

| Symbol | Definition | Production call sites | Test call sites |
|---|---|---|---|
| `requestEnrollment` | `enrollment.ts:135` | **none** | `core/src/enrollment.test.ts:34,55,65,152,155`; `core/src/discovery.test.ts:59`; `net/src/discovery.test.ts:112`; `net/src/sovereign-execution.test.ts:131` |
| `EnrollmentAuthority` | `enrollment.ts:166` | **none** | `core/src/enrollment.test.ts:25,110`; `core/src/discovery.test.ts:36,118,212`; `net/src/discovery.test.ts:79`; `net/src/sovereign-execution.test.ts:100` |
| `verifyCertificate` | `enrollment.ts:265` | **none directly**; two internal callers — `discovery.ts:260` (inside `discoverExecutors`) and `enrollment.ts:332` (inside `resolveReplicaSets`) — and *neither of those has a production caller either* | `core/src/enrollment.test.ts:81,90,103,115,116,117,218,219,230` |
| `possessionChallenge` | `enrollment.ts:117` | internal only: `enrollment.ts:140`, `:199` | — |
| `resolveReplicaSets` | `enrollment.ts:325` | **none** (Phase 19) | `core/src/enrollment.test.ts:170,183,195`; `net/src/sovereign-execution.test.ts:270` |
| `publishCapabilities` | `discovery.ts:101` | **none** | `core/src/discovery.test.ts:69,138,370,382,398,419`; `net/src/discovery.test.ts:122`; `net/src/sovereign-execution.test.ts:145,222` |
| `MemoryRecordIndex` | `discovery.ts:358` | **none** | `core/src/discovery.test.ts:91,145,164,198,274,292,318,344,356,406,426`; `net/src/discovery.test.ts:87`; `net/src/sovereign-execution.test.ts:111` |
| `RpcRecordIndex` | `net/src/discovery.ts:35` | **none** | `net/src/discovery.test.ts:189,239,262,309`; `net/src/sovereign-execution.test.ts:267,402` |

Behavioural details the planner needs:

- `enrol()` checks possession **first** (`enrollment.ts:192-211`), then the window
  (`:213-227`). A forged request is refused before it can consume rate-limit budget — so a
  burst of forged requests does not lock out a legitimate one.
- The window is per **`userKey`** (`enrollment.ts:213`, `#history` keyed at `:173`), not
  per node key and not per connection. This is the whole of criterion 3's measurement
  surface and its whole limitation; see "Specifics".
- Defaults: `maxPerWindow = 5`, `windowMs = 3_600_000`, `certificateLifetimeMs = 30 days`
  (`enrollment.ts:178-180`). At the default a burst test needs ≥6 requests under one user
  key to observe a refusal.
- The clock is a parameter everywhere (`enrol(request, now)`, `verifyCertificate(…, now)`)
  — *"so the limiter's behaviour is deterministic in tests and the module stays free of
  platform time"* (`enrollment.ts:162-165`). Production must pass `Date.now()` at the
  adapter boundary; nothing in `@o2/core` may read a clock.
- `#history` is in-process memory. A provider restart resets the window — see "Risks".

### The wire already carries certificates; nothing has ever put one on it

`certificateToValue` (`protocol.ts:150-161`) and `parseCertificate` (`:172-195`) are
complete, and are reached from `encodeResponse` (`:446-455`) and `parseResponse`
(`:501-508`). `capabilitiesToValue`/`parseCapabilities` (`:197`, `:208`) likewise. The
handler branch is `agent.ts:176-181`. In production every one of those paths returns
`null` because `options.index` is the `'serves-no-records'` sentinel at all four
production call sites (`fabric-node.ts:420`, `browser-node.ts:273`, `bench.ts:153`,
`bench.ts:178`). This is live, tested, unexercised code — decision 7 turns it on.

### `fabric-node.ts` — the construction order this phase has to fit into

`packages/node/src/fabric-node.ts`, inside `static async start` (`:270-428`):

| Line | What happens | Phase 17 interaction |
|---|---|---|
| `:271-274` | `store` — `FsBlockstore.open(dir)` or `MemoryBlockstore` | identity file lives beside these blocks |
| `:278-289` | `listen` list, then `canRelay` derived from it | feeds `discoverability`/`relayIds` (decision 10) |
| `:303-336` | `createLibp2p({ addresses, transports, … })` — **no `privateKey` today** | must receive the derived key; identity resolution has to happen *before* this line |
| `:340-342` | dials each `relayAddrs` entry | the provider dial is the same shape |
| `:344` | `Libp2pTransport.start(libp2p)` | — |
| `:348` | `sovereignty` resolved once (13-CONTEXT decision 2) | reuse for `sovereignFor` |
| `:351-355` | `egress` then `rpc` over it | the `enrol` request goes out over `rpc` |
| `:359` | `new RpcBlockSource(rpc, () => transport.peers)` | **the seam decision 8 replaces** |
| `:376-379` | executor: `registerSovereignInputs(guardSovereignty(…))` | untouched |
| `:381-392` | `new FabricNode({…})` | gains `identity` / `certificate` fields |
| `:411-425` | `serveAgent({…})` | gains `enroll`, and `index` stops being the sentinel |

Enrollment must complete between `:355` and `:411`: after `rpc` exists to carry it, before
`serveAgent` so the `index` hook can be constructed already holding the records.

### The spawn harness this phase's tests reuse verbatim

`packages/node/src/egress-refusal.node.test.ts:47-90` is the closest template — it already
has `spawnAgent(name, extraArgs)` with a pass-through argv array, which is exactly what
`--provider-addr`/`--user-key`/`--operator-id`/`--trusted-issuer`/`--issues-certificates`
need. `two-process.node.test.ts:29-77` is the same helper without `extraArgs`.
`sovereignty-placement.node.test.ts` is the third instance. The handshake contract is one
JSON line on stdout (`bin/agent.ts:57-58`), parsed at the first `\n`
(`egress-refusal.node.test.ts:76-83`) — adding fields to that object is backward
compatible with all three helpers, which read only the keys they name.

### `bin/agent.ts` — the whole file is 72 lines and every flag is already documented as configuration

`packages/node/src/bin/agent.ts:22-35` is the `parseArgs` block (`dir`, `port`,
`owner-id`, `can-execute-sovereign`); `:37-42` is the usage/exit-2 path; `:44-55` is
`FabricNode.start`; `:58` is the handshake; `:60-71` is shutdown. The comment at `:26-31`
is the precedent decision 5 leans on.

### The two guard tests that constrain the shape of the change

- `packages/node/src/purity.node.test.ts:46-52` — `@libp2p/*` and `@chainsafe/*` are
  forbidden specifiers in `PORTABLE = ['core','net','bench','demo','aot']` (`:28`), both by
  import scan (`:100-117`) and by `package.json` dependency key (`:119-128`). So
  `@libp2p/crypto` may be added to `packages/libp2p/package.json` (tier
  `DUAL_TARGET`, `:36`, which only bans `node:` and `@o2/node`) and to
  `packages/node/package.json`, and to neither `@o2/core` nor `@o2/net`.
- `packages/node/src/vocabulary.node.test.ts` — scans every git-tracked file including
  this one. Read its `BANNED` array before writing any prose or identifier in this phase.

### `@o2/core`'s hex helpers, and the one sharp edge in them

`toHex`/`fromHex` at `packages/core/src/capability.ts:33-43`, exported from the barrel at
`index.ts:198`. `fromHex` performs **no validation** — `Number.parseInt('zz', 16)` is `NaN`
and the byte silently becomes `0`. Every consumer in `enrollment.ts` wraps the subsequent
`ed25519.verify` in `try/catch` and returns `false`/a named failure (`:196-204`,
`:279-283`), so a malformed hex key off the wire degrades to `bad-signature` rather than
throwing.

**`try/catch` is not the mitigation, and this phase must not pretend it is.** `fromHex`
never throws on non-hex; it silently zero-fills, so there is nothing for a `catch` to
catch. Measured on this machine: `fromHex('z'.repeat(64))` is 32 zero bytes,
`publicKeyFromRaw` accepts those as a valid Ed25519 key
(`node_modules/@libp2p/crypto/dist/src/keys/index.js:73-76`), and the derivation returns a
confident, wrong `12D3KooW9pNAk8aiBuGVQtWRdbkLmo5qVL3e2h5UxbN2Nz9ttwiw`. Uppercase is the
other half of the same edge: `Number.parseInt('AB', 16)` is `171`, so an uppercase key
parses to *valid but different* bytes from the lowercase form `toHex` produces, and the
round trip breaks with no error.

So this phase adds **one shared validator** — `parseKeyHex(s): PublicKeyHex | null`,
requiring `/^[0-9a-f]{64}$/` — in `packages/libp2p/src/identity.ts` beside the derivation
that consumes it, exported from the `@o2/libp2p` barrel. It is placed there rather than
beside `fromHex` in `@o2/core` for one concrete reason: `packages/core/src/index.ts` is
edited by Phases 13.1, 14 and 16 and by no plan in this phase, while
`packages/libp2p/src/index.ts` is already opened by 17-01. Everything in this phase that
turns a string into a key goes through it: `peerIdForNodeKey`, `bin/agent.ts`'s
`--user-key` and `--trusted-issuer`, and `loadCertificate`'s three key fields. `@o2/net`
is **not** routed through it — a portable package may not import `@o2/libp2p`'s transitive
`@libp2p/*` — so `parseCertificate` keeps its existing string typing and `loadCertificate`
applies the key check on top of it, in `@o2/node`, where the import is legal.

### Versions confirmed present in `node_modules`

`@libp2p/crypto@5.1.21` (matches CLAUDE.md's recommended pin), `@libp2p/peer-id@6.0.12`
(already a declared dependency of `@o2/libp2p`, `@o2/node`, `@o2/browser`),
`@noble/curves@2.2.0`, `libp2p@3.3.6`. `createLibp2p`'s `privateKey?: PrivateKey` is at
`node_modules/libp2p/dist/src/index.d.ts:41`.
</code_context>

<specifics>
## Specific Ideas

### How each success criterion gets measured

**Criterion 1** — *identity key generated on-device, rate-limited enrollment completed,
provider-signed certificate received, advertised identity is a certificate.*

Measured, in a new `packages/node/src/enrollment.node.test.ts`, by spawning two real agent
processes with the `egress-refusal.node.test.ts:63-90` helper:

1. Spawn P with `--issues-certificates`; read `issuerKey` off its handshake line.
2. Spawn A with `--provider-addr <P's multiaddr> --user-key <hex> --operator-id op-a`.
3. Assert `<A's dir>/.identity.key` exists and is exactly 32 bytes, and did not exist
   before the spawn.
4. Assert A's handshake line carries `nodeKey`, `issuer === issuerKey`, and an
   `expiresAt` in the future — i.e. the advertised identity is a certificate, not only a
   peer id.
5. Assert `peerIdFromPublicKey(publicKeyFromRaw(fromHex(nodeKey))).toString() === peerId`
   — the decision-1 binding, and the assertion that makes step 4 mean something rather
   than being a string the binary chose to print.
6. From a `FabricNode` in the test process, dial A and issue a `records` request for that
   `nodeKey`; assert the returned certificate is byte-identical to the advertised one and
   that `verifyCertificate(cert, new Set([issuerKey]), Date.now()).ok` is `true`.
7. SIGTERM A, respawn it on the same `--dir`, assert the `nodeKey` and `peerId` are
   unchanged and that the certificate was not re-issued (decision 11).

Step 6 is what stops this being a self-report: the certificate is read back over the same
wire a peer would use, not off A's own stdout.

**Criterion 2** — *a second node verifies the first's certificate offline, no live CA, and
rejects a self-signed or forged certificate with a named reason.*

- *Offline, no live CA:* measured by **killing the provider process** after A enrols and
  before B starts. B is given `--trusted-issuer <issuerKey>` only. If B completes
  verification with P dead, no live authority was consulted. This is a stronger check than
  inspecting the code for absence of a network call, and it is cheap.
- *Which process B is, stated rather than glossed:* B is a `FabricNode` **in the test
  process**, because `bin/agent.ts` has no flag that makes a spawned agent dial another
  agent (Risk 7) and B has to be connected to A and C to verify them. So criterion 2's
  *accepting* side is measured in process, and that is **unmeasured** through
  `bin/agent.ts`, in those words — not descoped. What the phase *does* measure across a
  real process boundary is the flag and the gate: spawn one agent with
  `--trusted-issuer <P1's key>` and one with no such flag, connect **both** to the test
  process (which serves no records and therefore cannot be verified by anyone), dispatch
  the identical task to each, and read the opposite outcomes. What would close the
  remaining half is a dial/bootstrap-address flag on `bin/agent.ts` — a real production
  need, and Phase 18's bootstrap work, not this phase's.
- *Rejects with a named reason:* spawn a **second** provider P2 and a node C enrolled
  against P2. B pins only P1's issuer. B's cached result for C must be
  `{ ok: false, failure: { kind: 'untrusted-issuer', issuer: <P2's key> } }`, and C must be
  absent from `B.verifiedPeers` while present in `B.transport.peers`. A certificate signed
  by an issuer the verifier does not pin *is* the self-signed case from the verifier's
  side, and it is constructible with production flags only — no test-only branch in the
  binary.
- *The literal self-signed shape, so it is measured and not only reframed:* the bullet above
  is a defensible restatement of criterion 2's "self-signed", but it is a different
  sentence, and nothing in the phase otherwise constructs a certificate whose
  `issuer === nodeKey`. That one costs three lines at the wire and needs no binary change:
  in `packages/net/src/enrol-protocol.test.ts`, hand-build a certificate signed by the node's
  own key with `issuer` set to its own `nodeKey`, put it through
  `encodeResponse` → `parseResponse` → `verifyCertificate` against a set pinning a real
  provider, and assert `{kind: 'untrusted-issuer', issuer: <the node's own nodeKey>}`. Do
  that, and the criterion's own word is measured rather than reported.
- *Forged:* tampering a field requires the certificate to be a value in hand, so it stays
  where it already is — `core/src/enrollment.test.ts:102-107` mutates `operatorId` and
  asserts `bad-signature`. The phase should add the equivalent at the **wire** level: feed
  a tampered certificate through `parseCertificate` → `verifyCertificate` in a portable
  `@o2/net` test, proving the parser does not launder it. Do not add a `--forge` flag to
  the binary.
- *"before treating it as a legitimate peer":* measured structurally as membership of
  `verifiedPeers`, plus one behavioural consequence — a block request routed through
  `RpcBlockSource` must not reach C. Assert the block fetch fails/falls through rather
  than asserting only on the list, or the gate is being reported rather than measured.
  **Block fetching is the whole of what "legitimate peer" means this phase**, because
  `RpcBlockSource.fetch` (`packages/net/src/agent.ts:46`) is the only production consumer
  of `verifiedPeers` there is. Dispatch candidate selection, quorum membership and relay
  use are **unmeasured**, not descoped: there is no production caller to gate until Phase
  18's placement work, and inventing one here to have something to gate would be this
  milestone's own defect committed in the opposite direction. What would measure them is
  Phase 18 routing `discoverExecutors` through the same set.
- *Verdicts are asynchronous, so waiting for one is a precondition and not a sleep.*
  `libp2p.dial` resolving does not mean a records round trip has completed, and `FabricNode`
  exposes only the synchronous `verifiedPeers`/`verdictFor`. Every test that asserts on a
  verdict must first poll until `verdictFor` is **defined** for each peer under test, with
  a stated deadline, and assert that it is defined — otherwise the "not fetched" half
  passes for the wrong reason and the "fetched" half is a race.

**Criterion 3** — *a burst of enrollment attempts through the same entry point is refused
beyond a stated threshold.*

Measured by sending N=20 `enrol` requests, all naming one `userKey` with 20 distinct node
keys, from a `FabricNode` in the test process to a spawned `--issues-certificates` agent,
over the same `rpc.request(peer, encodeRequest({kind:'enrol', …}))` path production uses.
Assert exactly `maxPerWindow` succeed and the remaining `20 - maxPerWindow` return
`{ kind: 'rate-limited', limit, windowMs, retryAfterMs }` with `retryAfterMs > 0`. Then
assert the *stated threshold* is discoverable from the refusal itself (`limit`), not only
from the source.

**This criterion cannot be measured as written, and the phase should say so in those
words.** "Making mass fake-node creation measurably costly" is not what the mechanism
does. `enrollment.ts:22-30` states it plainly: rate-limiting makes fake nodes
*rate-limited, not expensive*; an attacker holding many user keys is not slowed at all,
and the ceiling is a policy number rather than a physical one. Generating a fresh user key
costs one `ed25519.keygen()` call — microseconds. **A second measurement should be run and
published alongside the first, because it is the honest one:** issue 20 requests under 20
*distinct* user keys and record that **all 20 succeed**. That number is the finding. What
would actually make it costly — a proof-of-work, a payment, or an out-of-band identity
check — is out of scope for v1.1 and the limiter is where it would plug in
(`enrollment.ts:26-30`). Report criterion 3 as *rate-limiting measured; cost unmeasured*.

### Same-process is not sufficient here, unlike Phase 13

13-CONTEXT.md argued that two `FabricNode`s in one Vitest process are accepted evidence
for "started via `bin/agent.ts`". That argument does not carry to this phase: criterion 1's
subject is **what happens on first start of a process against a fresh directory**, and
criterion 2's is **a second node**. Both need real processes and real directories, and both
already have a harness (`egress-refusal.node.test.ts:63-90`). Use it. The portable
half — parse/verify/refuse over synthetic values — belongs in `@o2/net` or `@o2/core`
tests, which run in **both** the node and browser vitest projects (`vitest.config.ts:31`,
`:40`), so keep `node:` and process spawning out of those files.

### Naming, so the vocabulary guard does not fire

The design document's §3.9 phrase for the enrollment credential is line-exempted in
`docs/p2p-native-cloud-design.md` only (`vocabulary.node.test.ts:178-182`). No exemption
covers `.planning/phases/phase-17-*` or any new source file. Use *certificate*,
*enrollment request*, *proof of possession*, *issuer key* — every one of which is already
the identifier used in `enrollment.ts`. Nothing new needs coining.
</specifics>

<deferred>
## Deferred Ideas

- **Browser-tier identity persistence.** `BrowserNode` would need the same seed in
  IndexedDB (the `idb-blockstore.ts` pattern) and `createLibp2p({ privateKey })` at
  `browser-node.ts:195`. Blocked on the same root cause recorded against Phase 19 in
  `.planning/ROADMAP.md:465`: `BrowserNode.start()` runs in neither vitest project and has
  no runtime test anywhere in the repository. Adding the wiring without a way to execute it
  would repeat the exact defect this milestone exists to fix. Phase 19's multi-browser
  standard is what unblocks it.
- **Populating `CapabilityRecord.features`.** No feature-detection dependency exists; an
  empty list is correct for this phase because nothing queries `requiredFeatures` yet.
  Belongs with Phase 18's `discoverExecutors` wiring, which is the first thing that reads
  the field (`discovery.ts:278-284`).
- **A production caller for `RpcRecordIndex`.** Decision 8's verifier issues its own
  `records` request instead, because that class cannot distinguish an unreachable peer from
  one answering `records: null`. Its first production caller is Phase 18's
  `discoverExecutors` wiring, which is the shape it was built for — a multi-peer lookup
  where skip-and-continue is right. It stays exported and test-only for one more phase, and
  the phase summary says so.
- **`resolveReplicaSets` / owner-domain attestation** — AUTH-05, Phase 19. This phase makes
  the certificates exist and be fetchable; it does not group them.
- **Unifying `OwnerId` with `userKey`** — see decision 10. A Phase 19 decision.
- **Certificate renewal before expiry.** Lifetime defaults to 30 days
  (`enrollment.ts:180`); a long-running node will eventually hold an expired certificate and
  drop out of every peer's `verifiedPeers`. Decision 11 re-enrols on a certificate that
  fails the unexpired check *at start*, which is sufficient for a phase whose longest test
  runs for seconds, and is not sufficient for a node that stays up for a month. Flagged, not
  built.
- **Revocation.** There is no mechanism and none is proposed. Expiry is the only
  invalidation path.
</deferred>

<risks>
## Risks — flagged, not resolved

**1. The identity files collide with `FsBlockstore`'s block count.** This replaces what
used to be Risk 1 (the noble/libp2p derivation equality), which decision 1 now settles from
the dependency source and confirms empirically. The real unsettled hazard is one directory
holding two kinds of file: `FsBlockstore.open` counts every entry that is not `.tmp-`
prefixed as a block (`fs-blockstore.ts:44-46`), and
`fabric-node.node.test.ts:206-214` asserts the count is identical across a reopen. Decision
2 resolves it with dot-prefixed names plus a one-word widening of that filter, and
`packages/node/src/fabric-node.node.test.ts` joins the regression bar. **This is the first
thing to run**, because it is the failure a plan would otherwise discover at the end of
17-03's full `packages/node` sweep, after four tasks had been built on top of it.

**2. The rate limiter is per-process memory and resets on restart.** `#history`
(`enrollment.ts:173`) is a `Map` in the authority object. A provider that restarts forgets
every issuance, so the "stated threshold" is a threshold per provider *uptime*, not per
window. Criterion 3's measurement is still valid — a burst against one running provider is
genuinely refused — but the phase should state the limit's actual scope rather than let a
reader infer durability. Persisting the history is a straightforward addition and is not
proposed here because nothing in the criteria asks for it.

**3. Turning on the `index` hook changes what every node answers to `providers` and
`records`, including nodes nobody reconfigured.** Today `agent.ts:174` answers `[]` and
`:180` answers `null` for every production node. After decision 7 a node answers with its
own records. Nothing in the repository consumes those answers yet (`RpcRecordIndex` has no
production caller), so the blast radius is believed to be zero — but "believed to be zero"
is what the v1.0 audit was about. The planner should grep `parseResponse` consumers for
`kind === 'providers'` / `kind === 'records'` once more before landing, and the phase's own
tests should assert the *pre-existing* two-process job in `two-process.node.test.ts` still
completes with the same shard outcomes.

**4. Enrollment adds a blocking network round trip to `FabricNode.start()`.** Every spawn
test's 30-second handshake budget (`two-process.node.test.ts:53`) now has to cover a dial
plus a request/response before the handshake line is printed — but only when
`--provider-addr` is passed, which no existing test does. New tests in this phase should
give the enrolling agent its own timeout rather than inheriting a budget sized for a node
that only binds a socket.

**5. `--issues-certificates` makes a process hold a signing key, and the process is the
same binary as every other node.** That is decision 5's whole point and it is also the
thing most likely to be misread later as a node class. The mitigation is textual and it is
worth doing properly: the option's doc comment should carry the `bin/agent.ts:26-31`
sentence, and the phase's summary should state that a provider is a *configuration of the
one node type*, in the same words `fabric-node.ts:16-33` uses about the class that was
deleted. A reader who finds this in six months and sees "the provider node" in prose will
recreate the defect.

**6. `peer:connect` fires before anything is listening for it.** `fabric-node.ts:340-342`
dials every `relayAddrs` entry immediately after `createLibp2p`, and any inbound
connection can arrive from the moment `:303` binds. The verifier cannot exist before `rpc`
(`:355`), so every one of those events is missed. Decision 8's third mechanic — seeding the
cache from `options.peers()` at `start` — is the fix; the residual risk is the window
between `PeerVerifier.start` reading that list and its listeners being attached, which is
synchronous and therefore empty. A behaviour asserting that a node started with
`relayAddrs` *and* `trustedIssuers` ends up with a verdict for its relay is what keeps this
closed.

**7. `bin/agent.ts` cannot be told to dial another agent, so a spawned verifier can only
ever be measured against the test process.** Criterion 2's *accepting* side — a spawned
`bin/agent.ts` node pinning P1 and accepting A's certificate — needs B connected to A, and
no flag on that binary produces an outbound dial except `--provider-addr`, which also
enrols. See "Specifics" for what this phase measures instead and what it records as
**unmeasured**.
</risks>
