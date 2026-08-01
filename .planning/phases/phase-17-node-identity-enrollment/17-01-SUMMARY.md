---
phase: phase-17-node-identity-enrollment
plan: 01
subsystem: auth
tags: [ed25519, libp2p, peer-id, identity, seed, blockstore, noble-curves]

requires:
  - phase: phase-6
    provides: "requestEnrollment / EnrollmentAuthority / verifyCertificate and the NodeCertificate shape whose nodeKey this plan builds the key for"
  - phase: phase-2
    provides: "the portability tiers purity.node.test.ts enforces, which decide that this module lands in @o2/libp2p and its store in @o2/node"
provides:
  - "@o2/libp2p identity module: SEED_BYTES, generateSeed, identityFromSeed, peerIdForNodeKey, nodeKeyForPeerId, parseKeyHex, SeedLengthError, NodeIdentity"
  - "one 32-byte on-device seed read as both a hex nodeKey and a libp2p peer id, mapping pure in both directions with no lookup table and no network call"
  - "parseKeyHex — the phase's single hex-key validator, which every key string in phases 17-02..17-05 must route through"
  - "@o2/node identity store: IDENTITY_FILE, PROVIDER_FILE, loadOrCreateSeed, hasSeed, MalformedSeedFileError"
  - "FsBlockstore.open no longer counts a dot-prefixed file as a block, with the measured collision figures recorded in source"
affects: [17-02, 17-03, 17-04, 17-05, phase-18, phase-19, phase-22]

tech-stack:
  added:
    - "@libp2p/crypto@5.1.21 (packages/libp2p/package.json only)"
    - "@noble/curves@2.2.0 (packages/libp2p/package.json only)"
  patterns:
    - "one seed, two namespaces — a derived identity rather than two independently-settable names that can disagree"
    - "a validator proved in BOTH directions: rejections alone would pass against `() => null`"
    - "a structural grep paired with a known positive, so a zero is a reading and not a silence"
    - "anything written into a blockstore directory that is not a block must be dot-prefixed"

key-files:
  created:
    - packages/libp2p/src/identity.ts
    - packages/libp2p/src/identity.test.ts
    - packages/node/src/identity-store.ts
    - packages/node/src/identity-store.node.test.ts
  modified:
    - packages/libp2p/src/index.ts
    - packages/libp2p/package.json
    - packages/node/src/fs-blockstore.ts
    - packages/node/src/fs-blockstore.node.test.ts
    - packages/node/src/index.ts

key-decisions:
  - "The plan's stated reason for rejecting uppercase hex is FALSE and was not written into production source. Number.parseInt is case-insensitive over hex, so an uppercase key parses to the SAME bytes and derives the SAME peer id. The rejection is kept; the reason recorded is the true one — a string-namespace rule."
  - "The peer-id derivation test is a PIN, not a feature proof. The plan's stated reddening mutation was measured and does not redden, and cannot, because the plan's own premise is that the two derivations are byte-identical."
  - "packages/node/src/fs-blockstore.node.test.ts already existed and is tracked. A describe block was appended; no existing assertion was modified or weakened."
  - "Errors are named classes (SeedLengthError, MalformedSeedFileError) rather than bare Error, so a caller can distinguish them without matching message text."

patterns-established:
  - "Measure before writing a number down, including into a source comment: the block-count collision figures (6 and 2) are measurements taken against the unwidened filter, not predictions."
  - "Mutation-verify every <proof> claim rather than restating it — one of eight claims in this plan was false and only planting the mutation revealed it."

requirements-completed: [AUTH-01]

duration: 22min
completed: 2026-08-01
---

# Phase 17 Plan 01: One seed, two namespaces — Summary

**A node's libp2p peer id and its certificate's `nodeKey` are now two readings of one 32-byte on-device seed, mapping to each other as a pure function in both directions; the seed survives a restart at mode `0o600`, and no longer inflates the block count it sits beside.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2 of 2
- **Files created:** 4 · **Files modified:** 5
- **Commits:** 4 (two TDD gate pairs)

