---
phase: 25-x509-certificate-profile
plan: 4
subsystem: core
tags: [ed25519, crypto-subtle, libsodium, noble-curves, adapter-pattern, dual-port]
dependency-graph:
  requires: []
  provides:
    - packages/core/src/ed25519-backend.ts (Ed25519Backend, Ed25519SyncVerifier,
      Ed25519AsyncVerifier, Ed25519NotInitializedError, createNobleSyncVerifier,
      createLibsodiumSyncVerifier, createSubtleAsyncVerifier, initEd25519,
      getSyncVerifier, getAsyncVerifier) — exported from @o2/core's barrel
  affects:
    - A future phase's wiring pass over verifyChain (capability.ts:219) and
      verifyCertificate's four call sites (enrollment.ts:702,740,759,874), once a
      bootstrap-ordering decision across packages/net, packages/node and
      packages/browser's entry points is made — not scoped to this plan
tech-stack:
  added: [libsodium-wrappers@0.8.4]
  patterns:
    - synchronous-port-behind-asynchronous-one-time-init (new to this repository —
      25-PATTERNS.md's "No Analog Found" table names this explicitly)
    - lazy import() behind a runtime capability check, shared by two ports, at most once
    - try/catch-around-crypto-only (capability.ts:216-223's boundary, copied into all
      three adapters — structural checks never throw, only the library call is wrapped)
key-files:
  created:
    - packages/core/src/ed25519-backend.ts
    - packages/core/src/ed25519-backend.test.ts
  modified:
    - packages/core/src/index.ts
    - packages/core/package.json
    - package-lock.json
    - packages/node/src/reachability-dispositions.ts
    - packages/node/src/reachability-guard.node.test.ts
decisions:
  - "The Task-1/Task-2 split in the plan's own <files> lists (ed25519-backend.test.ts
    formally listed under Task 2 only) was read as an intentional single-file build-up
    across all three tasks, not a hard per-task file boundary — the plan's own overall
    files_modified and this executor's scope_boundary both list the test file once,
    covering the whole plan."
  - "RED/GREEN commits were split by module (ed25519-backend.ts) rather than by
    Task-1-vs-Task-2 test content, since the differential-conformance guard (Task 2)
    exercises the same adapters Task 1 implements and both were built together — a
    single genuine RED-to-GREEN cycle over the whole module, not two artificially
    separated ones."
  - "vi.doMock does not intercept a dynamic import() of libsodium-wrappers under real
    chromium/firefox/webkit through vitest's browser mode (measured both with a
    query-suffixed and a literal specifier) — only under the node project. Two tests
    were redesigned around this: 'imports exactly once' asserts the call counter under
    Node only and relies on behavioural proof (both ports resolve correctly) on every
    engine; the concurrent-call memoisation proof uses a portable promise-identity
    check (initEd25519() called twice returns the exact same Promise) instead of a
    call counter, working identically everywhere."
  - "Module-instance isolation for testing initEd25519()'s capability-gate switching
    uses a query-suffixed dynamic import (./ed25519-backend.ts?fresh-instance=N) via
    /* @vite-ignore */, not vi.resetModules() — measured that resetModules() does not
    produce a fresh module instance under real browser engines in vitest browser mode,
    only under node, where the query-suffix technique also works, so it is used
    uniformly."
metrics:
  duration: "~8 minutes commit-to-commit (2026-08-09T15:52:25-07:00 to
    2026-08-09T16:00:16-07:00), plus investigation, empirical verification of every
    plan citation against the live tree, and a full npm run test:node run (~512s)
    before this summary"
  completed: 2026-08-09
  tasks_completed: 3
  files_created: 2
---

# Phase 25 Plan 4: Ed25519 Dual-Port Adapter Summary

A synchronous Ed25519 verification port (`initEd25519()` once, then plain `boolean`
`.verify()`) with noble and libsodium adapters, plus a separate asynchronous port
served by `crypto.subtle` when available — one capability check decides both ports,
libsodium is reachable only via a lazy `import()` on the arm that needs it, and a
differential-conformance guard proves every backend this host can run agrees on a
reject-weighted vector set including the non-canonical-`S` malleability case. Shipped
complete, tested, and **not wired** — `verifyChain`/`verifyCertificate` still call
`@noble/curves` directly; the wiring decision is stated by name, not left implicit.

