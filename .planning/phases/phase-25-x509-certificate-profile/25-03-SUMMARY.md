---
phase: 25-x509-certificate-profile
plan: 3
subsystem: testing
tags: [vite, bundle-size, gzip, x509, der, e2e, vitest]

# Dependency graph
requires:
  - phase: 25-x509-certificate-profile (25-01, 25-02)
    provides: "decodeX509Certificate and the seven-obligation X.509 profile in packages/core/src/x509.ts"
provides:
  - "A measured, guarded ceiling on the X.509 decoder's contribution to the browser tier's gzip-compressed bundle weight (DECODER_BUDGET_BYTES)"
  - "A dual synthetic Vite library-mode build harness (packages/node/src/x509-bundle.e2e.test.ts) that can be reused as the pattern for any future 'what does importing X cost the browser tier' question"
affects: [x509-certificate-profile, browser-bundle-budget]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual synthetic Vite library-mode build, same process, same run — a comparative gzip delta instead of a before/after diff across separate CI runs or hosts"
    - "Scratch entry files written under <repo-root>/tmp/ (gitignored) rather than os.tmpdir(), specifically so Vite's bare-specifier resolution finds the workspace's real node_modules without a resolve.alias"

key-files:
  created:
    - packages/node/src/x509-bundle.e2e.test.ts
  modified: []

key-decisions:
  - "Diverged from RESEARCH.md §5's literal proposal (diff the real demo bundle before/after) because packages/browser/demo/main.ts has no reason to import the decoder yet (25-02 scope) — a real diff would tree-shake to a false near-zero. Built a purpose-made dual entry instead, exactly as 25-03-PLAN.md's objective specifies."
  - "DECODER_BUDGET_BYTES = 25600 (25 KiB), sited against a measured ~19064-byte gzip delta with ~1.34x headroom, in the plan's own stated 1.2-1.5x range — not guessed in advance."
  - "The measured delta is the decoder's real transitive graph (dag-cbor + multiformats, pulled in by the extension decoders' dag-cbor.decode calls), not x509.ts's own lines alone. Documented explicitly as the more conservative of the two honest numbers, since a real page that already loads dag-cbor for canonical encoding would see a smaller marginal cost."
  - "Entry files live under <repo-root>/tmp/ instead of os.tmpdir() (deviating from built-bundle.e2e.test.ts's literal mkdtemp(tmpdir(), ...) pattern), because Vite's bare-specifier resolution walks up from the importing file's own directory — an entry outside the repo tree cannot find node_modules/@o2/core without an alias. Confirmed empirically before writing the final file, not assumed."

requirements-completed: [X509-04]

# Metrics
duration: 25min
completed: 2026-08-09
---

# Phase 25 Plan 3: X.509 Decoder Bundle-Cost Guard Summary

**A dual synthetic Vite build proves and guards the X.509 decoder's real browser-bundle cost: ~19064 bytes gzip, ceilinged at 25600 (25 KiB, ~1.34x headroom), with the guard proven to actually fail by planting and watching it go red twice.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 1
- **Files modified:** 1 (new file)

## Accomplishments

- Closed the second of the two numbers the owner ruling (25-CONTEXT.md) says "this phase owes, not a caveat it may inherit": the X.509 decoder's bundle weight on the browser tier, measured rather than inherited from RESEARCH.md's earlier estimate.
- Built the measurement as a within-one-run comparative delta (two Vite library-mode builds, one process, one run) rather than a before/after diff across separate builds or hosts — satisfying CLAUDE.md's Measurement convention directly rather than by accident.
- Discovered and documented *why* the delta is what it is: `decodeX509Certificate`'s two dag-cbor-backed extension decoders (`EXT_OPERATOR_ID`, `EXT_RELAY_IDS`) pull in `@ipld/dag-cbor` and `multiformats`' CID/hasher/varint machinery — confirmed by an unminified probe build showing dag-cbor/multiformats/`@noble/hashes` internals in the output, and the *absence* of unrelated `@o2/core` kernel exports (`verifyChain`, `SelfRecordIndex`, `WasmExecutor`), ruling out "the barrel just didn't tree-shake" as the explanation.
- Proved the guard actually guards: planted `DECODER_BUDGET_BYTES = 0`, watched the suite fail twice with the real measured delta named in the assertion text, restored the constant via the surgical inverse of the one-line edit, and verified the restoration was byte-identical to a pre-plant snapshot with `cmp`.

## Task Commits

