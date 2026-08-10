---
phase: 28-one-cryptographic-implementation
plan: 2
subsystem: core-crypto
tags: [libsodium, dependency-removal, bundle-measurement, supply-chain, removal-guard]
requires:
  - packages/core/src/ed25519-backend.ts
  - packages/node/src/x509-bundle.e2e.test.ts
provides:
  - "a dependency tree with no libsodium in it — manifest, lockfile and node_modules"
  - "libsodium's real bundled gzip cost, measured in one run, retiring an inherited figure"
  - "a removal guard: three direct absence assertions, a non-vacuity check, and two size relations"
affects:
  - packages/core/package.json
  - package-lock.json
  - packages/node/src/libsodium-absence.e2e.test.ts
tech-stack:
  added: []
  removed:
    - libsodium-wrappers@0.8.4
    - libsodium@0.8.4 (transitive)
  patterns:
    - "a removal is guarded by asserting absence directly, never by a ceiling a do-nothing tree also satisfies"
    - "an absence matcher is proved able to report 'present' before its 'absent' reading counts"
    - "a scratch directory is named so it cannot contain the marker being scanned for"
key-files:
  created:
    - packages/node/src/libsodium-absence.e2e.test.ts
    - .planning/phases/phase-28-one-cryptographic-implementation/deferred-items.md
  modified:
    - packages/core/package.json
    - package-lock.json
decisions:
  - "The uninstall realised only the supply-chain half; 28-01's code deletion had already realised the bundle half, and the measured delta proves it — 28306 B before, 28306 B after"
  - "25-CONTEXT.md's 314.9 KB is retired, not averaged: it is the sum of the two packages' unbundled dist files, identified to the byte, against a measured bundled cost of 153005 B"
  - "The plan's 'order of magnitude' gap between ceiling and removed weight is NOT met (3.93x) and was reported rather than closed by bending either number"
metrics:
  duration: ~95 min
  completed: 2026-08-10
---

# Phase 28 Plan 02: libsodium Leaves the Tree, Measured and Guarded — Summary

`libsodium-wrappers` and its transitive `libsodium` are out of
`packages/core/package.json`, out of `package-lock.json` and out of `node_modules`; the
dependency's real bundled cost was measured in this repository in one run before the
uninstall made that measurement impossible again; and
`packages/node/src/libsodium-absence.e2e.test.ts` (399 lines, 9 cases) guards the result
in the shape a removal actually needs.

## The correction, first, because it is the thing most easily got wrong

**The removal happened in two halves, and this plan owns only one of them.**

- **28-01 owned the bundle half.** It deleted `createLibsodiumSyncVerifier` and its lazy
  `import('libsodium-wrappers')`. From that commit a production build of the Ed25519
  verification surface contained no libsodium bytes **whether or not the package was
  installed**.
- **28-02 owns the supply-chain and install-surface half.** The manifest entry, the two
  lockfile entries, and the two directories under `node_modules`.

This is not a rhetorical distinction — it is the measured result. The verification
surface's gzip delta was **28307/28306 B before the uninstall and 28306 B after it**.
Unchanged, because there was nothing left to remove. Any claim that this plan's
`npm install` moved 314.9 KB (or 149.4 KiB) off a page would be false, and the guard's
own file docblock says so at the top rather than leaving it to a reader to notice.

## The numbers

All readings taken **2026-08-10** on Darwin 25.5.0 arm64 (Apple M1 Pro, 8 cores), Node
v25.9.0, Vite 8.1.5 library mode, `es` format, Vite's default esbuild production
minification, `node:zlib.gzipSync` over the raw output bytes, no server compression, three
builds sequential in one process (not `Promise.all`, matching the `e2e` project's
`fileParallelism: false` rationale).

### Pre-uninstall, all three entries built

| Reading | gzip | raw |
|---|---|---|
| `baselineGzip` | **127 B** | 125 B |
| `verifierGzip` | **28434 B** | 91517 B |
| `verifierDelta` | **28307 B** | — |
| `libsodiumGzip` | **153132 B** | 458134 B |
| `libsodiumDelta` | **153005 B** (149.4 KiB) | — |

