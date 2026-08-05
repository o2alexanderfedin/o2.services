---
phase: phase-17-node-identity-enrollment
plan: 05
subsystem: node
tags: [AUTH-01, AUTH-02, AUTH-04, bin/agent.ts, cross-process, enrollment, certificates]

requires:
  - phase: phase-17-node-identity-enrollment/17-01
    provides: "SEED_BYTES / parseKeyHex / peerIdForNodeKey, the identity store, and the widened FsBlockstore filter"
  - phase: phase-17-node-identity-enrollment/17-02
    provides: "the `enrol` wire kind, `enrolOverRpc` / `EnrolOutcome`, and `RpcRecordIndex` as a client"
  - phase: phase-17-node-identity-enrollment/17-03
    provides: "FabricNodeOptions.enrollment / issuesCertificates, FabricNode.nodeKey / certificate / issuerKey"
  - phase: phase-17-node-identity-enrollment/17-04
    provides: "FabricNodeOptions.trustedIssuers, PeerVerifier, the block-source gate, and a node serving its own records"
provides:
  - "`bin/agent.ts`'s five enrollment flags — the production entry point that reaches everything Plans 17-01..17-04 built"
  - "a handshake line carrying nodeKey, the whole certificate and issuerKey, all three always present"
  - "criterion 1 measured across real operating-system processes against a directory that did not exist"
  - "criterion 2 measured with BOTH provider processes dead before the verifier exists"
  - "criterion 3 measured through the production request path, with the threshold read out of the refusal"
  - "`--trusted-issuer` measured through two spawned processes differing in exactly one flag"
affects: [phase-18-discovery-capacity-placement, phase-19-replica-sets, phase-22-reachability-guard]

tech-stack:
  added: []
  patterns:
    - "falsify 'offline' by killing the authority rather than instrumenting a call count"
    - "assert the refusal TEXT, not the exit code: measured, exit 2 alone stayed green under the mutation it existed to catch"
    - "a flag that names a key FILE, never key material, because argv is world-readable in ps"
    - "a user key is not the node's to mint: a missing file is exit 2, not a fresh key"

key-files:
  created:
    - packages/node/src/enrollment.node.test.ts
    - packages/node/src/certificate-verification.node.test.ts
  modified:
    - packages/node/src/bin/agent.ts
    - packages/node/src/fabric-node.ts
    - .planning/phases/phase-17-node-identity-enrollment/deferred-items.md

key-decisions:
  - "`--user-key` names a FILE holding 32 raw bytes, not a hex key. A public key cannot produce the ownerProof `enrol` requires; a private one on argv is readable in `ps` by every account on the host."
  - "A missing or wrong-length user-key file is exit 2, never a freshly minted key. `.identity.key` is created on first use because a node's own identity is its to mint; a user key is not."
  - "The partial-flag-set assertion checks the refusal TEXT. Measured: exit 2 plus `usage` stays GREEN under the mutation that deletes the check, because a second layer refuses and names the wrong thing."
  - "Criterion 2's ACCEPTING side is UNMEASURED through `bin/agent.ts` — that binary has no flag making a spawned agent dial another agent."
  - "Criterion 3 is reported as rate-limiting measured; cost unmeasured. The stated threshold is a threshold per provider *uptime*."

requirements-completed: [AUTH-01, AUTH-02, AUTH-04]

metrics:
  tasks: 3
  commits: 4
  duration: ~70 min
  completed: 2026-08-01
---

# Phase 17 Plan 05: Real processes, and the three criteria measured — Summary

**A node started from `bin/agent.ts` against a directory that did not exist generates its
identity key on that device, enrols against a second real process, and advertises a
certificate a third process fetches over the wire and verifies — with both authorities
killed and their death asserted before the verifier exists, so "offline, no live call" is
falsified rather than argued.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 of 3
- **Files created:** 2 · **modified:** 3
- **Commits:** 4

## Commits

| Hash | Task | What |
|---|---|---|
| `061a966` | 1 | five flags, and a handshake that says who the node is |
| `e08c0f3` | 2 | criteria 1 and 3, measured across real operating-system processes |
| `0f5caec` | 3 | criterion 2, with nobody left alive to have been consulted |
| `11e2d2e` | — | a comment that said "verified" about a line it had stopped describing (Rule 1) |

## The flag the plan specified that could not be built

**`--user-key <hex>` does not exist and could not.** 17-03 measured why:
`FabricNodeOptions.enrollment` takes `userPrivateKey: Uint8Array`, because
`EnrollmentAuthority.enrol` verifies an `ownerProof` — the *user's* signature over the
possession challenge — and refuses `bad-owner-proof` without one. **A public key cannot
sign.** Shipped as written, every enrollment would have been refused by a correctly-named
refusal: a defect that presents as the system working.

**What was built instead: `--user-key <path>`, naming a file of exactly 32 raw bytes.**
Three decisions inside that, each written into the flag's own comment:

1. **A path, not a key.** argv is world-readable in `ps` to every account on the host, so no
   flag on this binary accepts key material at all. That rule was already the reason
   `--issues-certificates` is a boolean; it now covers the user key too, and the module
   comment states it once for the whole file. A path is not a secret; the file it names is.
