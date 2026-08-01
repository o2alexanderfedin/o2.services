---
phase: phase-17-node-identity-enrollment
plan: 04
subsystem: auth
tags: [libp2p, certificates, ed25519, discovery, rpc, peer-verification]

requires:
  - phase: phase-17-node-identity-enrollment/17-01
    provides: "one derivation between peer id and NodeCertificate.nodeKey (`nodeKeyForPeerId`), and the on-device identity seed"
  - phase: phase-17-node-identity-enrollment/17-02
    provides: "the `enrol` wire kind and `enrolOverRpc`, plus `UNREACHABLE_PROVIDER`"
  - phase: phase-17-node-identity-enrollment/17-03
    provides: "the startup path: a node generates its identity, enrols, and persists its certificate"
provides:
  - "A node's provider-signed certificate is fetchable by any peer over the `records` request that has answered `null` in production since Phase 6"
  - "`PeerVerifier` — one named verdict per peer, computed offline against pinned issuer keys, proven offline by stopping the provider process"
  - "`FabricNodeOptions.trustedIssuers`, `FabricNode.verifiedPeers`, `FabricNode.verdictFor`"
  - "The gate: `RpcBlockSource` reads the verified subset, so an unverified peer is never asked for a block"
  - "First production callers for `verifyCertificate`, `publishCapabilities` and `MemoryRecordIndex`"
  - "A measured upstream defect in `main-event@1.0.4`: libp2p keeps calling a listener it reports as removed"
affects: [phase-17-node-identity-enrollment/17-05, phase-18-scheduling-placement, phase-19-replica-sets]

tech-stack:
  added: []
  patterns:
    - "Gate at the thunk, not in the transport: swapping one peer-list thunk is the whole of the gate, so there is no `if` anywhere that could be forgotten"
    - "A stated absence over a safe default: omitting `trustedIssuers` means this node verifies nobody, and the verifier then does no work at all rather than computing verdicts nothing reads"
    - "Peer-level failure kinds live with the peer, not in the kernel: `CertificateFailure` is about a document, the five added kinds are about a conversation"
    - "Pin an upstream defect with an assertion against the real object, in the discipline `RESERVATION_FAILURE_PREFIX` already uses"

key-files:
  created:
    - packages/node/src/peer-verifier.ts
    - packages/node/src/peer-verifier.node.test.ts
    - packages/node/src/node-records.node.test.ts
    - packages/node/src/peer-gate.node.test.ts
    - .planning/phases/phase-17-node-identity-enrollment/deferred-items.md
  modified:
    - packages/node/src/fabric-node.ts
    - packages/node/src/index.ts

key-decisions:
  - "The `records` index holds this node's own records and nothing else; `provide()` is never called, so `providers` still answers [] from every node. Phase 17 publishes, Phase 18 queries."
  - "`sovereignFor` carries `certificate.userKey`, never `sovereignty.ownerId` — the fixture's owner id is deliberately not a hex key so publishing the label instead fails visibly."
  - "`PeerVerifier` issues its own `records` request rather than reusing `RpcRecordIndex`; planted and measured, routing through that adapter costs both `unreachable` and `unanswerable-peer`."
  - "A node with an empty anchor set never subscribes and never asks, so `verdictFor` is undefined by construction rather than by winning a race — measured as zero requests beside a counter shown reading one."
  - "`PeerVerifier.stop()` cannot rely on `removeEventListener` against a real libp2p; a `#stopped` guard carries the guarantee, and the upstream behaviour is pinned by a test."

patterns-established:
  - "Plant every reddening claim rather than restating it: two claims inherited from the plan and its predecessors were measured false this way"
  - "Take the same reading against both a stub and the real object; the disagreement is the finding"

requirements-completed: [AUTH-02]

duration: 47min
completed: 2026-08-01
---

# Phase 17 Plan 04: Serving an identity, and refusing one — Summary

**A node's provider-signed certificate is now fetchable by any peer over the `records`
request that has answered `null` in production since Phase 6, a second node verifies it
with the provider process stopped, and an unverified peer is never asked for a block —
enforced by one thunk rather than by an `if` anywhere.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-08-01T01:29Z
- **Completed:** 2026-08-01T02:16Z
- **Tasks:** 3 of 3
- **Files created:** 5 · **modified:** 2