A second pre-uninstall run of the baseline+verifier pair read 129 B / 28435 B /
**28306 B** — the known 1–2 byte `mkdtemp`-path variance recorded at
`x509-bundle.e2e.test.ts:108-113`.

### Post-uninstall

| Reading | gzip | raw |
|---|---|---|
| `baselineGzip` | **125 B** | 119 B |
| `verifierGzip` | **28431 B** | 91511 B |
| `verifierDelta` | **28306 B** | — |
| `libsodiumGzip` | *unbuildable* | — |

The libsodium entry now fails to resolve, and that failure is part of the proof rather
than an inconvenience worked around:

```
Error: [vite]: Rolldown failed to resolve import "libsodium-wrappers" from "/Volumes/ProjectsSSD/Projects/o2.services/tmp/o2-dep-measure-PfIZYc/libsodium/libsodium.ts".
```

**`verifierDelta` moved by at most one byte across the uninstall** (28307 → 28306, and a
same-side pre-run already read 28306). Reported as measured: the expectation held.

### 153005 B against the inherited 314.9 KB — and *why* they differ

25-CONTEXT.md (`:97`, `:113`) records libsodium's bundle cost as **314.9 KB gzip**, a
figure that document itself flags as one host, one run, and asks to be re-measured before
it is quoted as settled. **The measurement disagrees by 2.11×: 153005 B measured against
322427 B inherited.**

The cause was identified rather than split the difference:

```
gzip -9 node_modules/libsodium/dist/modules/libsodium.js          → 306869 B  (raw 907882)
gzip -9 node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js → 15558 B  (raw 121435)
                                                              sum = 322427 B = 314.87 KiB
```

The inherited number is the **sum of the two packages' unbundled, unminified `dist/modules`
files as published**, expressed in KiB and never passed through a bundler. The number
recorded here is what a production Vite library-mode build of a real call site actually
costs after minification and tree-shaking. Per the plan, **the measured number wins and
the inherited one is retired, not averaged.**

### The two sited constants

| Constant | Value | Siting |
|---|---|---|
| `VERIFIER_BUDGET_BYTES` | **38912** (38 KiB) | `ceil(28306 × 1.35 / 1024) KiB` — 1.375× headroom over the measured post-removal delta, inside the 1.2–1.5× range this profile's other sited constants use |
| `LIBSODIUM_MEASURED_GZIP_BYTES` | **153005** | Task 1's same-run, same-procedure `libsodiumDelta`. A **historical reading whose entry can no longer be built** — its docblock says exactly that |

### `git diff --stat`

```
 package-lock.json          | 16 ----------------
 packages/core/package.json |  1 -
 2 files changed, 17 deletions(-)
```

`npm install` reported `removed 2 packages, and audited 282 packages in 784ms`, exit 0.
The full 34-line lockfile diff was read before being believed: it removes exactly
`node_modules/libsodium` (5 lines), `node_modules/libsodium-wrappers` (9 lines, including
its `"libsodium": "^0.8.0"` dependency line) and the `@o2/core` workspace entry's
`"libsodium-wrappers": "0.8.4"` line. **No unrelated churn** — no version bumps, no
re-resolutions, no integrity rewrites anywhere else in the file.

## A hazard found by measuring, which would otherwise have been "fixed" by weakening the scan

The **first** marker scan over a libsodium-free verifier bundle reported **one hit**. The
bundle was correct; the *instrument* was contaminated. Context at offset 91361:

```
//#region tmp/o2-libsodium-measure-9ydUYD/verifier/verifier.ts
```

Rolldown embeds the entry file's own absolute path in a `//#region` comment that
**survives production minification** — the same mechanism `x509-bundle.e2e.test.ts:108-113`
records as the source of its gzip variance — and the throwaway script's scratch prefix was
`o2-libsodium-measure-`. **The scan found its own working directory.** Renaming the prefix
to `o2-dep-absence-` produced a clean zero on both markers.

This is written into the guard as a documented constraint on `WORKDIR_PREFIX`, because the
obvious reaction to a one-hit scan is to loosen the marker list, and that would have
disabled the assertion permanently to fix a filename.

## The guard, and why its shape departs from the precedent