2. **The file must already exist.** A missing one is exit 2, **not** a freshly generated
   key. `.identity.key` is created on first use because a node's own identity is that
   node's to mint. A *user* key is not: it names the person or organisation several nodes
   belong to, it is signed into `NodeCertificate.userKey` by a provider, and
   `CapabilityRecord.sovereignFor` is derived from it. Minting one to cover a typo'd path
   would enrol the node under a user nobody controls **and report success** — a placeholder
   written into a signed statement, which is the hole `--operator-id` has no default for.
3. **Wrong length is refused by size, not only by absence**, so the check has two readings
   and a test that exercises both.

The alternative considered and rejected was a prompt. It cannot work here: `bin/agent.ts`
is spawned with `stdio: ['ignore', …]` by every harness in this repository and by any
supervisor that runs it, so a prompt would make the binary unstartable in exactly the
configuration this phase exists to measure.

**The `z`.repeat(64) test survives the reframing and gets stronger.** Under the hex flag
that input was the case `fromHex` would silently zero-fill into a valid-looking key a
provider then signed over. Under the path flag it is a path that cannot be read, refused by
name. Both are the same guarantee — a mistyped user key never reaches a signed certificate
— and the second additionally names the input instead of deriving a key from it. Planted
and measured either way: see mutation **E9** below.

## The three criteria, measured

### Criterion 1 — `packages/node/src/enrollment.node.test.ts`

Seven steps in one test, because each is a precondition for the next.

| Step | Reading |
|---|---|
| provider process | `issuerKey` non-null on its handshake; `certificate` null — it issues, it is not itself enrolled |
| on-device | `.identity.key` asserted **absent** before the spawn, then present at exactly 32 bytes |
| not counted as a block | `FsBlockstore.open(aDir).size` is `0` **while** `readdirSync` contains `.identity.key` and `.certificate.json` |
| a certificate, not a peer id | `issuer === provider.issuerKey`, `issuer !== nodeKey`, `userKey` equals the key this test wrote, `operatorId` as passed, `expiresAt > Date.now()` |
| about *this* peer id | `peerIdForNodeKey(nodeKey) === peerId` |
| **not a self-report** | fetched back via `RpcRecordIndex(...).recordsFor(nodeKey)` from a node in the test process; `toStrictEqual` the advertised object, and `verifyCertificate(fetched, new Set([issuerKey]), Date.now()).ok` |
| "for the first time" | SIGTERM, respawn on the same `--dir` against the same **live** provider: same `nodeKey`, same `peerId`, byte-identical certificate, identical `issuedAt` |

The fetch step is what stops the whole test being a self-report: a binary that printed a
plausible object would pass everything above it.

### Criterion 2 — `packages/node/src/certificate-verification.node.test.ts`

**Both provider processes are SIGTERMed and waited for, and their death is asserted,
before the verifier exists.** A node that then reaches a verdict demonstrably contacted
nobody, because there was nobody to contact. That is strictly stronger than instrumenting a
call count — a counter measures the path somebody thought to instrument, a dead process
measures every path there is — and it is 17-03's technique reused.

With P1 and P2 both dead: A's verdict is `{ok: true}`; C's failure is exactly
`{kind: 'untrusted-issuer', issuer: <P2's key>}`; C is **in** `b.transport.peers` and
**not in** `b.verifiedPeers`; A's block arrives and C's does not, asserted in the same test
so the instrument is shown reading both ways.

Both verdicts are asserted **present** before either reading is taken, after a poll with a
stated 30 s deadline — wider than `peer-gate.node.test.ts`'s 15 s because this round trip
crosses a process boundary. Without it the verified set is empty at assertion time, both
fetches return `undefined`, the success half flakes and the failure half passes for the
wrong reason.

### Criterion 3 — `packages/node/src/enrollment.node.test.ts`

Twenty requests through `enrolOverRpc` — the same
`rpc.request(peer, encodeRequest({kind:'enrol', …}))` path production uses — to a spawned
`--issues-certificates` agent.

**Measured across the process boundary: 5 accepted, 15 refused**, read out of green
assertions (`accepted.length === refused[0].refusal.limit` with `limit` asserted `5`, and
`accepted.length + refused.length === 20`). The same split 17-02 measured in process. The
split is **never written down in the test** — it is asserted against the threshold the
refusal itself carries, so the threshold is discoverable by the peer that hit it and not
only from the provider's source. `limit` (5) and `windowMs` (3_600_000) *are* asserted as
literals, because the refusal is required to carry them onto the wire; `retryAfterMs > 0`
and every refusal states the same limit.

## The three sentences this phase owes, in the words required

- **Criterion 3 is: rate-limiting measured; cost unmeasured.** Twenty requests naming twenty
  **distinct** user keys against a second provider process with a fresh history: **all
  twenty succeed**, issuing twenty distinct subject keys. No deletion turns that assertion
  red — planted mutation **E11** removes the rate guard entirely and that test stays
  **green** — and that is the finding, not a gap. AUTH-04's *"so mass fake-node creation is
  costly"* is **not demonstrated**: the limiter is keyed on `userKey` and a fresh user key
  is one `ed25519.keygen()` call. What would change it — a proof-of-work, a payment, or an
  out-of-band identity check — is out of scope for v1.1, and `enrollment.ts:49-55` is where
  it would plug in.
- **The stated threshold is a threshold per provider *uptime*, not per wall-clock window.**
  The issuance history is a `Map` in the authority object, so a provider that restarts
  forgets every issuance. Measured across processes rather than inferred: a third test
  exhausts one user key's budget against provider 1 one request at a time, then has the
  **same** user key accepted immediately by provider 2. **That the threshold survives a
  provider restart is unmeasured and false.**