## Commits

| Commit | Task | What |
|---|---|---|
| `8456bc5` | 1 | a node's certificate is something a peer can fetch, not just something it holds |
| `c8ea6f9` | 2 | a verdict per peer, named, and reached without asking anybody |
| `2bc6e85` | 3 | an unverified peer is never asked for a block, and there is no `if` to forget |

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | exit 0, against a resolver **proven** to read this worktree |
| `npx vitest run --project node packages/node` | 34 files, **368 passed**, 1 skipped |
| `npx vitest run --project node` (whole project) | 106 files, **1511 passed**, 19 skipped |
| `vocabulary.node.test.ts` (after committing) | 24 passed |

**The resolver proof, because a wholesale `node_modules` symlink is silently wrong.** The
main install's `@o2/*` entries are **relative** symlinks (`../../packages/core`), so following
them through a symlinked `node_modules` resolves back into the main checkout — `tsc` and
`vitest` would then verify the wrong tree and report clean without reading a line of these
changes. A farm was built instead: every third-party entry symlinked at the main install, and
a real `@o2` directory whose entries point at **this worktree's** packages by absolute path.
Proven with `createRequire(<worktree>/packages/node/src/fabric-node.ts)`:

```
OK   @o2/core   -> …/agent-a9fa5359ac0215fb2/packages/core/src/index.ts
OK   @o2/net    -> …/agent-a9fa5359ac0215fb2/packages/net/src/index.ts
OK   @o2/node   -> …/agent-a9fa5359ac0215fb2/packages/node/src/index.ts
OK   @o2/libp2p -> …/agent-a9fa5359ac0215fb2/packages/libp2p/src/index.ts
OK   @o2/browser, @o2/bench, @o2/aot, @o2/demo  (same tree)
libp2p -> /Volumes/…/o2.services/node_modules/libp2p/dist/src/index.js
FARM PROVEN: every @o2/* resolves inside this worktree
```

**The skips are pre-existing environment gates, not this plan.** The one skip inside
`packages/node` is `transport-bounds.node.test.ts`'s retained-bytes reading, which skipped
loudly at `host load 22.39 >= 12` — the gate `<INHERITED_READ_THIS_FIRST>` names. The other 18
are Docker-image absence (`tools/aot/lift.node.test.ts`), absent real ELF fixtures
(`packages/aot/src/elf.real.node.test.ts`, `wasi-real.node.test.ts`) and an absent LAN IP.

**The `browser` project was not run, and here is why that is not a gap rather than an
omission.** It excludes `**/*.node.test.ts`, every test in `packages/node/src` carries that
suffix, and `@o2/browser` does not import `@o2/node` at all — measured: the only occurrence of
the string `@o2/node` anywhere under `packages/browser` is a prose mention in `src/index.ts:4`.
No file this plan touched is reachable from that project.

## The Risk 3 grep, command and full output

17-CONTEXT.md Risk 3 asks whether turning the `index` hook on changes what any existing
consumer reads. The belief that the blast radius is zero is the kind of belief the v1.0 audit
was about, so it is checked rather than asserted. **A run that reported zero hits anywhere
would have found a broken instrument, not a clear field** — so the recorded output below
contains the known positives.