`x509-bundle.e2e.test.ts` guards an *addition* with `toBeLessThanOrEqual` (`:115`, `:159`),
which is sound for a ceiling. **A ceiling alone cannot guard a removal** — a tree that
never removed libsodium also satisfies a generous upper bound, so the assertion is
satisfiable by doing nothing. The new file therefore asserts absence **directly**, three
ways, then adds the size relations:

| # | Case | Claim |
|---|---|---|
| 1 | matcher reports **present** on a fixture that carries libsodium | the instrument can say "present" |
| 2 | matcher reports absent on an identically-shaped fixture without it | no false positive |
| 3 | `packages/core/package.json` names no libsodium dependency | absence, structural (manifest) |
| 4 | `package-lock.json` holds no libsodium key, transitive included | absence, structural (lockfile) |
| 5 | `createRequire(...).resolve('libsodium-wrappers')` **throws** | absence, resolution — *gone*, not merely unlisted |
| 6 | built bytes contain neither `libsodium` nor `crypto_sign_verify_detached` | absence, in the artifact |
| 7 | verifier build strictly larger than baseline | **non-vacuity**, kept separate from the size check |
| 8 | `delta <= VERIFIER_BUDGET_BYTES` | stays down |
| 9 | `delta < LIBSODIUM_MEASURED_GZIP_BYTES` | **moved down** past what the dropped dependency alone weighed |

Both builds happen once in `beforeAll`, so the marker scan and both size relations read
**one** pair of artifacts rather than two that merely ought to agree.

## Planted-mutation proofs — five, each watched red, each restored by surgical inverse

Every plant was confined to the new file, so no shared source was touched. Each was
reverted by reversing exactly the line changed, then `cmp`-verified byte-identical against
a snapshot taken immediately before that plant — never `cp`, never `git stash`, never
`git checkout --`. All five reported `IDENTICAL to pre-plant snapshot`.

**1 — marker scan.** `MARKERS` replaced with `['export']`, a string every ES bundle
contains:

```
FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-05 — absence, in the built artifact > contains none of the libsodium markers in the built bytes of the verification surface
AssertionError: expected [ 'export' ] to deeply equal []
```

Proves the scan reads real built bytes, not an empty string.

**2 — the sited ceiling.** `VERIFIER_BUDGET_BYTES` set to `0`:

```
FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-05 — the size moved down, and stays down > keeps the verification surface under its sited ceiling
AssertionError: expected 28306 to be less than or equal to 0
```

Names the real measured delta — and independently confirms 28306 as the live reading.

**3 — the resolution assertion.** `ABSENT_SPECIFIER` pointed at `'multiformats'`, which
*is* installed:

```
FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-02 — absence, resolution: gone, not merely unlisted > throws when the bare specifier is resolved from this repository
AssertionError: expected [Function] to throw an error
```

Proves it is a real resolution attempt against the installed tree, not a `toThrow` that
would pass on anything.

**4 — the matcher, and this is the plant that justifies the fixtures existing.** The
predicate was crippled to `name === FORBIDDEN_SUBSTRING && false`. Observed: **8 of 9
cases still passed** — including *both* live readings of the real manifest and the real
lockfile, which passed **vacuously**. Only the fixture caught it:

```
FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-02 — the matcher is able to report "present" > reports a libsodium dependency present in a fixture that carries one
AssertionError: expected [] to deeply equal [ 'libsodium-wrappers', …(1) ]
```

A broken instrument reports the desired answer and the suite stays green. That is the
whole argument for case 1, and it was demonstrated rather than asserted.

**5 — the non-vacuity assertion, which demonstrated its own separation.** The verifier
entry was built from `BASELINE_SOURCE`, i.e. with the `@o2/core` import gone entirely —
the exact state a total tree-shake produces. **The marker scan passed**, over a bundle
with nothing in it. Only the separate sanity assertion caught it:

```
FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-05 — absence, in the built artifact > is a non-vacuous scan: the verifier build is strictly larger than the baseline
AssertionError: expected 122 to be greater than 122
```

This is T-28-09's mitigation shown working, not reasoned about.

## Verification