- **Criterion 2's *accepting* side is UNMEASURED through `bin/agent.ts`.** That binary has
  no flag that makes a spawned agent dial another agent — the only outbound dial it can be
  told to make is `--provider-addr`, which also enrols — and a verifier must be connected to
  the peers it verifies. So the verifier is a `FabricNode` in the test process, and this is
  stated in the file's own header in those words. **Descoped is not satisfied; unmeasured is
  not met.** What would close it: a dial/bootstrap-address flag on the binary — a real
  production need, and Phase 18's bootstrap work.

Three more, carried unchanged from 17-04 and restated because they are still true:

- ***"Before treating it as a legitimate peer" is measured for block fetching and unmeasured
  for dispatch, quorum membership and relay use.*** `RpcBlockSource.fetch` is the only
  production consumer of `verifiedPeers` there is.
- **Criterion 2's literal self-signed shape** — `issuer === nodeKey` — is measured at the
  wire in `packages/net/src/enrol-protocol.test.ts` (17-02), not reframed. What this file
  measures is the *unpinned issuer* case, which is the self-signed case from the verifier's
  side and is constructible with production flags only: a second provider process and a
  verifier that pins the first. No `--forge` flag was added.
- **Identity generation does not *require* `crypto.subtle`, and the insecure-context branch
  is unmeasured** — both vitest projects run on a secure origin.
- **`RpcRecordIndex` still has no production caller.** It is used in this plan's tests as a
  client and nowhere else; its first production caller is Phase 18's.

## What `--trusted-issuer` buys, measured through two spawned processes

The one thing in the argv → `FabricNodeOptions.trustedIssuers` mapping that could be
measured across a real process boundary, and **without it that mapping would have had zero
coverage anywhere in this phase.**

G is spawned with `--trusted-issuer <a real provider's key>`; G2 is spawned identically
without it. Neither enrols — a verifier needs no certificate of its own. Both are dialled by
a node in the test process which holds the module, holds the input, and passes the
production `'serves-no-records'` sentinel, so it can never be verified by anybody. The
identical `Task` goes to each through `RemoteExecutor`.

| | outcome, measured |
|---|---|
| **G2** (no flag) | `{ok: true, output: {a: 1}}` — the module was pulled over the wire and the task ran |
| **G** (`--trusted-issuer`) | `{ok: false, reason: "module block missing: bafyreidgxivf7bksytmjmdj7hnyocamilzrxdmbdphcudnv6qb7uuqr6hi"}` |

**The reason is asserted, not the bare `false`.** That dispatch could equally have failed for
want of provenance, for a dead process, or on a timeout, all of which satisfy
`ok === false`. `module block missing: <the moduleCid>` is the block source finding nobody
to ask, which is the gate. `exitCode` and `signalCode` are asserted null on both processes
afterwards, so "the process died" is not an available explanation for either reading.

**The claim that nothing else would notice was checked, not asserted.** Under Mutation D the
whole of `packages/node` was run: **exactly one test failed, and it is this one** — 1
failed, 376 passed, 1 skipped across 36 files.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row is a mutation written into the source,
run, and reverted with `cp` confirmed byte-identical by `cmp`. **No `git checkout`,
`restore`, `stash`, `reset`, `clean` or `add` was used to plant or restore anything** — this
working tree is shared and `fabric-node.ts` alone is edited by five phases.

### Task 2 — `enrollment.node.test.ts`

| # | Mutation | Where | Reddened | Failure output |
|---|---|---|---|---|
| E1 | seed always `generateSeed()`, never persisted | `fabric-node.ts` | 1 | `expected false to be true` at `:290` — `existsSync('.identity.key')` |
| E2 | leading dot dropped from `IDENTITY_FILE` | `identity-store.ts` | 1 | same assertion at `:290`, **overlapping E1** — see the finding below |
| E3 | blockstore filter reverted to `.tmp-` | `fs-blockstore.ts` | 1 | **`expected 2 to be +0`** at `:301` |
| E4 | `certificate: node.certificate` → `null` in the handshake | `bin/agent.ts` | 2 | `expected null not to be null` at `:305` and `:374` |
| E5 | `privateKey: identity.privateKey` deleted from `createLibp2p` | `fabric-node.ts` | 1 | `expected '12D3KooWKqkjH1fQ…' to be '12D3KooWGaHDVBJK…'` at `:316` |
| E6 | `index: records ?? 'serves-no-records'` → bare sentinel | `fabric-node.ts` | 1 | `expected undefined to be defined` at `:323` — the wire fetch |
| E7 | the `loadCertificate` reuse branch short-circuited | `fabric-node.ts` | 1 | `expected 1785576826419 to be 1785576825920` at `:341` — a second certificate 499 ms later |
| E8 | `values['user-key'] === undefined` clause deleted | `bin/agent.ts` | **0, then 1** | see the finding below |
| E9 | `readUserSeed` zero-fills instead of refusing | `bin/agent.ts` | 1 | `promise resolved "{ …(8) }" instead of rejecting` — the node **started** and a provider signed over 32 zero bytes |
| E10 | `parseKeyHex(issuer)` guard disabled | `bin/agent.ts` | 1 | `promise resolved "{ …(8) }" instead of rejecting` |
| E11 | `if (recent.length >= this.#maxPerWindow)` disabled | `core/enrollment.ts` | 2 | `expected 0 to be greater than 0`; `expected false to be true` |
| — | the twenty-distinct-user-keys assertion | — | **0 by design** | stayed **green** under E11, which is the demonstration |