```
$ grep -rn "kind === 'providers'\|kind !== 'providers'\|kind === 'records'\|kind !== 'records'\|kind: 'providers'\|kind: 'records'" packages/ tools/ --include="*.ts"

packages/net/src/named-refusal.test.ts:234:        await rpc.request(node.nodeId, encodeRequest({ kind: 'records', nodeKey: 'ab12' })),
packages/net/src/agent.ts:593:    } else if (request.kind === 'providers') {
packages/net/src/agent.ts:597:        kind: 'providers',
packages/net/src/agent.ts:600:    } else if (request.kind === 'records') {
packages/net/src/agent.ts:602:        kind: 'records',
packages/net/src/protocol.ts:93:  | { readonly kind: 'providers'; readonly cid: CID }
packages/net/src/protocol.ts:95:  | { readonly kind: 'records'; readonly nodeKey: PublicKeyHex }
packages/net/src/protocol.ts:142:  | { readonly kind: 'providers'; readonly nodeKeys: readonly PublicKeyHex[] }
packages/net/src/protocol.ts:144:  | { readonly kind: 'records'; readonly records: NodeRecords | null }
packages/net/src/protocol.ts:502:  if (request.kind === 'providers') {
packages/net/src/protocol.ts:503:    return { kind: 'providers', cid: request.cid }
packages/net/src/protocol.ts:505:  if (request.kind === 'records') {
packages/net/src/protocol.ts:506:    return { kind: 'records', nodeKey: request.nodeKey }
packages/net/src/protocol.ts:661:    return { kind: 'providers', cid }
packages/net/src/protocol.ts:667:    return { kind: 'records', nodeKey }
packages/net/src/protocol.ts:828:      return { kind: 'providers', nodeKeys: [...response.nodeKeys] }
packages/net/src/protocol.ts:831:        ? { kind: 'records', found: false }
packages/net/src/protocol.ts:833:            kind: 'records',
packages/net/src/protocol.ts:888:      return { kind: 'providers', nodeKeys }
packages/net/src/protocol.ts:891:      if (record['found'] !== true) return { kind: 'records', records: null }
packages/net/src/protocol.ts:897:      return { kind: 'records', records: { certificate, capabilities } }
packages/net/src/discovery.test.ts:447:        encodeRequest({ kind: 'providers', cid: fabric.inputCid }),
packages/net/src/discovery.test.ts:451:      if (response?.kind !== 'providers') return
packages/net/src/discovery.test.ts:457:          encodeRequest({ kind: 'records', nodeKey: worker.nodeKey }),
packages/net/src/discovery.test.ts:461:      if (records?.kind !== 'records') return
packages/net/src/discovery.test.ts:475:          encodeRequest({ kind: 'records', nodeKey: worker.nodeKey }),
packages/net/src/discovery.test.ts:479:      if (response?.kind !== 'records') return
packages/net/src/discovery.ts:46:      const response = await this.#ask(peer, encodeRequest({ kind: 'providers', cid }))
packages/net/src/discovery.ts:47:      if (response?.kind !== 'providers') continue
packages/net/src/discovery.ts:55:      const response = await this.#ask(peer, encodeRequest({ kind: 'records', nodeKey }))
packages/net/src/discovery.ts:56:      if (response?.kind !== 'records') continue
```

Widened with a second sweep over `RpcRecordIndex` / `MemoryRecordIndex` / `FallbackRecordIndex`
/ `.recordsFor(` / `discoverExecutors` / `publishCapabilities` / `verifyCertificate(`, which
adds only `packages/net/src/{discovery,sovereign-execution,enrol-agent,enrol-protocol}.test.ts`,
`packages/core/src/{discovery,enrollment}.test.ts` and
`packages/node/src/{node-enrollment,identity-store}.node.test.ts`.

**Reading:** every response-side consumer is a **test**. The known positives the plan named are
present (`discovery.ts:47` and `:56`; `net/src/discovery.test.ts` and `sovereign-execution.test.ts`),
so the instrument reads. **No production consumer exists**, and `two-process.node.test.ts` passes
unchanged, which is the behavioural half of the same check.

## Call sites, counted by grep and never transcribed

| Symbol | Production call sites | Where |
|---|---|---|
| `serveAgent({` | **6** | `bench/src/perf-workload.ts:187`, `:210`; `browser/src/browser-node.ts:564`; `node/src/bin/bench.ts:376`, `:421`; `node/src/fabric-node.ts:1230` |
| `verifyCertificate(` | **3** | `core/src/enrollment.ts:406` (in `resolveReplicaSets`), `core/src/discovery.ts:260` (in `discoverExecutors`), **`node/src/peer-verifier.ts:299` (new)** |
| `publishCapabilities(` | **1** | **`node/src/fabric-node.ts:630` (new)** |
| `new MemoryRecordIndex(` | **1** | **`node/src/fabric-node.ts:627` (new)** |
| `new RpcRecordIndex(` | **0** | all 9 occurrences are `.test.ts` |