## What Was Built

`packages/core/src/ed25519-backend.ts` (228 lines) and
`packages/core/src/ed25519-backend.test.ts` (589 lines, well over the 220-line
minimum):

- **`Ed25519SyncVerifier`** / **`Ed25519AsyncVerifier`** — the two port interfaces from
  the plan's `<interfaces>` block, verbatim.
- **`Ed25519NotInitializedError`** — a named error class (not a bare discriminated
  object) carrying both `.code: 'ed25519-not-initialized'` and `.port: 'sync' |
  'async'`, so a caller can either `instanceof`-check or read `.code`.
- **`createNobleSyncVerifier()`** — synchronous, wraps `@noble/curves`'s
  `ed25519.verify`, try/catch around the library call only (matching
  `capability.ts:216-223`'s boundary), resolving `false` on any throw.
- **`createLibsodiumSyncVerifier()`** — the one genuine `await import('libsodium-wrappers')`
  in the file, plus `await sodium.ready`; returns a synchronous `.verify()` wrapping
  `crypto_sign_verify_detached` with the same try/catch boundary.
- **`createSubtleAsyncVerifier()`** — returns `undefined` if `subtle.verify` isn't a
  function; otherwise `importKey` + `verify`, both awaited inside one try/catch.
- **`initEd25519()`** — memoised async function, one capability check
  (`typeof globalThis.crypto?.subtle?.sign === 'function'`) deciding both ports:
  capable → sync=noble, async=subtle, libsodium never touched; not capable →
  sync=libsodium, async wraps the *same* resolved libsodium instance.
- **`getSyncVerifier()`** / **`getAsyncVerifier()`** — throw `Ed25519NotInitializedError`
  before `initEd25519()` resolves.
- **Barrel export** — all seven callables and three types now reachable from
  `packages/core/src/index.ts`, with a comment citing both owner rulings and pointing
  at the test file's migration-pricing-and-wiring-decision docblock.

## Test Coverage (27 tests on `--project node`, 81 on `--project browser` = 27 × 3 engines, all green)

- **Capability gate, secure-context arm**: zero libsodium imports (proved via
  `vi.doMock` throwing if ever called), `getSyncVerifier().backend === 'noble'`
  specifically — the case proving the ruling is scoped, not reversed — and the async
  port backed by `crypto.subtle`.
- **Capability gate, insecure-context arm**: `crypto.subtle` shadowed via
  `Object.defineProperty(..., { value: undefined })` (never `delete`, which is a
  documented no-op against an inherited `Crypto.prototype` accessor); backend picks
  `libsodium`; both ports resolve a real vector correctly, proving the async port
  shares the one resolved libsodium instance.
- **Memoisation**: `initEd25519()` called twice before the first settles returns the
  *same* `Promise` object both times — a portable, mocking-free proof that concurrent
  callers do not race a second `import()`.
- **No implicit default**: `getSyncVerifier()`/`getAsyncVerifier()` both throw
  `Ed25519NotInitializedError` before init, naming which port was requested.
- **Differential-conformance guard**: 5 accept vectors and 7 reject vectors (flipped-bit
  signature, truncated signature, all-zero signature, wrong message, flipped public
  key, wrong-length public key, and the non-canonical-`S` malleability case — `S + L
  mod 2**256`, empirically verified `S >= L` before use) run through every backend this
  host makes available (noble, libsodium, and subtle when a real round-trip probe
  confirms Ed25519 support, not merely object presence), asserting identical verdicts
  and naming any disagreement with each backend's own verdict.
- **Sync/async port agreement (T-25-16)**: the full reject-vector set run through both
  `getSyncVerifier()` and `getAsyncVerifier()` on the same initialised host, asserting
  identical verdicts — the seam the adapter itself introduces.

## TDD Gate Compliance

Tasks 1 and 2 share `tdd="true"` and one test file; built and proved together as a
single RED→GREEN cycle over the whole module (see Decisions above for why):

- `test(25-04)` commit `33f3028` — the full test file (Tasks 1 and 2's content)
  committed against the real, correct `ed25519-backend.ts`.
- **Watched red** (not committed in this state — a plant-and-restore proof, per
  `CLAUDE.md` § Proofs): inverting `initEd25519`'s single capability-check condition
  (`typeof globalThis.crypto?.subtle?.sign !== 'function'` for `=== 'function'`) failed
  exactly 4 of 27 tests — the two secure-context-arm tests (picked libsodium instead of
  noble) and the two insecure-context-arm tests (picked noble instead of libsodium).
  Restored via the surgical inverse (`!==` → `===`) and verified byte-identical against
  a pre-plant snapshot with `cmp` (exit 0) before proceeding.
- `feat(25-04)` commit `cb88b41` — `ed25519-backend.ts` (Task 1's own deliverable),
  `package.json`, `package-lock.json`. 27/27 node, 81/81 browser green.
- `feat(25-04)` commit `85f0725` — `index.ts` barrel export (Task 2's remaining
  deliverable).

Task 3 (`docs(25-04)` commit `ca3a7b1`) is not TDD — a docblock, verified by grep per
its own `<verify>` command.

No test passed unexpectedly during the RED phase — the plant produced exactly the
expected 4 failures, named and matching the mutated branch.

## Re-Derived Measurements (Task 3)

- **Call-site count**: re-ran the plan's enumeration command this session — 11 raw
  matches, 1 excluded (`mutation-ledger.ts:1473`, a quoted string literal inside a
  `find:` entry, verified by reading, not by pattern), **10 real production call sites
  across 9 files in 4 packages** (confirmed identical to the plan's own corrected
  count; every one of the 10 file:line citations independently re-verified against the
  live tree — `discovery.ts:264` inside `export async function discoverExecutors`,
  `main.ts:350` inside `async function peerCertificate`, `peer-verifier.ts:688` inside
  `verify()`, `fabric-node.ts:960` inside an async closure, all four already-async;
  `reduce-job.ts:321`/`capability-authorizer.ts:132`/`enrollment.ts:926`/
  `result-attestation.ts:483`+`job/submit.ts:1114` resolving mechanically one or two
  levels up an already-async caller; `peer-verifier.ts:557` the one non-mechanical
  site, reachable only through the synchronous `verifiedPeers` getter at
  `peer-verifier.ts:433`).
- **Timing** (this host, Node v25.9.0, `performance.now()`, 20 000 iterations after a
  1 000-iteration warmup): `@noble/curves` direct 1.3204 ms/verify;
  `getSyncVerifier().verify(...)` 1.3257 ms/verify; ratio 1.004 — the adapter's
  try/catch wrapper costs ~0.4% over the bare call, on this host, this run. Recorded as
  a second, independently-dated data point beside `25-CONTEXT.md`'s 2026-08-09 table,
  not a replacement for it.
- **`instanceof Promise` re-check**: noble → `false`, libsodium (post-`ready`) →
  `false`, `crypto.subtle` → `true` — unchanged from `25-CONTEXT.md`'s table.

## Verification

- `npx vitest run --project node packages/core/src/ed25519-backend.test.ts` — 27/27
  passed, `EXIT=$?` read directly on the line immediately after, no pipe to `tail`.
- `npx vitest run --project browser packages/core/src/ed25519-backend.test.ts` — 81/81
  passed across chromium, firefox and webkit.
- `npx tsc --noEmit` — exits 0, whole-repo, run after every task.
- `npx vitest run --project node` (full project) — 173/174 files, 2478/2480 tests
  passed, 1 skipped; the single failing file (`reachability.node.test.ts`, the
  `collisions.length <= 12` assertion, actual 13) is **pre-existing and unrelated**,
  confirmed via `git stash` against the pre-plan tree before this plan's first commit —
  same failure, same numbers. Recorded in this phase's `deferred-items.md`, not fixed.
- All Task 1/2/3 acceptance-criteria greps (zero `import.*libsodium`, no `delete
  globalThis.crypto.subtle`, the 10-citation set, `mutation-ledger.ts:1473`, `not
  planned as execution work in Phase 25`, the corrected/not-9 count) verified
  individually via `grep -c`/`grep -oE` against the final committed file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - bug] `Uint8Array<ArrayBufferLike>` not assignable to `BufferSource`**
- **Found during:** Task 1, first `tsc --noEmit` after implementing
  `createSubtleAsyncVerifier`.
- **Issue:** `subtle.importKey`/`subtle.verify` want `Uint8Array<ArrayBuffer>`
  specifically; this port's public contract (matching the sync port) accepts the wider
  `Uint8Array`.
- **Fix:** Cast at the two call sites, citing this package's own existing precedent at
  this exact boundary (`canonical/encode.ts:118`, `net/src/conformance.ts:62`).
- **Files modified:** `packages/core/src/ed25519-backend.ts`.
- **Commit:** folded into `cb88b41` (caught before that commit, not a later fix).

**2. [Rule 1 - bug] `instanceof` mismatch across a `vi.resetModules()` boundary**
- **Found during:** first real test run, "the thrown error names which port was
  requested".
- **Issue:** A statically-imported `Ed25519NotInitializedError` is a *different class
  object* than the one thrown by a freshly-`import()`ed module instance after
  `vi.resetModules()`/a query-suffixed re-import — `instanceof` against the
  static-import reference failed even though the error was correctly thrown.
- **Fix:** Use `mod.Ed25519NotInitializedError` (the dynamically-imported module's own
  export) for the `instanceof` check; dropped the now-unused static import.
- **Files modified:** `packages/core/src/ed25519-backend.test.ts`.
- **Commit:** folded into `33f3028` (RED commit — caught while validating the test
  file's own logic before the formal plant-and-restore RED proof).

**3. [Rule 1 - bug] `vi.resetModules()` does not isolate module state under real
browser engines**
- **Found during:** first `--project browser` run — 12 of 81 tests failed, all
  involving either module-state isolation or the insecure-context capability shadow.
- **Issue:** `vi.resetModules()` + a bare re-`import()` of the same specifier kept the
  memoised `noble` selection from an earlier test under chromium/firefox/webkit
  (measured; Node's project was unaffected).
- **Fix:** Redesigned module isolation around a query-suffixed dynamic import
  (`./ed25519-backend.ts?fresh-instance=N` via `/* @vite-ignore */`), which native ESM
  module identity honours as a distinct module record on every engine including Node.
- **Files modified:** `packages/core/src/ed25519-backend.test.ts`.
- **Commit:** folded into `33f3028`.

**4. [Rule 1 - bug] `vi.doMock` does not intercept a dynamic `import()` of
`libsodium-wrappers` under real browser engines**
- **Found during:** second `--project browser` run — 3 of 81 tests failed, all the
  "performs the import at most once" case, count 0 instead of 1.
- **Issue:** Tried on both a query-suffixed and (separately, as a diagnostic) a
  literal, statically-analysable specifier; neither is intercepted by `vi.doMock`
  under chromium/firefox/webkit through vitest's browser mode, only under `node`.
- **Fix:** Two separate redesigns — the "imports exactly once, shared by both ports"
  test asserts the counter only under Node (`typeof window === 'undefined'`), relying
  on behavioural proof (both ports resolve a real vector correctly) on every engine;
  the "called twice concurrently" test uses a portable promise-identity check
  (`expect(second).toBe(first)`) instead of a counter, which needs no mocking at all
  and works identically everywhere.
- **Files modified:** `packages/core/src/ed25519-backend.test.ts`.
- **Commit:** folded into `33f3028`.

**5. [Rule 1 - bug] The literal string `delete globalThis.crypto.subtle` inside an
explanatory comment tripped its own acceptance-criteria grep**
- **Found during:** running Task 1's own acceptance-criteria checks before committing.
- **Issue:** A comment explaining *why* the code uses `Object.defineProperty` instead
  of `delete` contained the literal substring the grep was checking for absence of
  (checking that the *technique* wasn't used, but matching the *prose about it* too).
- **Fix:** Reworded the comment to describe the same reasoning without the exact
  substring.
- **Files modified:** `packages/core/src/ed25519-backend.test.ts`.
- **Commit:** folded into `33f3028`.

**6. [Rule 3 - blocking] Repo pre-commit hook refused the barrel-export commit —
reachability-guard ceilings**
- **Found during:** committing Task 2's `index.ts` barrel export.
- **Issue:** The repo's "cheap guards" pre-commit hook runs
  `reachability-guard.node.test.ts`, which counts callable barrel exports with no
  production caller. This plan's seven new exports (by design — no production caller
  yet) pushed both of that guard's ceilings over (`OPEN_FINDING_CEILING` 40→47 needed;
  the sibling ceiling in the test file itself 67→73 needed), and the hook **refused the
  commit outright**, exit 1.
- **Fix:** Raised both ceilings to the newly measured counts, with a dated docblock
  addition naming the seven new symbols and citing `ed25519-backend.ts`'s own docblock
  for why they're unwired — per the guard's own documented protocol for this exact
  situation ("a HIGHER number means a new exported-but-uncalled symbol arrived"). Did
  **not** add a disposition-register entry (which would duplicate the module's own
  stated reason in a second place that could drift from it).
- **Files modified:** `packages/node/src/reachability-dispositions.ts`,
  `packages/node/src/reachability-guard.node.test.ts` — both **outside this plan's
  originally declared file scope** (`packages/core/src/ed25519-backend.ts`,
  `ed25519-backend.test.ts`, `index.ts`, `packages/core/package.json`,
  `package-lock.json`). Logged in `.planning/phases/phase-25-x509-certificate-profile/deferred-items.md`
  both as the original out-of-scope finding and, in a second entry, as resolved —
  because `CLAUDE.md`'s "never skip hooks unless explicitly asked" left no other path
  to landing the commit.
- **Verification:** `reachability-guard.node.test.ts` — 20/20 passed (was 18/20).
  `reachability.node.test.ts`'s unrelated pre-existing failure (collisions 13 vs 12,
  confirmed present before this plan via `git stash`) is untouched by this fix.
- **Commit:** `85f0725`.

**7. [Rule 1 - bug, in repo tooling] `gsd-sdk query state.record-session` corrupted
STATE.md's frontmatter — caught before committing, reverted, redone by hand**
- **Found during:** the state-update step, immediately after `state.record-metric` and
  `state.record-session` (both run per the standard workflow instructions).
- **Issue:** `git diff .planning/STATE.md` showed 105 deletions against 57 insertions —
  the entire `stopped_at` YAML frontmatter block deleted (four owner rulings, the
  Phase 17 close, ~90 lines of milestone history), `status: executing` flipped to
  `status: verifying` unasked, `last_activity` regressed a day, and every
  `progress:` count rewritten to fabricated values (`total_phases` 15→27,
  `completed_plans` 103→112, `percent` 80→100). STATE.md's own `<!-- -->` comment
  block already documents four prior writers with this exact failure signature
  (`state.begin-phase`, the `pause-work` workflow, `state.record-metric` itself, and
  `state.planned-phase`) — this session's `state.record-session` call is a fifth,
  newly confirmed.
- **Fix:** `git checkout -- .planning/STATE.md` (safe: `git status` was clean before
  either mutating call, so the only uncommitted delta was the tool's own), then wrote
  the metrics row, the decision line, and the session-continuity update by hand,
  matching this file's own established formatting exactly. Added `state.record-session`
  to STATE.md's own unsafe-writer list with the same evidentiary detail the other four
  entries carry, so the next session doesn't rediscover it the hard way.
- **Files modified:** `.planning/STATE.md` (the corruption never reached a commit — this
  entry documents a caught-and-reverted event, not a change that shipped).
- **Verification:** `git diff --stat .planning/STATE.md` after the hand-edits: 30
  insertions, 4 deletions (the 4 being in-place line edits, not structural loss) —
  reviewed in full and confirmed every change is one of the three intended additions.
- **Commit:** folded into the final metadata commit below.

---

**Total deviations:** 7 auto-fixed (5 Rule 1 bugs found and fixed while building the
test suite's own cross-platform reliability, 1 Rule 3 blocking-issue fix forced by the
repo's own pre-commit gate, 1 Rule 1 bug caught in the state-management tooling itself
before it could corrupt STATE.md). None changed the module's behaviour, interfaces, or the
plan's scope — all were test-infrastructure correctness (5) or a numeric ceiling in an
unrelated repo-wide guard, updated per that guard's own documented process (1).

## Issues Encountered

**Piped a `vitest run` through `tail` once during the plant-and-restore RED proof**,
losing the real exit code (`tail`'s exit code, not vitest's) — exactly the hazard
`CLAUDE.md` § Measurement names by name. Caught before drawing any conclusion from it;
re-ran without the pipe, `EXIT=$?` read directly on the next line, confirmed `1`
(red) and later `0` (green) both correctly.

## User Setup Required

None — no external service configuration required. `libsodium-wrappers` is a plain npm
dependency, already resolved via `npm install` at the repository root.

## Known Stubs

None. All seven exported functions/values are fully implemented; no stub bodies.
`initEd25519`/`getSyncVerifier`/`getAsyncVerifier` have **no production caller** by this
plan's own explicit design (Task 3's docblock states why and what a future wiring pass
needs to do) — this is a stated scope boundary, not a stub.

## Threat Flags

None beyond what the plan's own `<threat_model>` already names. This plan introduces no
new network endpoint, auth path, file access pattern, or schema change at a trust
boundary — it is a verification *port*, unreachable from any production trust path
until a future phase wires it.

## Next Phase Readiness

- The Ed25519 dual-port adapter is complete, tested (27 node + 81 browser tests
  green), and ready to be adopted by a future phase's wiring pass.
- **Blocker for wiring, stated explicitly (not this plan's to resolve):** a
  bootstrap-ordering decision across three runtime entry points
  (`packages/net`'s agent bootstrap, `packages/node`'s `fabric-node.ts`,
  `packages/browser`'s `browser-node.ts`) — where each calls `initEd25519()` before
  first use, and what a verification arriving before that resolves should do (block,
  fail closed, or fail open with a documented reason).
- Plan 25-02 (algorithm allow-list, extension rules, duplicate detection) and Plan
  25-03 (bundle-cost guard) are unaffected by this plan — disjoint `files_modified`,
  confirmed by this plan's own wave assignment (`25-01` and `25-04` share wave 1
  precisely because their file sets don't intersect).
- `reachability-guard.node.test.ts`'s ceilings now correctly reflect this plan's seven
  new unwired exports; a future wiring pass that makes them reachable should **lower**
  `OPEN_FINDING_CEILING` (and the sibling test-file ceiling) to match, per that guard's
  own stated convention ("Lowering it is the work").

## Self-Check: PASSED

- FOUND: `packages/core/src/ed25519-backend.ts`
- FOUND: `packages/core/src/ed25519-backend.test.ts`
- FOUND: `packages/core/src/index.ts`
- FOUND: `packages/node/src/reachability-dispositions.ts`
- FOUND: `packages/node/src/reachability-guard.node.test.ts`
- FOUND: `.planning/phases/phase-25-x509-certificate-profile/deferred-items.md`
- FOUND commit: `33f3028` (test — RED, full test file)
- FOUND commit: `cb88b41` (feat — GREEN, Task 1's module)
- FOUND commit: `85f0725` (feat — Task 2's barrel export + Rule 3 ceiling fix)
- FOUND commit: `0c913b1` (docs — deferred-items.md, ceiling finding + resolution)
- FOUND commit: `ca3a7b1` (docs — Task 3's pricing/re-measurement/wiring docblock)

---
*Phase: 25-x509-certificate-profile*
*Completed: 2026-08-09*