### Task 3 — the four required mutations, verbatim

**Mutation A — the gate is structural.** `packages/node/src/fabric-node.ts`, block-source
thunk reverted from `() => verifier.verifiedPeers` to `() => transport.peers`.

```
$ npx vitest run --project node packages/node/src/certificate-verification.node.test.ts \
                                packages/node/src/peer-gate.node.test.ts

 FAIL  |node| packages/node/src/certificate-verification.node.test.ts > AUTH-02 — criterion 2, with both provider processes dead > accepts the certificate that chains to its pinned issuer, refuses the other by name, and never asks it for a block
AssertionError: expected Uint8Array[ 192, 193, 194, 195 ] to be undefined

- Expected:
undefined

+ Received:
Uint8Array [
  192,
  193,
  194,
  195,
]

 FAIL  |node| packages/node/src/certificate-verification.node.test.ts > AUTH-02 — --trusted-issuer measured through two spawned processes > a spawned agent given --trusted-issuer refuses an unverifiable peer as a block source, and an identical one without it does not
AssertionError: expected true to be false // Object.is equality
 ❯ packages/node/src/certificate-verification.node.test.ts:421:21
    421|     expect(viaG.ok).toBe(false)

 FAIL  |node| packages/node/src/peer-gate.node.test.ts > AUTH-02 — the block source reads the verified subset > fetches from the peer whose certificate chains to a pinned issuer and not from the one that does not
AssertionError: expected Uint8Array[ 192, 193, 194 ] to be undefined
 ❯ packages/node/src/peer-gate.node.test.ts:145:44
```

**Why this is the mutation that proves the gate is structural:** nothing was deleted from a
verifier and no `if` was removed. One thunk was pointed back at the unfiltered set — which
is precisely the change a later refactor is most likely to make by accident, because it
reads as a simplification. It reddens **three** assertions across **two** files, one of them
in a spawned process, which is one more than the plan predicted.

**Mutation B — "valid" and "this peer's" are two guarantees.**
`packages/node/src/peer-verifier.ts`, the `certificate.nodeKey !== expected` check disabled.

```
$ npx vitest run --project node packages/node/src/peer-verifier.node.test.ts

 FAIL  |node| packages/node/src/peer-verifier.node.test.ts > AUTH-02 — the five peer-level refusals > refuses a certificate borrowed from another node as nodeKey-mismatch, naming both keys
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/node/src/peer-verifier.node.test.ts:447:24
    445|
    446|     const verdict = await served.verifier.verify(served.peerId)
    447|     expect(verdict.ok).toBe(false)
       |                        ^
    448|     expect(verdict.ok ? null : verdict.failure).toStrictEqual({
    449|       kind: 'nodeKey-mismatch',

      Tests  1 failed | 14 passed (15)
```

A certificate that is genuinely signed, genuinely unexpired and genuinely chains to a pinned
issuer is still not *this peer's* certificate. Without that check any peer could present a
borrowed one and be verified. One test separates the two, and a single test asserting only
"the certificate is valid" would have conflated them.

**Mutation C — an optional hook with a silent default is a hole.**
`packages/node/src/fabric-node.ts`, the enrollment failure `throw` replaced by `return null`.

```
$ npx vitest run --project node packages/node/src/node-enrollment.node.test.ts

 FAIL  |node| packages/node/src/node-enrollment.node.test.ts > AUTH-01 — a node told to enrol that cannot enrol does not start > rejects with the provider’s own words when the peer issues no certificates, and leaves no socket bound
PrettyFormatPluginError: $$typeof not set
 ❯ Object.get ../../../node_modules/libp2p/src/components.ts:139:16

 FAIL  |node| packages/node/src/node-enrollment.node.test.ts > AUTH-01 — a node told to enrol that cannot enrol does not start > rejects naming the address and our own unreachable wording when nothing answers
AssertionError: expected null to be an instance of Error
 ❯ packages/node/src/node-enrollment.node.test.ts:291:21
    289|     )
    290|
    291|     expect(failure).toBeInstanceOf(Error)
       |                     ^
    292|     const message = (failure as Error).message
    293|     expect(message).toContain(UNREACHABLE_PROVIDER)

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```

Both `rejects.toThrow` behaviours fail, as required. The first one's assertion text is
swallowed by a Vitest pretty-format crash — `start()` **resolved** with a `FabricNode`, and
serialising a live libp2p object throws `$$typeof not set` — which is itself the reading:
the node started. This is the case `.planning/PROJECT.md`'s *"An optional hook with a silent
default is a hole"* names, reproduced: a node told to enrol, unable to, and running anyway.

**Mutation D — the flag, not the mechanism.** `packages/node/src/bin/agent.ts`, the
`trustedIssuers` conditional spread deleted from the `FabricNode.start` call, so the flag is
parsed and then discarded.