`packages/bench/src/perf-workload.ts` holds two of the six `serveAgent` sites — the file the
corrections table says no plan in this phase names. It was counted, not assumed, and it is
unchanged by this plan: `serve-agent-hooks.node.test.ts` still reads `2` for its
`'serves-no-records'` occurrences and passes.

**A precision the plan got loosely right.** `verifyCertificate` did have two callers before
this plan, both inside `@o2/core` — but `resolveReplicaSets` has **no** caller anywhere outside
tests, and `discoverExecutors`'s only non-test occurrence is its own declaration. So the
accurate statement is that `verifyCertificate` had **no traced call path from a runnable entry
point**, and now it has one.

## What each task measured

### Task 1 — a node serves its own records

Four tests in `node-records.node.test.ts`, all against real `FabricNode`s over real libp2p.

- A's certificate deep-equals what B fetches through the wire; the capability record verifies
  against A's own node key; its validity window is the certificate's own.
- `features: []` asserted explicitly, with the reason: no feature-detection dependency exists
  in this repository (`wasm-feature-detect` is recommended in `CLAUDE.md` and is not installed;
  `packages/browser/src/wasm-probes.ts` builds probe modules and detects no engine features),
  and `discoverExecutors` only excludes on features a caller asked for.
- `sovereignFor` is `[a.certificate.userKey]`, asserted equal to the key derived from the
  enrollment seed, with the node's `ownerId` deliberately `'alice'` — **not** a hex key — so
  publishing the label instead is visible. Both cleared-for-nobody readings are taken
  (`canExecuteSovereign: false`, and no `sovereignty` option at all), because a one-sided test
  could not tell an always-empty list from a correct one.
- A serves its own records and nobody else's: `undefined` for another key, `[]` for `providers`.

### Task 2 — `PeerVerifier`

Fourteen tests. The three that carry the most weight:

- **Offline is measured, not inspected.** `await p1.stop()` runs *before* the first verdict is
  computed, and verification still succeeds. A live authority could not survive that.
- **All four kernel refusal names are asserted through this class.** Planting the exact defect
  the plan warns about — replacing the `verifyCertificate` call with a hardcoded
  `{kind:'untrusted-issuer', …}` — reddens exactly the three kernel-refusal tests and leaves
  the unpinned-issuer test **green**, which is the demonstration that asserting one of the four
  and describing the rest would have proved nothing.
- **`no-records` and `unreachable` are distinguishable.** Both in one test, against two
  different peers. `no-records` is taken against a real certificate-less `FabricNode` passing
  the production sentinel; `unreachable` against a real Ed25519 peer id nothing is serving, so
  `RpcFailure`'s typed detail survives into `detail`.

All five peer-level kinds are measured, not just the two the plan named — `unidentifiable-peer`
and `unanswerable-peer` got their own tests, so no declared union member is unmeasured.

### Task 3 — the gate

Five tests in `peer-gate.node.test.ts`. The instrument is shown reading **both ways in one
test**: B fetches a block that exists only in A's local store and gets `undefined` for one that
exists only in C's, after **both verdicts have been asserted present**. Without that
precondition the verified set would be empty at assertion time, both fetches would return
`undefined`, the success half would be a flake and the failure half would pass for the wrong
reason.

The exclusion is named beside the connection: `b.transport.peers` contains C, `b.verifiedPeers`
does not, and `b.verdictFor(c.peerId).failure` is exactly `{kind:'untrusted-issuer', issuer:
p2.issuerKey}`.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row is a mutation that was written into the
source, run, and reverted with `cp` confirmed by `cmp` (never `git checkout` — this working
tree is shared).