## Accomplishments

- **The two namespaces are bridged by construction.** `identityFromSeed` derives `nodeKey` with exactly the call `requestEnrollment` already uses (`toHex(ed25519.getPublicKey(seed))`) and takes `peerId` from the private key's own public half, so it is the peer id libp2p would choose rather than one this module invents. `peerIdForNodeKey` and `nodeKeyForPeerId` invert each other offline, proved over four seeds.
- **`parseKeyHex` closes the `fromHex` zero-fill hole**, and its doc records what a reader would otherwise assume wrongly — with the *correct* reasons, two of which the plan got wrong (below).
- **The blockstore collision was measured, not predicted**, then fixed, and the figures are recorded in `fs-blockstore.ts` beside the rule they imply.
- **Three engines, not one.** `identity.test.ts` is a plain `.test.ts`, so it runs in the node project *and* the browser project: 17 tests × chromium/firefox/webkit = 51 passing. The plan's contingency for splitting the file when `@libp2p/crypto`'s browser build failed was **not needed** — no such failure occurred.

## Task Commits

1. **Task 1 (RED)** — `bd3df6e` `test(17-01): a node's two names, asserted before either exists`
2. **Task 1 (GREEN)** — `d9ea757` `feat(17-01): one seed a node reads as both of its names`
3. **Task 2 (RED)** — `69b59e9` `test(17-01): the seed on disk, and the count that was already wrong`
4. **Task 2 (GREEN)** — `8747436` `feat(17-01): a seed that survives a restart, and is not counted as a block`

Both RED gates were observed failing before their implementation existed (`Cannot find module './identity.ts'`, `Cannot find module './identity-store.ts'`), and Task 2's second RED produced a real measurement rather than only an import error.

## Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | exit 0 |
| `vitest --project node packages/node packages/libp2p` | 31 files, **336 passed** |
| `vitest --project node packages/core packages/net` | 45 files, **599 passed** |
| `vitest --project browser packages/libp2p` | 6 files, **63 passed** (2 specs × 3 engines) |
| `vitest --project node packages/node/src/vocabulary.node.test.ts` | 24 passed (run *after* committing — it scans `git ls-files`) |

`fabric-node.node.test.ts` was **run and not modified**, as the plan requires.

### Resolver provenance

The worktree had no `node_modules`. A farm was built — third-party symlinked from the main install, every `@o2/*` repointed at **this worktree's** `packages/*` — and proved with `createRequire(...).resolve` before any test was trusted:

```
WORKTREE  @o2/core    -> …/agent-a5e30cee675726caa/packages/core/src/index.ts
WORKTREE  @o2/libp2p  -> …/agent-a5e30cee675726caa/packages/libp2p/src/index.ts
MAIN      @libp2p/crypto, @noble/curves, vitest, typescript
```

Every RED failure was then confirmed to name the worktree path.

## Measurements taken

**The block-count collision, against the unwidened `!name.startsWith('.tmp-')` filter:**

| Directory contents | `FsBlockstore.open(dir).size` |
|---|---|
| 3 blocks | 3 |
| 3 blocks + `.identity.key` + `.provider.key` + `.certificate.json` | **6** |
| 1 block + `.identity.key` | **2** |

Exactly one extra per non-block file, because that filter *is* the block counter. After widening to `!name.startsWith('.')` all three read 3, 3 and 1.

**Dependency equality**, `toHex(ed25519.getPublicKey(seed))` vs `(await generateKeyPairFromSeed('Ed25519', seed)).publicKey.raw`, over all-zero / all-`0xff` / a fixed pattern / a generated seed: **equal in all four**. The `0x07` seed reproduces `ea4a6c63e29c520a…` as 17-CONTEXT records.