```
$ npx vitest run --project node packages/node/src/certificate-verification.node.test.ts

 FAIL  |node| packages/node/src/certificate-verification.node.test.ts > AUTH-02 — --trusted-issuer measured through two spawned processes > a spawned agent given --trusted-issuer refuses an unverifiable peer as a block source, and an identical one without it does not
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/node/src/certificate-verification.node.test.ts:421:21
    419|     // all of which would satisfy a bare `ok === false`. Measured, wit…
    420|     // `module block missing: <cid>`, which is the block source …
      Tests  1 failed | 1 passed (2)

$ npx vitest run --project node packages/node          # the whole package, same mutation
 FAIL  |node| packages/node/src/certificate-verification.node.test.ts > AUTH-02 — --trusted-issuer measured through two spawned processes > …
 Test Files  1 failed | 35 passed (36)
      Tests  1 failed | 376 passed | 1 skipped (378)
```

**Why this mutation matters for a flag rather than for a mechanism:** every other assertion
about `trustedIssuers` anywhere in this phase reaches `FabricNodeOptions` directly and never
through argv. `values['trusted-issuer']` is `string[] | undefined` from `multiple: true`, so
a typo in the flag name or a forgotten spread would leave the flag doing nothing while every
test agreed with it. The second run above is the measurement of that claim rather than the
claim itself: **one** assertion in 378 notices.

### Restores

Every one of the six touched files was backed up with `cp` before its first mutation and
`cmp`-confirmed byte-identical after the last:

```
agent.ts RESTORE OK
fabric-node.ts RESTORE OK
peer-verifier.ts RESTORE OK
core/enrollment.ts RESTORE OK
fs-blockstore.ts RESTORE OK
identity-store.ts RESTORE OK
```

`git status --short` afterwards listed only this plan's own files.

## Findings — two claims measured false, one of them a live defect

### 1. The plan's reddening claim for the partial flag set is FALSE, and the test it justified could not have caught the defect

> *"a partial flag set is refused — the spawn rejects with `exited early with 2` and stderr
> matching `/usage/`. Reddened by deleting the `values['user-key'] === undefined` clause
> from the exit-2 condition."*

Planted and run: **all 7 tests stayed green.** With the clause gone, `readUserSeed` is handed
`undefined`, `readFile` rejects, and the same refusal path catches it — so the binary still
exits 2 and still prints `usage`. Two layers catch the same input, and a field caught by both
layers isolates neither. This is the third instance of that exact shape in this phase (17-03
found it on `parseCertificate`/`parseKeyHex`; 17-04 on an always-constructed index).

**What actually changes is what an operator reads**, measured directly:

```
$ node packages/node/src/bin/agent.ts --dir /tmp/o2-probe-x \
       --provider-addr /ip4/127.0.0.1/tcp/1 --operator-id op-a

agent.ts: --user-key undefined could not be read: The "path" argument must be of type
string or an instance of Buffer or URL. Received undefined
```

It blames a file read for a flag nobody passed, and prints `undefined` as though it were a
path. **A refusal that names the wrong thing is a defect even when the request correctly
fails**, so the assertion was strengthened to require the refusal *name the missing
companion*. Re-planted against the strengthened test, it now reddens with the wrong-thing
message quoted verbatim in the failure output. The second half (`--operator-id` missing) is
asserted the same way.

**Nothing was weakened to make this pass** — the assertion got strictly narrower.

### 2. Risk 4's premise is smaller than it looks, and the number is now a measurement

17-CONTEXT.md Risk 4 says enrollment adds a blocking round trip that existing 30 s handshake
budgets were not sized for. Instrumented over all eleven spawns in
`enrollment.node.test.ts`, timing `spawn()` to the handshake line, at a 1-minute load average
of **23.7**:

| spawn | announce, measured |
|---|---|
| not enrolling (8 spawns) | **421–655 ms** |
| enrolling — dial, `enrol` round trip, certificate written (3 spawns) | **468–552 ms** |

**The enrolling range sits inside the non-enrolling one.** Against a provider on loopback the
extra dial and round trip are below the variance of Node process startup. The budget was
raised to 60 s anyway and the comment says why: the reading is about *this* topology, and a
provider across a real network — or one that accepts a connection and never answers — spends
up to `rpcTimeoutMs` before `start()` rejects. Nothing in either new file asserts on
wall-clock time.

The plan's draft comment for this constant asserted "700–1000 ms" for an enrolling agent.
That figure was never measured and is wrong; the table above replaced it before the file was
committed.

### 3. A false claim in production source, handed to this plan by name

`deferred-items.md` item 1 (17-04) recorded that `fabric-node.ts` states *as verified against
source* that its `createLibp2p` call passes **no `privateKey`**, while 17-01 had added
`privateKey: identity.privateKey` to that very call. The entry names 17-05 as the closer.

Fixed (Rule 1, comment only). The **conclusion** survives and the reason is now the true one:
the key is derived by `identityFromSeed` through `generateKeyPairFromSeed('Ed25519', seed)`,
so it is Ed25519 by construction and `audienceKeyOf`'s two throwing branches remain
unreachable through this factory. What changed is *why* — not "libp2p's default" but "the one
algorithm this repository derives" — and the forward-looking sentence that described Phase 17
as future now says, in the present tense, that Phase 17 added identity *resolution* and **not**
an injection point, so the branch is still unreachable and still unmeasured.

## Incorrect `file:line` citations in 17-05-PLAN.md and 17-CONTEXT.md

Every citation this plan relied on was re-derived by grep. `bin/agent.ts` numbers are
**pre-edit**, i.e. as of base commit `95d66a0`.