| Mutation | Where | Reddened |
|---|---|---|
| `index: records ?? 'serves-no-records'` → bare sentinel | `fabric-node.ts` | 4 of 5 in `node-records` |
| `publishCapabilities(identity.seed, …)` → `generateSeed()` | `fabric-node.ts` | 1 (the subject-key test only) |
| `[certificate.userKey]` → `[sovereignty.ownerId]` | `fabric-node.ts` | 1 (the label test only) |
| delete `if (!trustedIssuers.has(certificate.issuer))` | `core/src/enrollment.ts:344` | unpinned-issuer |
| `verifyCertificate(…)` → hardcoded `untrusted-issuer` | `peer-verifier.ts` | the 3 kernel-refusal tests; unpinned-issuer stayed **green** |
| delete `certificate.nodeKey === expected` | `peer-verifier.ts` | nodeKey-mismatch (17-05 Mutation B) |
| direct `rpc.request` → `RpcRecordIndex.recordsFor` | `peer-verifier.ts` | `no-records`/`unreachable` **and** `unanswerable-peer` |
| delete `if (trustedIssuers.size === 0) return verifier` | `peer-verifier.ts` `start` | zero-requests |
| delete the seeding loop | `peer-verifier.ts` `start` | already-connected **and** zero-requests |
| delete the memo lookup | `peer-verifier.ts` `verify` | one-request-per-connection |
| make the disconnect handler inert | `peer-verifier.ts` | drop-on-disconnect |
| `stop()` → `{}` | `peer-verifier.ts` | stop-removes-listeners |
| delete `expiresAt <= now` | `core/src/enrollment.ts:373` | expired |
| delete `issuedAt > now` | `core/src/enrollment.ts:366` | not-yet-valid |
| thunk → `() => transport.peers` | `fabric-node.ts` | the gate test (17-05 Mutation A) |
| delete the empty-anchor short-circuit in `verifiedPeers` | `peer-verifier.ts` | the no-anchors regression bar |
| delete `this.#verifier.stop()` | `FabricNode.stop()` | stop-removes-listeners (gate) |

Task 2's RED was additionally taken the literal way: the real `peer-verifier.ts` was replaced
by a not-implemented skeleton and the suite run — **13 of 14 failed**. The one that passed was
`unidentifiable-peer`, because the skeleton returned exactly that; it is covered by its own
mutation above.

## Findings — two false claims measured, not repeated

### 1. The plan's fourth Task 1 reddening claim is FALSE

> *"a node with no certificate serves none — Reddened by changing
> `certificate === null ? null : new MemoryRecordIndex()` to always construct one."*

Planted and run: **all five tests stayed green.** An always-constructed index that never had
anything published into it answers `recordsFor` with `undefined`, `agent.ts:604` maps that to
`records: null` with `?? null`, and the frame on the wire is byte-identical to the sentinel's.
There is nothing for a certificate-less node to publish, so **no edit inside this plan can
redden that assertion**. It is a regression bar, not a feature proof — the same status
`node-enrollment.node.test.ts`'s "a node not told to enrol" test carries — and the test's own
comment now says so in place of the plan's claim.

### 2. `PeerVerifier.stop()` could not have worked, and only the real-libp2p reading found it

This was **not** deduced from reading source. The stub-`EventTarget` reading in
`peer-verifier.node.test.ts` passed; the real-libp2p reading in `peer-gate.node.test.ts`
failed. The difference, measured directly against the installed package:

```
after add + dispatch      calls = 1   listenerCount = 1
after remove + dispatch   calls = 2   listenerCount = 0     ← still called
plain EventTarget control calls = 1
```

`Libp2p extends TypedEventEmitter` from `main-event@1.0.4` (`libp2p/dist/src/libp2p.js:25`).
Its `addEventListener` registers an **anonymous wrapper** with `super.addEventListener`
(`main-event/dist/src/index.js:89-104`); its `removeEventListener` hands the **caller's**
listener to `super.removeEventListener` (`:116-124`) — a function that was never registered. So
removal prunes only the bookkeeping array that feeds `listenerCount`.

The shape is the worst available: **a counter that reports the listener gone while it is still
being called.** A `stop()` built on removal alone would have read as correct through libp2p's
own instrument and done nothing.

**Fixed (Rule 1)** with a `#stopped` flag both handlers check first, so the guarantee does not
depend on a third party's listener-removal implementation. `removeEventListener` is still
called — it is correct against a conforming `EventTarget` and keeps `listenerCount` honest —
and the upstream behaviour is **pinned by an assertion against a real libp2p object**, in the
discipline `RESERVATION_FAILURE_PREFIX` already uses, so a fix upstream is noticed rather than
silently making the flag redundant.