`EXIT=$?` was read on the line immediately after every command, with output redirected to
a file and read separately — no pipes, no trailing `tail`. That discipline caught a real
trap here: the composite background command that ran the browser and e2e projects returned
shell exit 0 while the e2e project inside it exited 1.

| Command | Exit | Result |
|---|---|---|
| plan's manifest/lockfile verify one-liner | **0** | `absent from manifest and lockfile` |
| `createRequire(...).resolve('libsodium-wrappers')` | **1** (required non-zero) | `Error: Cannot find module 'libsodium-wrappers'` |
| `npx tsc --noEmit` | **0** | whole repository, zero output lines |
| `npx vitest run --project node` (**full**) | **0** | **179 files, 2575 passed / 1 skipped (2576)**, `real 353.91`, `user 397.85`, `sys 52.59`, `(user+sys)/real` = **1.27** |
| `npx vitest run --project browser` (full) | **0** | **261 files, 4467 passed**, `real 46.26` |
| `--project e2e` libsodium-absence + x509-bundle | **0** | 2 files, 10 passed |
| `--project node` ed25519-backend + cert-lifecycle | **0** | 2 files, 58 passed |
| `npx vitest run --project e2e` (**full**) | **1** | 28 files, 1 failed / 27 passed; 183 tests, 1 failed / 182 passed — **pre-existing**, see below |

The full node run's 179 files / 2575 passed / 1 skipped is **identical** to 28-01's
recorded baseline. The new guard is in the `e2e` project, so it correctly does not appear
in the node count.

### The one e2e failure, attributed by measurement rather than by plausibility

`packages/node/src/demo-viewport.e2e.test.ts` fails its B5 assertion — the demo page's
`#s-fabric` section sits below `#bar`'s top at a 393 px viewport. It reproduces
deterministically in isolation with byte-identical coordinates.

CLAUDE.md forbids diagnosing by plausibility, so a **two-arm control** was run rather than
an argument made:

| Arm | `libsodium-wrappers` | Result |
|---|---|---|
| A | removed | 1 failed / 6 passed — `y=953.03` vs `y=632.41` |
| B | **reinstalled** via `npm install` | 1 failed / 6 passed — `y=953.03` vs `y=632.41` |

Byte-identical in both arms, so the failure is independent of this plan's change. Arm B
was created by the surgical inverse of the one-line manifest edit and reverted the same
way; `packages/core/package.json` and `package-lock.json` were both `cmp`-verified
byte-identical to their pre-experiment snapshots afterwards, and the bare-specifier
resolution throws again. Logged to `deferred-items.md`, not fixed — it is demo layout,
outside Phase 28's scope.

**Stated plainly for the next agent: the full `e2e` project is not green on this branch,
and was not green before this plan either.** 28-01 verified `node` and `browser` in full
but only targeted e2e files, so the failure was carried, not introduced. Baseline recorded
in `deferred-items.md`.

## Deviations from Plan

**1. [Measurement contradicts plan] The "order of magnitude" acceptance criterion is NOT
met, and neither number was bent to meet it**

- **Found during:** Task 2, siting the constants against Task 1's readings.
- **The criterion:** `VERIFIER_BUDGET_BYTES` must sit "at least an order of magnitude
  below" `LIBSODIUM_MEASURED_GZIP_BYTES`.
- **Measured:** 153005 / 38912 = **3.93×**, and 153005 / 28306 = 5.41× against the raw
  delta. Not 10×. It is not reachable at any legal headroom either — even at the tightest
  permitted 1.2× the ratio is 4.5×.
- **Why both premises moved:** the criterion was written against the inherited 314.9 KB
  (retired above, 2.11× too large) *and* against an unmeasured assumption that the
  verification surface would be small. It is in fact 28.3 KB, because a caller touching
  `@o2/core`'s barrel pays for the `@noble/curves` + `@ipld/dag-cbor` + `multiformats`
  graph. The two quantities are simply within a factor of ~5 of each other.
- **What was NOT done:** `LIBSODIUM_MEASURED_GZIP_BYTES` was not inflated back to the
  retired figure, and `VERIFIER_BUDGET_BYTES` was not sited below the measured delta
  (which would redden the guard immediately). Either would be the
  widening-what-counts-as-passing failure CLAUDE.md § Proofs names.