**The confident wrong answer `parseKeyHex` prevents:** `fromHex('z'.repeat(64))` is 32 zero bytes, `publicKeyFromRaw` accepts them, and the peer id is `12D3KooW9pNAk8aiBuGVQtWRdbkLmo5qVL3e2h5UxbN2Nz9ttwiw` — exactly as the plan states.

**A stronger case the plan did not name.** A real key with its last byte corrupted to non-hex keeps 31 of 32 bytes:

```
true     …191bd67e0b0d4276  ->  12D3KooWHiVVwUzdYE7kNB7CfcqgfQvkbMKrQvGZCyihmBCfRsgR
unguarded …191bd67e0b0d42zz  ->  12D3KooWHiVVwUzdYE7kNB7CfcqgfQvkbMKrQvGZCyihmBCfRseP
```

The two differ only in the final two characters. This is now a test.

## Corrections — incorrect citations and false claims, for 17-02..17-05

**Two of these are false statements, not drift.** Both were headed for production source and were not written.

### Falsehoods

| # | Where | Plan/CONTEXT says | Measured truth |
|---|---|---|---|
| F1 | 17-01 `<interfaces>`, `<behavior>`, `<action>`, and 17-CONTEXT "sharp edge" section | "`Number.parseInt('AB', 16)` is `171`, so an uppercase key parses to bytes that **differ** from the lowercase form `toHex` emits, and the round trip breaks with no error anywhere" | **False.** `parseInt` is case-insensitive over hex: `parseInt('AB',16) === parseInt('ab',16) === 171`. An uppercase key parses to the **same bytes** and derives the **same peer id**. Nothing cryptographic goes wrong. The real hazard is the **string** namespace — `PublicKeyHex` is compared with `===`, held in `Set`s and used as `Map` keys, and `toHex` only ever emits lowercase, so one key with two spellings is two identities to `verifyCertificate`'s `trustedIssuers.has(certificate.issuer)`, where a **pinned** issuer spelled uppercase reads as `untrusted-issuer`. The rejection is kept; the reason in `parseKeyHex`'s doc is the true one. |
| F2 | 17-01 `<proof>`, bullet 3 | "the derived peer id is the one libp2p itself would choose … **Reddened by** deleting the `peerIdFromPublicKey(privateKey.publicKey)` line in `identityFromSeed` and deriving the peer id from `nodeKey` instead" | **False, and self-contradictory.** Planted and measured: **17/17 still pass.** It cannot redden, because the plan's own premise is that the two derivations are byte-identical. The test is a **pin, not a feature proof**, and now says so. A genuine confusion defect (assigning `peerId` the `nodeKey` string) does redden it — 4 tests. |

### Wrong file / wrong claim

| # | Plan says | Actual |
|---|---|---|
| W1 | "Write `packages/node/src/fs-blockstore.node.test.ts` … **It is a new file**" | **It already exists and is git-tracked**, holding DATA-02 conformance and a `.tmp-` case. A describe block was appended. No existing assertion was modified or weakened. The plan's *substance* was right — nothing covered `size` across a reopen with a non-block, non-`.tmp-` file — but "new file" would have clobbered two live suites. |
| W2 | `start-probe.ts:31` (no package given) | Line 31 is correct; the file is `packages/browser/src/start-probe.ts`, not under `packages/node/src/`. |
| W3 | "Extend `packages/libp2p/src/index.ts` with one new export block, **after the existing two**" | There are **three** existing export blocks (transport, AUTH-03 `audienceKeyOf`, NET-07 constants). Added as the fourth. |
| W4 | 17-CONTEXT decision 4: `EnrollmentResult`'s refusal arm is "**two kinds**, `bad-proof-of-possession` and `rate-limited`" | **Three.** `EnrollmentRefusal` (`enrollment.ts:193-198`) also carries `{ kind: 'bad-owner-proof'; userKey }` at `:196`, documented as *"the named user did not sign. A different event from the one above."* **17-02 owns the wire encoding and must encode and parse all three**, or a legitimately-refused enrollment decodes as `null` and the caller cannot tell a refusal from a malformed response. |