## Incorrect `file:line` citations in 17-04-PLAN.md, for 17-05

Every citation the plan makes was re-derived by grep, and **a first draft of this table was
itself wrong** — four rows asserted a correction to a citation that was already right. They were
checked against the files rather than against memory before this was written, which is the same
discipline the table exists to enforce.

The `fabric-node.ts` set is off by **+570 to +700 lines** and `enrollment.ts` by **+67 to +74** —
the same drift 17-01…17-03 reported, larger. `core/src/discovery.ts` and `net/src/index.ts` are
almost entirely correct.

`fabric-node.ts` numbers are **pre-edit**, i.e. as of base commit `86e4dba`.

| Plan says | Actually | What it is |
|---|---|---|
| `fabric-node.ts:359` | **`:992`** | the `RpcBlockSource` thunk — the gate's seam |
| `fabric-node.ts:420` | **`:1122`** | `index: 'serves-no-records'` |
| `fabric-node.ts:348` | **`:916`** | `const sovereignty = options.sovereignty ?? …` |
| `fabric-node.ts:355` | **`:946`** | `const rpc = new RpcEndpoint(` |
| `fabric-node.ts:340-342` | **`:898-902`** | the `relayAddrs` dial loop |
| `fabric-node.ts:381` | **`:643`** | `private constructor(parts: {` |
| `fabric-node.ts:344-392` | **`:909-992`** | the construction window Task 3 edits |
| `fabric-node.ts:519-524` | **`:1242-1251`** | `async stop()` |
| `fabric-node.ts:141-148` | **`:366-373`** | `FabricNodeOptions.relayAddrs` and its doc |
| `fabric-node.ts:303` | *no such line* | cited as where inbound connections arrive; `:303` is a bare ` *` inside a doc comment, and no line in the file is that |
| `enrollment.ts:265` | **`:339`** | `export function verifyCertificate(` |
| `enrollment.ts:260-266` | **`:339-343`** | its signature |
| `enrollment.ts:270-276` | **`:344-350`** | the `untrusted-issuer` guard |
| `enrollment.ts:270` | **`:344`** | `if (!trustedIssuers.has(certificate.issuer))` |
| `enrollment.ts:284-290` | **`:358-364`** | `bad-signature` |
| `enrollment.ts:292-298` | **`:366-372`** | `not-yet-valid` |
| `enrollment.ts:292` | **`:366`** | `if (certificate.issuedAt > now)` |
| `enrollment.ts:299-305` | **`:373-379`** | `expired` |
| `enrollment.ts:299` | **`:373`** | `if (certificate.expiresAt <= now)` |
| `net/src/discovery.ts:52` and `:46` | **`:56`** and **`:47`** | the `kind !== 'records'` / `!== 'providers'` checks (the `encodeRequest` lines above them *are* `:55` and `:46`) |
| `net/src/agent.ts:169-181` | **`:593-605`** | the `providers` and `records` handler branches |
| `net/src/agent.ts:174`, `:180` | **`:598`**, **`:604`** | the `[]` and `null` answers |
| `net/src/agent.ts:36-59` | **`:39-62`** | the `RpcBlockSource` class |
| `net/src/agent.ts:46` | **`:48`** | `RpcBlockSource.fetch` — `:46` is the constructor's closing brace |
| `net/src/rpc.ts:100-135` | **`:27-54`** | `RpcError` and `RpcFailure` (`:100-135` is `RpcHandler` and `unwrapReply`) |
| `core/src/discovery.ts:286-290` | **`:287-290`** | the `sovereignFor` comparison — off by one at the start only |
| `sovereign-execution.test.ts:105`, `:150`, `:157` | **`:174`, `:212`, `:297`** | the hex-owner-id fixture (`ownerId: aliceUserKey`) |
| `relaying.node.test.ts:80` | **`:89`** | the local `until` helper |
| `rendezvous-wire.node.test.ts:77` | **`:89`** | the same helper |

