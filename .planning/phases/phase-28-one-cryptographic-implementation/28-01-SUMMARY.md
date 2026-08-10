---
phase: 28-one-cryptographic-implementation
plan: 1
subsystem: core-crypto
tags: [ed25519, capability-gate, de-duplication, reachability-guards]
requires:
  - packages/core/src/capability.ts
  - packages/core/src/cert-lifecycle.ts
provides:
  - "one Ed25519 selection module in packages/core, gated by a real round-trip probe"
  - "a barrel two callable exports lighter, with both reachability ceilings lowered to measured readings"
affects:
  - packages/core/src/ed25519-backend.ts
  - packages/core/src/cert-lifecycle.ts
  - packages/core/src/capability.ts
  - packages/core/src/index.ts
  - packages/node/src/reachability.node.test.ts
  - packages/node/src/reachability-guard.node.test.ts
  - packages/node/src/reachability-dispositions.ts
tech-stack:
  added: []
  patterns:
    - "capability decided by a real round-trip probe, never by presence of an API surface"
    - "a one-member union as the type-level statement that a port has exactly one implementation"
key-files:
  created: []
  modified:
    - packages/core/src/ed25519-backend.ts
    - packages/core/src/ed25519-backend.test.ts
    - packages/core/src/cert-lifecycle.ts
    - packages/core/src/cert-lifecycle.test.ts
    - packages/core/src/cert-lifecycle.browser.test.ts
    - packages/core/src/capability.ts
    - packages/core/src/index.ts
    - packages/node/src/reachability.node.test.ts
    - packages/node/src/reachability-guard.node.test.ts
    - packages/node/src/reachability-dispositions.ts
decisions:
  - "The round-trip probe survives as the single gate; the presence-only check is deleted, not bypassed"
  - "toBase64Url/fromBase64Url moved to capability.ts rather than duplicated, because importing them back from cert-lifecycle.ts would have closed a cycle"
  - "The ed25519-backend.ts#verify collision pin is REMOVED, against the plan's prediction, because the measured reading no longer contains it"
metrics:
  duration: ~75 min
  completed: 2026-08-10
---

# Phase 28 Plan 01: One Module, One Selection, One Gate — Summary

Merged `packages/core`'s two Ed25519 backend-selection mechanisms into
`ed25519-backend.ts`, keeping `cert-lifecycle.ts`'s real
`subtle.generateKey({name:'Ed25519'})` round-trip probe as the surviving gate and
deleting the presence-only check and the WASM fallback arm it guarded.

**This is behaviour-neutral in production and the merged module's docblock says so.**
Production Ed25519 verification calls `@noble/curves` directly at six sites
(`capability.ts:219`, `enrollment.ts:702`/`:740`/`:759`/`:874`, `discovery.ts:122`) and
routes through neither selection layer. Nothing in production calls `initEd25519()`,
`getSyncVerifier()`, `getAsyncVerifier()` or `createCryptoBackend()`. So this removes a
duplication from the package, **not** a hazard from the trust path, and no production
behaviour changed. The plan's own framing, kept.

## What merged and what was deleted

**Moved** out of `cert-lifecycle.ts:466-575` into `ed25519-backend.ts`, verbatim apart
from import adjustments: `CryptoArm`, `CryptoBackend`, `ed25519PrivateJwk`,
`x25519PrivateJwk`, `x25519PublicJwk`, `toBufferSource`, `nobleCryptoBackend`,
`subtleCryptoBackend`, `backendPromise`, `createCryptoBackend`, `detectCryptoBackend`.
`CryptoBackend`'s three `Signature` positions were widened to `Uint8Array` (its
definition) so the merged module does not import a type back out of `cert-lifecycle.ts`
and close a cycle.

**Deleted**: `createLibsodiumSyncVerifier` and its `import('libsodium-wrappers')`;
`createSubtleAsyncVerifier`, which was a *second* `subtle` verify implementation sitting
beside `subtleCryptoBackend.verifyEd25519`.

**Rewritten**: `initEd25519()` now holds no capability decision — it awaits
`createCryptoBackend()`, sets the sync port to noble and the async port to an adapter
over the probed backend. `Ed25519Backend` narrowed from `'noble' | 'libsodium'` to
`'noble'`.