### Line drift

`packages/node/src/fabric-node.node.test.ts` — cited identically in 17-01 `<interfaces>`, `<read_first>`, `<proof>` and 17-CONTEXT decision 2 / Risk 1:

| Citation | Actual |
|---|---|
| `:206` `sizeBeforeRestart = worker.store.size` | **`:253`** |
| `:214` `expect(reopened.size).toBe(sizeBeforeRestart)` | **`:261`** |
| `:200-220` (the `<read_first>` range) | **`:248-266`** |

`packages/core/src/enrollment.ts` — 17-CONTEXT's symbol table and 17-01's `<read_first>`. **Everything is roughly +40 to +75 lines**, so 17-02 (which owns `enrol-protocol`) should re-grep rather than trust any of these:

| Symbol | Cited | Actual |
|---|---|---|
| `NodeCertificate.nodeKey` is hex | `:80` | `:104-105` |
| `possessionChallenge` | `:117` | `:142` |
| `requestEnrollment` | `:135` | `:176` (derivations at `:181-182`) |
| `EnrollmentRefusal` (`rate-limited` arm) | `:144-146` | `:193-198` |
| `EnrollmentAuthority` | `:166` | `:217` |
| issuance defaults (`maxPerWindow` 5, `windowMs` 3_600_000, lifetime 30 d) | `:178-180` | **`:229-231`** |
| `#history` Map | `:173` | `:224` |
| `issuerKey` getter | `:183-185` | `:234` |
| `issuedWithin` | `:188-190` | `:239` |
| `enrol` proves possession first | `:192-211` | `:243` (possession `:248-262`, window `:287-299`) |
| `verifyCertificate` | `:265` | `:339` |
| `untrusted-issuer` refusal | `:270-276` | `:344-350` |
| `bad-signature` | `:284-290` | `:358-363` |
| `not-yet-valid` | `:292-298` | `:365-370` |
| `expired` | `:299-305` | `:372-377` |
| `resolveReplicaSets` | `:325` | `:399` |
| `CertificateFailure` kinds | — | `:323-327` |

`packages/node/src/fabric-node.ts` — 17-01 and 17-CONTEXT decision 2:

| Citation | Actual |
|---|---|
| `:104-113` — the `blockstoreDir` "persistence is a deployment choice" doc | **`:115-125`** |
| `:271-274` — store selection | **`:483-487`** |

**Verified correct, so 17-02..17-05 can rely on them:**

- `packages/core/src/capability.ts:33-46` — `toHex` / `fromHex` / `PublicKeyHex`: exact.
- `packages/node/src/fs-blockstore.ts:42-47` `open()`, `:65-69` tmp-then-rename, `:76-80` the Buffer copy: exact (pre-change).
- `packages/node/src/purity.node.test.ts` — `PORTABLE` `:28`, `DUAL_TARGET` `:36`, `FORBIDDEN` `:46-52`, `NO_PLATFORM` `:55-58`, `NODE_ONLY_SPEC` `:74`, manifest check `:119-128`: all exact. Note the manifest check applies to **`PORTABLE` only**, so adding `@libp2p/crypto` to the dual-target manifest is legal by construction, not by luck.
- `node_modules/@libp2p/crypto/dist/src/keys/ed25519/index.js:2` noble import, `:41` `derivePublicKey(seed)` under the "seed is used directly as private key" comment: exact. `derivePublicKey` is `:13-14`, not `:13-15`.
- `index.browser.js` — `subtle.generateKey` at module load: `:14` (within the cited `:11-20`). noble fallbacks: `hashAndSign` `:72-80`, `hashAndVerify` `:92-99` (cited `:72-79`, `:91-100`).
- `packages/node/src/egress-refusal.node.test.ts:211-227` — the `mkdtemp`/`rm` workdir pattern, reused here.
- `vitest.config.ts` — node project `:145-166`, browser `:169-198` (excludes `**/*.node.test.ts`, three engines at `:195`).