**Correct as written, verified individually:** `net/src/discovery.ts:35-69`, `:53-60`, `:62-68`;
`net/src/index.ts:13`; `core/src/discovery.ts:81` (`sovereignFor: readonly PublicKeyHex[]`),
`:101` (`publishCapabilities`), `:157` (`ExecutorQuery.sovereignFor`), `:278-284` (the
`requiredFeatures` exclusion), `:357-382` (`MemoryRecordIndex`, whose doc line is `:357` and
whose `class` line is `:358`); `enrollment.ts:229-231` (the issuance defaults);
`relayed-job.node.test.ts:35` (the local `until` helper).

The plan's claim that `grep -rn "from '\./[A-Za-z0-9._-]*\.test\.ts'" packages/ --include="*.ts"`
finds no match anywhere was **re-run and holds**, so the local-`until`-helper duplication is
following the repository's own settled practice rather than inventing one.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] `PeerVerifier.stop()` did not remove its listeners from a real libp2p**

- **Found during:** Task 3, when `peer-gate.node.test.ts`'s stop test failed while the
  equivalent stub-`EventTarget` reading passed.
- **Issue:** measured above — `main-event@1.0.4` keeps calling a listener it reports as removed.
- **Fix:** a `#stopped` flag both handlers check, plus a pinning test against a real libp2p
  object so an upstream fix is noticed.
- **Files:** `packages/node/src/peer-verifier.ts`, `packages/node/src/peer-gate.node.test.ts`
- **Commit:** `2bc6e85`

### Departures from the plan's letter, each with its reason

**2. `verify()` never rejects; the `catch` is inside it, not on the connect handler.** The plan
puts a `catch` on the `peer:connect` call site that records an `unreachable` verdict. Putting it
inside `verify` is the same effect and strictly stronger: *every* caller gets a named verdict
rather than a rejection, which is what "every exclusion is named" is worth nothing without. The
connect handler is then a plain `void this.verify(...)` with a comment saying why that is not a
floating rejection.

**3. `ownRecords` is a module-level helper taking `canExecuteSovereign`, not the inline
`records?.publish({ certificate, … })` the plan writes.** The plan's form does not typecheck:
`records?.publish` does not narrow `certificate` from `NodeCertificate | null`, so the object
literal is a type error. The helper narrows at the call site and gives the four decisions a
place to be written down once.

**4. Hand-built `records` answers are served through `rpc.serve` rather than through
`serveAgent`'s `index` hook.** Same encoders — `parseRequest` in, `encodeResponse` out — so
nothing about the frame is simulated, and `serveAgent` would have added six required hooks none
of these six cases reads. The production `index` hook is exercised by Task 1 against real nodes,
which is where it belongs.

**5. Two extra tests beyond the plan's behaviour list:** `unidentifiable-peer` and
`unanswerable-peer`. Both are declared members of `PeerFailure`, and an unmeasured union member
is the same shape as an optional hook with a silent default.

**No existing assertion was weakened, altered or deleted.** Every mutation planted above was
reverted with `cp` and confirmed byte-identical with `cmp`.

## Limits, in the words the plan requires

- ***"Legitimate peer" is measured for block fetching and UNMEASURED for dispatch, quorum
  membership and relay use.*** `RpcBlockSource.fetch` is the only production consumer of
  `verifiedPeers` there is — counted by grep, not assumed. Dispatch candidate selection has no
  production caller to gate until Phase 18's placement work, and inventing one here to have
  something to gate would be this milestone's own defect in the opposite direction. **What would
  measure it:** Phase 18 routing `discoverExecutors` through the same set.
- ***`RpcRecordIndex` still has no production caller; its first is Phase 18's.*** It is used in
  this plan's tests as a client and nowhere else — 9 occurrences, every one in a `.test.ts`.
  `PeerVerifier` issues its own request because that class collapses "unreachable" and "answered
  null" into one `undefined`, which was planted and measured to cost two failure kinds, not one.

## Known stubs

None. `features: []` is **not** a stub — it is an honest empty list, asserted as such with the
reason in the test and in the source, and nothing reads `requiredFeatures` yet.

## Deferred items

Recorded in
`.planning/phases/phase-17-node-identity-enrollment/deferred-items.md`, four entries:

1. **A false claim in `fabric-node.ts:1029-1032`** — the comment says the `createLibp2p` call
   passes *"no `privateKey`"*; `:919` passes `privateKey: identity.privateKey`. Introduced by
   17-01 and not updated. Its conclusion survives (the identity is still Ed25519, so
   `audienceKeyOf`'s throwing branches are still unreachable and still unmeasured) but its stated
   reason does not, and its forward-looking sentence now describes a phase that has landed. Not
   fixed here: nothing in 17-04 touches `audienceKeyOf`, and rewriting a neighbouring paragraph
   would put an unreviewable edit in a diff meant to be readable.
2. `PeerVerifier` is unreachable from the browser tier — a packaging fact, with the one-file fix.
3. A browser node still cannot obtain a certificate — see below.
4. AUTH-04's cost is still unmeasured, carried forward from 17-02.

## The browser-certificate finding: not closed, and exactly why

**Measured, not assumed.** `packages/browser/src/browser-node.ts` has no identity seed, no
`privateKey` on its `createLibp2p` call (`:387-397`), no `enrollment` option, no `certificate`
field, and passes `index: 'serves-no-records'` (`:622`) and `enroll: 'issues-no-certificates'`
(`:626`) unconditionally. So *"a browser node enrols and is verified on identical terms"* remains
a claim this repository cannot make.

**This is not the Phase 16 defect recurring.** Nothing anywhere branches on a kind of node —
there is no field to branch on. It is four **absent** mechanisms, and each is its own decision:

1. a persisted identity seed in the browser tier. IndexedDB is evicted silently under storage
   pressure, so "persisted" is a claim that needs its own measurement before it is made;
2. an `enrollment` option plus the dial and `enrolOverRpc` round trip on `BrowserNode.start`;
3. `ownRecords` at the `index` hook — portable, and the only one of the four that is a copy;
4. `trustedIssuers` and a `PeerVerifier`, which deferred item 2 blocks outright: `@o2/browser`
   does not depend on `@o2/node`, so the class is not importable from that tier until it moves
   to `@o2/net`.

Item 1 is an architectural decision about browser-tier persistence — Rule 4, not something to
take unilaterally inside a plan whose `files_modified` does not include `browser-node.ts`. Item 4
cannot be done at all until the packaging move lands. And doing any subset would produce a
browser node holding an identity it cannot persist, or verifying peers that cannot verify it —
asymmetries worse than the current honest absence.

**It is not structurally unprovable.** `packages/node/src/browser-capability.e2e.test.ts` already
drives a real tab, so the `e2e` project can measure the whole of it once the mechanisms exist.

## Threat flags

None. The `index` hook now answers with a provider-signed certificate and a node-signed
capability record — both public statements whose entire purpose is to be read by a stranger —
and `providers` still answers `[]` from every node because `provide()` is never called. No new
network endpoint, auth path, file access pattern or schema at a trust boundary was introduced;
the `records` request kind, its encoding and its handler branch all predate this plan.

## Self-Check: PASSED

Files claimed created, listed off disk with `ls -la`:

```
FOUND  packages/node/src/peer-verifier.ts                    17372 bytes   340 lines
FOUND  packages/node/src/peer-verifier.node.test.ts          30111 bytes
FOUND  packages/node/src/node-records.node.test.ts           12583 bytes
FOUND  packages/node/src/peer-gate.node.test.ts              13189 bytes
FOUND  .planning/…/deferred-items.md                          4994 bytes
FOUND  .planning/…/17-04-SUMMARY.md                          32077 bytes
```

The plan's `must_haves.artifacts` requires `packages/node/src/peer-verifier.ts` at
`min_lines: 80`; it is **340**.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  2bc6e85  feat(17-04): an unverified peer is never asked for a block, and there is no if to forget
FOUND  c8ea6f9  feat(17-04): a verdict per peer, named, and reached without asking anybody
FOUND  8456bc5  feat(17-04): a node's certificate is something a peer can fetch, not just something it holds
```

No commit in this plan deleted a tracked file: `git diff --diff-filter=D --name-only HEAD~1 HEAD`
was run after each of the three and returned empty every time.