- **What the criterion was *for* survives intact:** re-attaching libsodium to this graph
  takes the delta to roughly 28306 + 153005 = 181311 B, **4.66×** the ceiling, so the
  guard reddens decisively rather than as a formality. Recorded in the constant's own
  docblock as well as here.

**2. [Rule 3 — Blocking] The scratch-directory prefix had to become a named, documented
constraint**

- **Found during:** Task 1's first measurement.
- **Issue:** the throwaway script's `o2-libsodium-measure-` prefix appeared in Rolldown's
  surviving `//#region` path comment, so the marker scan matched its own working directory
  and reported a false positive on a clean bundle.
- **Fix:** prefix renamed to `o2-dep-absence-` and lifted to a `WORKDIR_PREFIX` constant
  whose docblock records the measurement that found the hazard, so the next reader does
  not "fix" a future one-hit scan by loosening the marker list.

**3. [Scope, reported not fixed] Two pre-existing issues logged to `deferred-items.md`**

- `demo-viewport.e2e.test.ts` B5 (attributed by two-arm control, above).
- `npm audit`'s 1 high-severity advisory, identified as `nanoid`
  (GHSA-2v37-7h3g-55p8), a transitive dependency unrelated to libsodium. Counts unchanged
  by the removal: `{"info":0,"low":0,"moderate":0,"high":1,"critical":0,"total":1}`.

## Out of scope, deliberately not taken

- **The surviving prose mentions of libsodium** in `cert-lifecycle.ts`, `index.ts`,
  `ed25519-backend.ts` and `reachability.node.test.ts:511` are untouched. 28-01 confirmed
  no code reference remains; these are historical notes, and the new guard's own docblocks
  add more of them deliberately.
- **`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` are not updated.** The executing brief
  barred every `gsd-sdk query state.*` and `roadmap.update-plan-progress` verb. Ledger
  reconciliation for this phase is Plan 28-04's.
- **No reachability ceiling moved.** The new file is a test, adds no barrel export, and
  the 73 / 47 / 15 readings 28-01 measured are untouched.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust
boundary. The plan's four registered threats are all mitigated and each mitigation was
watched working rather than reasoned about:

- **T-28-06** (supply-chain surface): manifest, lockfile and `node_modules` all cleared;
  "unlisted but installed" cannot pass, because the resolution assertion is separate and
  was planted red against a package that *is* installed.
- **T-28-07** (the removal's own evidence): measured in one run with conditions recorded;
  the inherited figure named, its 2.11× discrepancy explained to the byte, and retired.
- **T-28-08** (browser-tier bundle weight): capped at 38912 B and required to stay below
  153005 B; ceiling planted red at 0.
- **T-28-09** (a vacuously-clean scan): the non-vacuity assertion is separate from the
  size check, and plant 5 showed the marker scan passing over an empty bundle while that
  assertion alone caught it.

## Known Stubs

None.

## Commits

- `ad36e64` — `chore(28-02): libsodium leaves the manifest, the lockfile and node_modules`
  (3 files: `packages/core/package.json`, `package-lock.json`,
  `packages/node/src/libsodium-absence.e2e.test.ts`; 399 insertions, 17 deletions).
  `git show --stat` confirms only this plan's files and no tracked-file deletions. The
  repository's pre-commit cheap guards (vocabulary, purity, mutation-ledger, disclosure,
  ledgers, reachability) ran and passed: 7 files, 267 tests.

## Self-Check: PASSED

- All five files present on disk: `packages/core/package.json`, `package-lock.json`,
  `packages/node/src/libsodium-absence.e2e.test.ts`, this summary, `deferred-items.md`.
- `ad36e64` present in `git log --all`.
- `git diff --diff-filter=D --name-only ad36e64~1 ad36e64` empty — no tracked file deleted.
- `grep -c libsodium` returns **0** for both `package-lock.json` and
  `packages/core/package.json`.
- `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` **not** updated: the executing brief
  barred every `gsd-sdk query state.*` and `roadmap.update-plan-progress` verb. Ledger
  reconciliation for this phase is Plan 28-04's.