## Deviations from Plan

### [Rule 1 — Bug] The plan's uppercase justification was false and was not written into source

- **Found during:** Task 1, while measuring the plan's empirical claims before implementing.
- **Issue:** The `<action>` block instructs, verbatim, that `parseKeyHex`'s doc state that an uppercase key "round-trips into a different identity". Measured: it does not. Writing it would have put a false security claim into production source — the exact defect class the phase brief warns has already happened twice.
- **Fix:** Kept the rejection and the assertion (both still redden as the plan says). Replaced the *reason* with the measured one, and asserted **both halves** in the test — that the bytes and peer id are identical, *and* that `new Set([nodeKey]).has(upper)` is `false` — so the reason cannot silently drift back.
- **Files:** `packages/libp2p/src/identity.ts`, `packages/libp2p/src/identity.test.ts`
- **Commit:** `d9ea757`, `bd3df6e`

### [Rule 1 — Bug] A `<proof>` claim that does not hold

- **Found during:** Task 1 mutation verification.
- **Issue:** The plan asserts a specific single-line mutation reddens the peer-id test. It does not (17/17 pass), and cannot.
- **Fix:** Labelled the test a pin in its own docblock, with the measurement and with the mutation that *does* redden it. Per the plan's own standard: *"where there is none, that is stated rather than left to imply a guarantee."*
- **Commit:** `d9ea757`

### [Rule 3 — Blocking] `fs-blockstore.node.test.ts` already existed

- **Found during:** Task 2. `Write` refused the path, which is what surfaced it.
- **Fix:** Read the file, appended a new `describe` block. Two pre-existing suites (DATA-02 conformance, persistence across a reopen) untouched.
- **Commit:** `69b59e9`

### [Rule 2 — Missing critical functionality] Named error classes and an aliasing guard

- `SeedLengthError` and `MalformedSeedFileError` are named classes, not bare `Error`, so `17-03` can distinguish "no identity yet" from "the file is corrupt" without matching message text.
- `loadOrCreateSeed` copies out of Node's `Buffer` pool. The project constraint *"a blockstore adapter must not alias its input or its storage"* applies with more force to a private key: handing back a view into a shared slab would expose unrelated bytes. Asserted by a test that mutates one caller's copy and requires the next call to be unaffected — mutation N6 confirms it reddens.
- `hasSeed` was added (not in the plan) so 17-03 can report *"generated a new identity"* vs *"reused the existing one"* without a create-then-check race.

## Mutation verification

Every `<proof>` claim was planted and measured, then restored and confirmed byte-identical by `cmp`.