| Cited | Actual | What it is |
|---|---|---|
| `bin/agent.ts:26-31` | **`:28-32`** | the "per-node clearance flag, not a node kind" precedent |
| `bin/agent.ts:37-42` | **`:73-78`** | the usage / exit-2 path |
| `bin/agent.ts:44-55` | **`:84-101`** | the `FabricNode.start` call |
| `bin/agent.ts:57-58` / `:58` | **`:111-113`** | the handshake `stdout.write` |
| `bin/agent.ts:60-71` | **`:115-126`** | shutdown handling |
| 17-CONTEXT: *"the whole file is 72 lines"* | **126 lines** | `bin/agent.ts` at the base commit |
| `egress-refusal.node.test.ts:45-95` / `:62-95` / `:63-90` | **`:107-144`** (`AGENT` at `:68`) | `spawnAgent` |
| `egress-refusal.node.test.ts:15` | **`:18`** | the `FsBlockstore` import |
| `egress-refusal.node.test.ts:17-43` | **`:20-66`** | the header comment |
| `egress-refusal.node.test.ts:97-108` | **`:146-167`** doc, `:172` value | the per-file RPC budget and its reasoning (17-03 corrected this once already) |
| `egress-refusal.node.test.ts:196-206` | **`:270-273`** | the `RemoteExecutor` construction |
| `two-process.node.test.ts:47-77` | **`:71-108`** | `spawnAgent` |
| `two-process.node.test.ts:52-76` | **`:81-103`** | the handshake parse |
| `two-process.node.test.ts:53` | **`:82`** | the 30 s announce budget |
| `two-process.node.test.ts:71-74` | **`:99-102`** | the early-exit report |
| `enrollment.ts:22-30` | **`:49-55`** | *"rate-limited, not expensive"* and what would change it |
| `enrollment.ts:83-84` | **`:108`** | *"the unit of quorum diversity"* |
| `enrollment.ts:166-247` | `EnrollmentAuthority` **`:217`**, defaults **`:229-231`**, `enrol` **`:243`** | issuance and the possession-then-window ordering |
| `enrollment.ts:173` | **`:224`** | `#history` |
| `enrollment.ts:178-179` / `:178-180` | **`:229-231`** | `maxPerWindow` 5, `windowMs` 3_600_000, lifetime 30 d |
| `enrollment.ts:214` | **`:288`** | the rate guard |
| `enrollment.ts:260-266` | **`:339-343`** | `verifyCertificate`'s signature |
| `enrollment.ts:270` | **`:344`** | the `trustedIssuers.has` guard |
| `fabric-node.ts:359` | **`:1128`** | the block-source thunk |
| `fs-blockstore.ts:45` | **`:60`** | the block-count filter |
| `peer-gate.node.test.ts` poll helper (no line given) | **`:49`** | `until` |