1. **Task 1: Dual synthetic build, gzip delta measurement** - `1cbbf49` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/node/src/x509-bundle.e2e.test.ts` - New `e2e`-project vitest file. `beforeAll` creates a scratch workdir under `<repo-root>/tmp/`; `buildAndMeasure()` writes a throwaway entry, runs `vite`'s `build()` API in library mode (`formats: ['es']`, default/production minification), reads the output, and gzips it with `node:zlib.gzipSync`. One `it` block builds a no-`@o2/core`-import baseline and a real-import-and-call decoder entry sequentially, asserts the decoder entry is strictly larger (proves the import wasn't tree-shaken away), then asserts the gzip delta is at or under `DECODER_BUDGET_BYTES`. The budget constant sits at the bottom of the file with a "sited, not picked" docblock matching `capability.ts:101-127`'s `MAX_CHAIN_DEPTH` convention, including the planted-mutation proof's verbatim observed failure text.

## Decisions Made

See `key-decisions` in the frontmatter above. In short: diverged from RESEARCH.md §5's literal before/after-diff proposal (per the plan's own stated reasoning, not a new deviation), sited the budget at a measured number with explicit headroom rather than guessing one in advance, and used a repo-tree scratch directory instead of `os.tmpdir()` because module resolution required it — confirmed by direct experiment before finalizing the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the recorded measured numbers and planted-mutation failure text as actual measurements came in**
- **Found during:** Task 1, while writing the docblock and performing the required planted-mutation proof.
- **Issue:** An initial draft of the docblock recorded provisional numbers taken from an out-of-suite probe script (`19066` bytes gzip delta) before the real test file existed to measure against. Once the actual test file ran inside vitest, the real measured delta differed slightly (~19063-19065 bytes, observed to vary by run) because of a distinct effect: Rollup embeds the entry file's own `mkdtemp`-generated absolute path in a `//#region <path>` debug comment even under production minification, and the path's random suffix differs by run, shifting gzip's output by a byte or two.
- **Fix:** Investigated and confirmed the cause directly (two fixed, non-mkdtemp-path builds produced byte-identical output via `cmp`; mkdtemp'd builds did not). Updated every recorded number in the file's docblocks and the planted-mutation proof's "observed failure, verbatim" text to match the real, final measurement (`19064`), rather than leaving the provisional probe numbers in place. This is exactly the case CLAUDE.md's Measurement convention exists for: "never write a measured span you did not measure."
- **Files modified:** `packages/node/src/x509-bundle.e2e.test.ts` (only)
- **Verification:** Re-ran `npx vitest run --project e2e packages/node/src/x509-bundle.e2e.test.ts` after each correction; `EXIT=$?` read directly, `0` each time. Final planted-mutation cycle re-performed against the corrected file: planted, watched red (`EXIT=1`, "AssertionError: expected 19064 to be less than or equal to 0"), restored, `cmp`-verified clean against a snapshot taken immediately before that final plant.
- **Committed in:** `1cbbf49` (Task 1 commit — the corrections landed before the one commit this plan makes, so there is no separate fix-up commit)

---

**Total deviations:** 1 auto-fixed (1 bug/measurement-accuracy correction, Rule 1)
**Impact on plan:** No scope creep — the correction is entirely within this plan's own file and its own obligation to record only measurements it actually took.

## Issues Encountered

- **Small run-to-run variance in the measured delta (~2 bytes, 19063-19065).** Root-caused rather than shrugged off: Rollup's `//#region <path>` debug comment embeds the `mkdtemp`-generated entry file's absolute path, whose random suffix differs per run. Confirmed by a controlled experiment (fixed paths → byte-identical output; `mkdtemp`'d paths → the variance). Documented in both the assertion's own comment and the `DECODER_BUDGET_BYTES` docblock rather than hidden, and is three orders of magnitude smaller than the ~6500-byte headroom the ceiling carries.
- **The measured delta is the decoder's whole transitive graph, not a small self-contained number.** `x509.ts` is ~900 lines but its two dag-cbor-backed extension decoders pull in `@ipld/dag-cbor` and `multiformats`. This is real cost, not a measurement artifact — confirmed by inspecting an unminified build's function bodies. Documented as a finding in the docblock (per the plan's "report it as the finding it is" complication guidance) rather than engineered around.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both of the owner ruling's owed numbers are now closed: obligation 5's chain-depth bound was already delivered before this phase (`capability.ts:127`/`:190`), and this plan closes the bundle-weight number. `MAX_CERTIFICATE_BYTES`, `MAX_EXTENSION_BYTES`, and `MAX_EXTENSION_COUNT` (25-01/25-02) remain the certificate-shape-side guards; `DECODER_BUDGET_BYTES` (this plan) is the browser-shape-side guard.
- No production caller of `decodeX509Certificate` exists yet — unchanged from 25-02, and out of this plan's scope. Six of the seven X509 requirements remain ledgered "Built, not wired" per 25-CONTEXT.md; wiring is future work.
- If a future plan adds a production caller (e.g. `verifyCertificate`/`relayAdmissionGate` growing an X.509 branch), re-running this guard against the *real* demo bundle (RESEARCH.md §5's original proposal) becomes meaningful for the first time — today it would still measure a tree-shaken-away import, which is exactly why this plan built the synthetic harness instead.

---
*Phase: 25-x509-certificate-profile*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: `packages/node/src/x509-bundle.e2e.test.ts`
- FOUND: `.planning/phases/phase-25-x509-certificate-profile/25-03-SUMMARY.md`
- FOUND: commit `1cbbf49`