**Shared byte helpers.** `toBase64Url` was needed by the moved JWK builders *and* still
needed at `cert-lifecycle.ts:642`; importing it back from `cert-lifecycle.ts` would have
closed the cycle `cert-lifecycle.ts → ed25519-backend.ts → cert-lifecycle.ts`. It and its
pair `fromBase64Url` moved to `capability.ts`, which already holds `toHex`/`fromHex` and
is imported by both. `capability.ts` is **not** in the plan's `files_modified` — the plan
authorised exactly this fallback ("move those helpers to whichever shared module already
holds byte utilities in this package"). Neither is added to `index.ts`, so no barrel
export was created. `toBufferSource` had no remaining user in `cert-lifecycle.ts` and
moved wholesale.

## The surviving gate is the round-trip probe

`detectCryptoBackend` calls a real `subtle.generateKey({name:'Ed25519'}, false,
['sign','verify'])` inside a `try`. The deleted gate was
`typeof globalThis.crypto?.subtle?.sign === 'function'` — it selects `subtle` on an
engine that advertises `SubtleCrypto` and refuses `Ed25519`. Both acceptance greps read
clean: `grep -n "generateKey" packages/core/src/ed25519-backend.ts` matches the probe at
`:281`; the presence-check string matches nowhere in the file, including prose.

### Planted-mutation proof, watched red

The presence-only gate was planted back as a one-line change to `detectCryptoBackend`
(`await subtle.generateKey(...)` → `if (typeof globalThis.crypto?.subtle?.sign !==
'function') throw ...`).

**First plant reddened on the wrong assertion and that is recorded rather than hidden.**
The case asserted `counter.calls` before `backend.arm`, so it failed at the mechanism and
short-circuited before the claim:

```
AssertionError: the gate must actually call generateKey — a presence check would not: expected +0 to be 1
 ❯ packages/core/src/ed25519-backend.test.ts:535:99
```

The claim itself was therefore unproved. The assertions were reordered so the arm is
checked first, the plant re-applied, and the claim watched fail:

```
FAIL |node| packages/core/src/ed25519-backend.test.ts > the surviving gate probes, it does not infer from presence > resolves the noble arm on an engine that HAS crypto.subtle and refuses Ed25519 — the case a presence check gets wrong
AssertionError: an engine that advertises SubtleCrypto and refuses Ed25519 must select noble: expected 'subtle' to be 'noble' // Object.is equality

Expected: "noble"
Received: "subtle"
 ❯ packages/core/src/ed25519-backend.test.ts:543:7
```

A second case (`runs the probe once when initEd25519() is called twice concurrently`)
also reddened, `expected +0 to be 1`. Restored both times by the surgical inverse of the
one-line edit and `cmp`-verified against a snapshot taken immediately before each plant —
`IDENTICAL to pre-plant snapshot` on both. Never `cp`, never `git stash`, never
`git checkout --`. Post-restore re-run: 30 passed, exit 0.

## Measured readings

Every number below was read out of a run. Both ceilings were measured by the register's
own established method — set the ceiling to 0, read the guard's verdict, restore by the
surgical inverse, `cmp`-verify — taken **before** the merge and **after** it, so each
figure has a within-run pair rather than an absolute.

| Reading | Before | After | Where |
|---|---|---|---|
| unreachable callable barrel exports | **75** | **73** | `reachability-guard.node.test.ts:264` |
| undisposed subset (`OPEN_FINDING_CEILING`) | **49** | **47** | `reachability-dispositions.ts` |
| `built.collisions.length` | **16** | **15** | `reachability.node.test.ts` |

All three sat *exactly* at their bounds before the merge, so each is binding rather than
slack. Both ceilings were lowered to the post-merge reading; the collision bound stays at
16 because its reading fell for a reason the bound already tolerated.

### The "47" trap, named

49 − 2 is 47, and `reachability-guard.node.test.ts:350` and `REQUIREMENTS.md:790` have
both *said* "47" since before this phase — stale against the 47 → 49 raise of Plan 25-02,
describing a different population. **The agreement is a coincidence and was not taken as
evidence.** 47 is what the guard printed with the ceiling planted at 0, naming all
forty-seven, with `core/createLibsodiumSyncVerifier` and `core/createSubtleAsyncVerifier`
visibly absent from a list that otherwise matches the pre-merge one item for item. The
drift at `:350` was corrected in place with its date and an explicit note that the
coincidence is not the proof. `REQUIREMENTS.md:790` was **not** touched — that is Plan
28-04's, per the plan.

### The collision pins, and a plan prediction that did not survive measurement

The three pinned entries were repointed from `cert-lifecycle.ts#signEd25519` /
`#verifyEd25519` / `#agreeX25519` to `ed25519-backend.ts#...`. A collision entry is a
name-in-a-file, so three moved rather than three appearing.

**`ed25519-backend.ts#verify` is no longer a collision, and its pin was removed rather
than propped up.** The plan predicted it would survive ("four declarations of that name
in one file") and instructed that a contrary reading be reported. The measured list has
15 entries and does not contain it. Reading `declaredNameOf`
(`packages/node/src/reachability.ts:526-546`) *after* the reading disagreed: it counts
function/class/method declarations, accessors and `const f = () => {}` — it does **not**
count interface method signatures, nor an object-literal `verify: (…) => …` property
assignment. So the entry was carried by three object-literal `verify(...)` **methods**
(noble, WASM-fallback, subtle); two were deleted, one is not a collision. Neither
`Ed25519SyncVerifier.verify`/`Ed25519AsyncVerifier.verify` nor the async adapter written
inside `initEd25519` ever contributed. The stale sentence in the older comment that said
otherwise was corrected in place.

Full measured collision list (15), 2026-08-10:

```
packages/aot/src/wasi-executor.ts#fd_fdstat_get
packages/aot/src/wasi-executor.ts#fd_filestat_get
packages/aot/src/wasi-executor.ts#fd_write
packages/aot/src/wasi-executor.ts#length
packages/aot/src/wasi-executor.ts#text
packages/browser/src/browser-node.ts#dutyCycle
packages/core/src/discovery.ts#providers
packages/core/src/discovery.ts#recordsFor
packages/core/src/ed25519-backend.ts#agreeX25519
packages/core/src/ed25519-backend.ts#signEd25519
packages/core/src/ed25519-backend.ts#verifyEd25519
packages/core/src/transport/memory.ts#peers
packages/node/src/bin/bench.ts#acquire
tools/aot/bench-lifted.ts#fd_fdstat_get
tools/aot/bench-lifted.ts#fd_write
```

### `availableBackends` console line, verbatim

Identical on all four engines — the WASM arm is gone, so the list is two, not three:

```
ed25519-backend.test.ts: backends available this run: noble, subtle
```

- node (Node v25.9.0): one line, as above.
- browser (chromium): as above.
- browser (firefox): as above.
- browser (webkit): as above.

Three occurrences in the browser run, one per engine, against three distinct engine tags.
**No minimum-backend floor was added** — that is Plan 28-03's, deliberately left unwritten
so 28-03 can watch one go red on a single-backend host rather than inherit it green.

## Verification

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | whole repository, clean |
| `npx vitest run --project node` (full) | **0** | **179 files, 2575 passed / 1 skipped (2576)**, 352.01 s real, `(user+sys)/real` = 1.27 |
| `npx vitest run --project browser` (full) | **0** | 261 files, 4467 passed |
| `--project node` ed25519-backend + cert-lifecycle | **0** | 2 files, 58 passed (30 + 28) |
| `--project browser` ed25519-backend + cert-lifecycle ×2 + insecure-origin | **0** | 12 files, 213 passed |
| `--project node` reachability + reachability-guard | **0** | 2 files, 57 passed |

`EXIT=$?` was read on the line immediately after every command, with output redirected to
a file and read separately — no pipes, no trailing `tail`.

**Test-count reconciliation.** The brief's pre-merge figure is 2572 passing. The surgery
deleted 4 cases (two secure-arm import-counter cases, two insecure-arm cases) and added 7
(five in the new gate block, two in the rewritten insecure-arm block), a net **+3**;
2572 + 3 = 2575 passed, plus the 1 pre-existing skip = 2576 total. That reconciles
exactly, but 2572 is the brief's figure and was not itself re-measured on this branch.

The browser run includes `packages/browser/src/insecure-origin.browser.test.ts` green —
the standing proof that the production path runs with `crypto.subtle` removed outright,
which is the real argument that dropping the WASM arm is safe.

## Deviations from Plan

**1. [Rule 3 — Blocking] `capability.ts` added to the touched set**
- **Found during:** Task 1.
- **Issue:** the moved JWK builders need `toBase64Url`, which was `cert-lifecycle.ts`-private
  and still needed there; importing it back would have closed an import cycle.
- **Fix:** `toBase64Url`/`fromBase64Url` moved to `capability.ts` beside `toHex`/`fromHex`,
  exported from the module but **not** from the barrel, so no ceiling moved.
- **Why not a duplication:** the plan forbade duplicating them and named this exact fallback.

**2. [Rule 1 — Proof defect] Assertion order inside the gate case**
- **Found during:** Task 1's planted-mutation proof.
- **Issue:** the mechanism assertion (`counter.calls`) preceded the claim (`backend.arm`),
  so the plant short-circuited and the claim was never watched fail.
- **Fix:** reordered, re-planted, claim watched red (text above), restored and `cmp`-verified.
- **Recorded in the test itself** so the ordering is not "tidied" back.

**3. [Measurement contradicts plan] `ed25519-backend.ts#verify` pin removed**
- The plan's `<behavior>` predicted the entry survives; it does not. Reported and removed,
  per the plan's own instruction, rather than contriving a declaration to keep it.

**4. Prose rewrites to satisfy a literal grep**
- `grep -c "libsodium" packages/core/src/ed25519-backend.test.ts` must return 0, and
  `grep -c "createSubtleAsyncVerifier\|createLibsodiumSyncVerifier" packages/core/src/index.ts`
  must return 0. Three historical prose mentions in the test file's Part-1/Part-2 docblock
  were rephrased to "the WASM fallback" with a pointer to where the name survives, and
  `index.ts`'s new comment names the two departed exports descriptively rather than by
  identifier, saying so. The exact identifiers are recorded here and in both reachability
  docblocks, so nothing is lost.

## Out of scope, deliberately not taken

- **The manifest and lockfile still list `libsodium-wrappers`.** Removing them, and the
  measured bundle delta and its guard, is Plan 28-02. No code under `packages/`, `tools/`
  or `bin/` references it any more; the surviving matches are all prose:
  `cert-lifecycle.ts:11`, `:15`; `index.ts:393`; `ed25519-backend.ts:6`, `:9`, `:26`, `:87`;
  `reachability.node.test.ts:511` (a historical note).
- **The port is not wired into `verifyChain`/`verifyCertificate`.** Owner non-decision.
- **The facades and the moved crypto-backend symbols are not barrel-exported.** Owner
  non-decision, priced at 75 → 87 and 49 → 61; the comment in `index.ts` says so.
- **No minimum-backend floor** in the differential guard — Plan 28-03.
- **`.planning/REQUIREMENTS.md:790`'s 67/20/47 triple untouched** — Plan 28-04.

## Coverage this removes, stated rather than hidden

The two Node-only import-counter assertions the file itself flagged as unmeasurable under
browser mode (`vi.doMock` does not intercept dynamic `import()` in browser mode) are gone,
because the import they counted is gone. What they were really proving — that the fallback
selection completes and both ports return correct verdicts — is kept behaviourally in the
rewritten insecure-arm case. `freshEd25519Module()` and the `?fresh-instance=` mechanism
were **kept**: the merged module memoises two things (`initPromise` and `backendPromise`)
and every gate case needs a pristine instance. This was not assumed — the gate cases pass
under node and under all three browser engines *with* the helper, and it is the mechanism
the file's own comment records as the only portable way to get a fresh instance in browser
mode.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust
boundary. The three boundaries the plan's threat model names are unchanged in shape and
their mitigations are all in place: T-28-01 (the probe, proved by the planted engine),
T-28-02 (the adapter reorder, with an anti-vacuity accept-vector check so a reversed
adapter cannot pass by making everything `false`), T-28-03 (both try/catch refusal
boundaries preserved), T-28-04 (`Ed25519NotInitializedError` unchanged), T-28-05 (the pins
and both ceilings reconciled against measured readings).

## Known Stubs

None.

## Commits

- `31b64a6` — `refactor(28-01): one Ed25519 module, and the surviving gate is the probe`
  (10 files; `git show --stat` confirms only this plan's files, no tracked-file deletions).

## Self-Check: PASSED

- All modified files present on disk.
- `31b64a6` present in `git log --all`.
- `git diff --diff-filter=D HEAD~1 HEAD` empty — no tracked file deleted.
- `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` **not** updated: the executing brief
  barred every `gsd-sdk query state.*` and `roadmap.update-plan-progress` verb. Ledger
  reconciliation for this phase is Plan 28-04's.