**Verified correct as written, so a later plan can rely on them:**
`egress-refusal.node.test.ts:211-227` (the `mkdtemp`/`rm` workdir pattern — the `afterEach`
actually ends at `:228`, the range is otherwise exact); `bin/agent.ts:7` (the sample
handshake line the plan asks to update); `fabric-node.ts:16-33` (*"Why there is no second
class"*, whose heading is `:16`); `packages/net/src/enrol-protocol.test.ts` and
`packages/core/src/enrollment.test.ts` as the homes of the self-signed and tampered cases;
`.planning/ROADMAP.md` section `### Phase 22: Reachability Guard` fixing the entry-point
universe at five.

**The plan's non-line claims that were checked and hold:** `RemoteExecutor` takes a required
third `capability` argument and `'dispatches-unauthenticated'` is a legal value;
`RpcRecordIndex` is exported from `@o2/net`'s barrel; `grep -rn "from '\./[A-Za-z0-9._-]*\.test\.ts'"`
still finds no match anywhere, so copying `until` rather than importing it follows the
repository's settled practice.

## Deviations from plan

### Auto-fixed

**1. [Rule 1 — Bug] `--user-key <hex>` replaced by `--user-key <path>`**

- **Found during:** Task 1, before writing a line — 17-03 had already measured it and the
  coordinator handed it forward.
- **Issue:** a public key cannot produce the `ownerProof` `enrol` requires; a private key on
  argv is in `ps`.
- **Fix:** the flag names a file of exactly 32 bytes, must exist, and is refused by name and
  by value when it does not. The `ps`-visibility note is at the flag and again in the module
  comment, which now states the rule for the whole binary.
- **Commit:** `061a966`

**2. [Rule 1 — Bug] The partial-flag-set assertion could not catch its own defect**

- **Found during:** Task 2 mutation verification (finding 1 above).
- **Fix:** assert the refusal **text**, so the check is isolated from the second layer that
  also refuses. Re-planted and confirmed red.
- **Commit:** `e08c0f3`

**3. [Rule 1 — Bug] `viaG.ok === false` was a silence, not a reading**

- **Found during:** Task 3, after measuring the actual outcome rather than accepting the
  boolean. A bare `false` would have been satisfied by a provenance refusal, a dead process
  or a timeout.
- **Fix:** assert `reason` contains `module block missing` **and** the moduleCid. G2's half
  likewise asserts the echoed output rather than a bare `ok`.
- **Commit:** `0f5caec`

**4. [Rule 1 — Bug] A false "verified against source" claim in `fabric-node.ts`**

- **Found during:** reading `deferred-items.md`, which assigns the fix to this plan by name.
- **Fix:** comment only; see finding 3. Behaviour unchanged, `packages/node` re-run green.
- **Commit:** `11e2d2e`

### Departures from the plan's letter, each with its reason

**5. The plan's step-3 assertion is split into three readings, not one.** It asks for
`size === 0` paired with `readdirSync(...).toContain('.identity.key')`. Both are asserted,
plus `.certificate.json`, because two non-block files is what the directory actually holds
after enrollment and mutation **E3** reads `expected 2 to be +0` rather than `1`. Asserting
one of the two would have under-measured the filter by half.

**6. A third criterion-3 test the plan does not list.** The plan says the limit's scope goes
"in the summary rather than being left for a reader to infer". It is asserted instead: the
same user key refused by provider 1 and accepted by provider 2, one request at a time so the
refusal cannot be an artefact of concurrency. A property stated only in prose is a property
nobody will notice breaking.

**7. `--user-key` is not routed through `parseKeyHex`.** It cannot be — it is a path. The
plan's instruction to route both new key flags through it applies to `--trusted-issuer`
only, which is what 17-03's summary already predicted. `parseKeyHex` keeps a production call
site, so Phase 22's guard is unaffected.

**8. `packages/node/src/bin/agent.ts` is permanently modified beyond the plan's flag list**
only in the sense that the module comment gained two sections. No behaviour is in them.

**No existing assertion anywhere was weakened, altered or deleted.** The four files the
plan requires be run and not modified — `fabric-node.node.test.ts`, `two-process.node.test.ts`,
`egress-refusal.node.test.ts`, `sovereignty-placement.node.test.ts` — all pass unchanged and
none appears in `git diff --name-only` over this plan.

## Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | **exit 0**, against a resolver **proven** to read this worktree |
| `npx vitest run --project node` | **1520 passed**, 19 skipped (106 files, 2 skipped) |
| `npx vitest run --project node packages/node` | **377 passed**, 1 skipped (36 files) |
| `npx vitest run --project browser` | **3198 passed** (213 files, 3 engines) |
| `npx vitest run --project e2e` | **40 passed** (8 files) |
| `vocabulary` + `purity` + `serve-agent-hooks` + `trust-anchors`, run **after** committing | **66 passed** |
| `git status --short` after the last restore | only this plan's own files |

`--project perf` was **not run**, and that is a decision rather than an omission: it exists
only under `O2_PERF=1` and its assertions *are* wall-clock measurements. The host's 1-minute
load average sat between 4 and 53 throughout this plan, so any number it produced would be a
measurement of the machine's contention. Nothing this plan adds is timing-based.

### Resolver provenance — and why it was proved rather than assumed

The worktree had no `node_modules`. The obvious fix is silently wrong: the main install's
`@o2/*` entries are **relative** symlinks (`../../packages/core`), so a wholesale
`node_modules` symlink resolves them back into the main checkout, and `tsc` and `vitest`
would verify the wrong tree and report clean **without reading a line of these changes**.
For a proof plan that is the worst available failure — a specification that passes because
it read somebody else's code.

A farm was built instead: 184 third-party entries symlinked at the main install, and a real
`@o2` directory whose eight entries point at **this worktree's** `packages/*` by absolute
path. Proved with `createRequire` before any result was trusted:

```
@o2/core       …/agent-abd1d540670c154a9/packages/core/src/index.ts
@o2/net        …/agent-abd1d540670c154a9/packages/net/src/index.ts
@o2/libp2p     …/agent-abd1d540670c154a9/packages/libp2p/src/index.ts
@o2/node       …/agent-abd1d540670c154a9/packages/node/src/index.ts
@o2/browser    …/agent-abd1d540670c154a9/packages/browser/src/index.ts
libp2p         /Volumes/…/o2.services/node_modules/libp2p/dist/src/index.js
vitest         /Volumes/…/o2.services/node_modules/vitest/index.cjs
```

**And `tsc` was proved to read this worktree by planting a type error rather than by reading
the config**, because `tsconfig.json` has no `paths` and the proof above only covers Node's
resolver:

```
packages/node/src/bin/agent.ts(324,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

Line 324 exists only in the edited file — the pre-edit one is 126 lines. Restored with `cp`
and `cmp`-confirmed.

### The skips, each a pre-existing environment gate

19 skipped in the node project, none of them this plan's: `packages/aot/src/elf.real.node.test.ts`
and `wasi-real.node.test.ts` (absent real ELF fixtures), `tools/aot/lift.node.test.ts`'s
Docker-image cases, and `transport-bounds.node.test.ts`'s retained-bytes reading, which is
load-gated at a 1-minute average of 12 and skipped loudly — the gate `<INHERITED>` names, not
a change here.

### One failure that is not this plan's, logged rather than fixed

`tools/aot/lift.node.test.ts` produced **6 failures at a 1-minute load average of ~45** and
**73 passes at 4.41** on the same commit with no source change between the runs. The failing
group bounds `resolveImage(...)` by `IMAGE_RESOLVE_CAP_MS` against a **stubbed** `docker`, so
what is being measured on a contended host is process scheduling. It imports nothing this
plan touched (`grep -cE "bin/agent|fabric-node|enrollment|certificate-verification|trustedIssuers"`
returns **0**; its only first-party import is `./lift.ts`).

Pre-existing and out of scope, so it was **not** fixed — logged as entry 5 in
`deferred-items.md` with the load gate `transport-bounds.node.test.ts` already uses named as
what would close it. Widening the budget instead would remove the only reading that bounds
it.

## Known stubs

None. Every flag added here has a production call path and a cross-process test that
exercises it, and both new files assert against real spawned processes throughout.

## Equal functionality — the one gap, restated because it widened again

**A browser node still cannot obtain a certificate, and this plan widened the gap further:**
`bin/agent.ts` now has five flags reaching identity, enrollment and verification, and
`BrowserNode` has no equivalent entry point at all. `deferred-items.md` entry 3 holds the
measurement and the four absent mechanisms.

**This is not a decision keyed on node kind** — nothing anywhere branches on what kind of
node something is, and there is no field to branch on. It is four absent mechanisms in a
second factory, one of which (`PeerVerifier` in `@o2/node`, not importable from
`@o2/browser`) is blocked outright by packaging. It is a real functional asymmetry, it is
the shape the project's standing rule exists to catch, and reporting it is the whole point of
the rule. Until it lands, *"a browser node enrols and is verified on identical terms"* is a
claim this repository cannot make. It is **not** structurally unprovable —
`browser-capability.e2e.test.ts` already drives a real tab.

## Threat flags

| Flag | File | Description |
|------|------|-------------|
| `threat_flag: key-path-on-argv` | `packages/node/src/bin/agent.ts` | `--user-key` puts the **path** to a user's private key in `ps` output. The bytes never reach argv, but the location does, which narrows an attacker's search from the filesystem to one name. The file's own permissions are the whole of the protection and this binary does not check them; a `0o600` check on read was considered and left out because it would refuse deployments that manage secrets through a group-readable mount, and refusing a working configuration is a worse default than naming the risk. |
| `threat_flag: signed-field-from-argv` | `packages/node/src/bin/agent.ts` | `--operator-id` becomes a field of a provider-signed certificate and is the unit of quorum diversity Phase 19 will build anti-affinity on. **Nothing verifies that it is true**; what is enforced is that it was *stated*, which is the whole of what the exit-2 path buys. An operator who lies about it gets a signed statement that says what they lied. |
| `threat_flag: trust-pinned-by-argv` | `packages/node/src/bin/agent.ts` | `--trusted-issuer` is the whole of a node's trust and there is no live authority to correct a mistake. The exit-2 check catches a value that is not 64 lowercase hex characters; it **cannot** catch a well-formed key belonging to somebody else, and this design does not protect against that. An operator who pins the wrong key gets a node that talks to the wrong fabric and reports nothing. |

## Notes for Phase 18

1. **The dial flag is Phase 18's, and it closes criterion 2's remaining half.** A
   bootstrap/dial-address flag on `bin/agent.ts` would let a spawned verifier be connected
   to a spawned enrolled peer, which is the one thing this phase could not measure.
2. **`RpcRecordIndex` still has no production caller** — 9 occurrences, every one in a
   `.test.ts`, this plan's included. Its first is Phase 18's `discoverExecutors` wiring.
3. **Routing `discoverExecutors` through `verifiedPeers`** is what would widen "legitimate
   peer" past block fetching. Until then, dispatch candidate selection, quorum membership and
   relay use are unmeasured.
4. **Anything new written into a node's blockstore directory must be dot-prefixed.** The
   filter *is* the counter — mutation E3 measured `2` where `0` belongs, on the production
   path across a real process.
5. **`bin/agent.ts` now carries nine flags** and its `parseArgs` block is the file's bulk.
   14-CONTEXT.md Risk 3's standing note — *"whichever phase touches this block next should
   fold all three into one flags object rather than accreting a fourth"* — is now well past
   due, and this plan deliberately did not do it: a refactor of the argv block in the same
   diff as the flags it adds would have made both unreviewable.

## Self-Check: PASSED

Files claimed created, listed off disk:

```
FOUND  packages/node/src/enrollment.node.test.ts              28516 bytes
FOUND  packages/node/src/certificate-verification.node.test.ts 20097 bytes
FOUND  packages/node/src/bin/agent.ts (modified)              17660 bytes
FOUND  .planning/phases/phase-17-node-identity-enrollment/17-05-SUMMARY.md
```

Commits claimed, found in `git log --oneline 95d66a0..HEAD`:

```
FOUND  11e2d2e  fix(17-05): a comment that said "verified" about a line it had stopped describing
FOUND  0f5caec  test(17-05): criterion 2, with nobody left alive to have been consulted
FOUND  e08c0f3  test(17-05): criteria 1 and 3, measured across real operating-system processes
FOUND  061a966  feat(17-05): five flags, and a handshake that says who the node is
```

Constraint checks:

- `.planning/STATE.md` and `.planning/ROADMAP.md` — **not modified.** `git diff --name-only`
  over the whole plan lists exactly five files: `packages/node/src/bin/agent.ts`,
  `packages/node/src/fabric-node.ts`, the two new tests, and `deferred-items.md`.
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` run after **each** of the four commits:
  empty every time. No tracked file was deleted.
- Every planted mutation restored with `cp` and `cmp`-confirmed byte-identical. **No git
  write command was used to plant or restore anything.**
- `npx tsc --noEmit` — exit 0, against a resolver proved twice to read this worktree.