| # | Mutation | Tests reddened |
|---|---|---|
| M1 | `parseKeyHex` body → `return null` | 2 |
| M2 | pattern → `/^[0-9a-fA-F]{64}$/` | 1 |
| M3 | `peerIdForNodeKey` skips the validator | 3 |
| M4 | `nodeKeyForPeerId` drops the `Ed25519` guard | 1 |
| M5 | `peerId` derived from `nodeKey` (**the plan's claim**) | **0 — claim false** |
| M5b | `peerId` assigned the `nodeKey` string | 4 |
| M6 | `identityFromSeed` seed-length throw deleted | 1 |
| N1 | `FsBlockstore` filter reverted to `.tmp-` | 2 — **one of them in `fabric-node.node.test.ts`** |
| N2 | `{ mode: 0o600 }` deleted | 1 |
| N3 | `PROVIDER_FILE` = `IDENTITY_FILE` | 1 |
| N4 | wrong-length throw deleted | 1 |
| N5 | `readFile` back-path removed | 5 |
| N6 | `Buffer` handed back without copying | 4 |

N1 reddening `fabric-node.node.test.ts` is the confirmation that the pre-existing restart assertion is genuinely what the filter change protects — not an inference from reading it.

## Known Stubs

None. Every export in this plan is either called by a test in this plan or has its production call site named and scheduled (see below).

## Reachability note for Phase 22

`peerIdForNodeKey`, `nodeKeyForPeerId`, `parseKeyHex`, `loadOrCreateSeed` and `hasSeed` are exported from package barrels with **no production call path yet** — by design, since this plan deliberately wires nothing into `FabricNode`. Their committed call sites:

- `peerIdForNodeKey` → **17-03 Task 3** `resolveCertificate`, `peerIdForNodeKey(loaded.nodeKey) === identity.peerId`.
- `loadOrCreateSeed` / `identityFromSeed` / `generateSeed` → **17-03**, before `createLibp2p`.
- `parseKeyHex` → **17-05** `bin/agent.ts`'s `--user-key` / `--trusted-issuer`, and 17-03's `loadCertificate`.
- `nodeKeyForPeerId` → **17-03**'s verifier, deriving the expected `nodeKey` on `peer:connect`.

If any of those plans drops its call, the corresponding export must come out of the barrel with it and the tests import from the file directly. Phase 22's guard is specified to fail on exactly this.

## Unmeasured — stated, not descoped

- **The insecure-context branch.** The `subtle` guard proves the two new source files do not name `crypto.subtle`, paired with a known positive (5 occurrences in `@libp2p/crypto`'s browser ed25519 build) so the zero is a reading. It proves nothing about the dependency, which *does* touch `subtle` at module load inside a `try/catch` returning `false`. Both vitest projects run on a secure origin, so that branch is never taken anywhere in this repository. The entitled claim is *identity generation and derivation do not require `crypto.subtle`* — **not** "nothing on this path touches it". Measuring it needs the demo bundle served over plain `http://` on a LAN address; first runnable under Phase 19's multi-browser standard.
- **Browser-tier identity persistence.** Out of scope per the plan; `BrowserNode.start()` has no runtime test in either vitest project.
- **Whether the identity survives a real process restart.** Proved here only at the store level (`loadOrCreateSeed` twice against one directory). End to end across a real spawn is 17-03/17-05's `enrollment.node.test.ts`.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema at a trust boundary. It adds a private key **at rest**, mitigated by `0o600` and by tmp-then-`rename`; both are asserted.

## Notes for the next plan

1. **Route every hex key string through `parseKeyHex`.** It is exported from `@o2/libp2p`. `@o2/net` must **not** import it — a portable package may not take `@libp2p/*` transitively — so `parseCertificate` keeps its string typing and the key check goes on top, in `@o2/node`.
2. **`SEED_BYTES` is 32 and `generateKeyPairFromSeed` rejects any other length** with `"seed" must be 32 bytes in length.` — measured. `identityFromSeed` throws first, with its own named error.
3. **Do not add these dependencies to `@o2/core` or `@o2/net`.** `purity.node.test.ts` fails on the manifest as well as the imports.
4. **`.certificate.json` is already covered by the dot rule** — asserted in `fs-blockstore.node.test.ts` before 17-03 writes one.
5. Machine load reached 19.8 during the final sweep. No assertion added by this plan is timing-based, so nothing here is load-sensitive.

## Self-Check: PASSED

All created files exist:

- `packages/libp2p/src/identity.ts` — FOUND
- `packages/libp2p/src/identity.test.ts` — FOUND
- `packages/node/src/identity-store.ts` — FOUND
- `packages/node/src/identity-store.node.test.ts` — FOUND

All commits exist: `bd3df6e`, `d9ea757`, `69b59e9`, `8747436` — FOUND.

Constraint checks:

- `packages/node/src/fabric-node.ts` — **not touched** (`git diff --name-only` over the whole plan lists 9 files, none of them `fabric-node.ts`).
- `.planning/STATE.md`, `.planning/ROADMAP.md` — **not modified**.
- `npx tsc --noEmit` — exit 0, against a resolver proved to read this worktree.
