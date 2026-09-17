---
phase: 33-three-regions-and-a-relay-killed-on-purpose
plan: 03
subsystem: infra
tags: [cloudflare, durable-objects, typescript, wrangler, vitest]

requires:
  - phase: 33-three-regions-and-a-relay-killed-on-purpose
    plan: 01
    provides: DurableObjectJurisdiction, HOSTED_JURISDICTION, HOSTED_LOCATION_HINT,
      euJurisdictionOf, samLocationHint

provides:
  - "jurisdiction-closed.node.test.ts — criterion 1's negative proof taken at the compiler: a
    scratch tsc compile watches the sam hint value refused against DurableObjectJurisdiction
    with the refused value quoted in the diagnostic, all four permitted members compile clean
    in the same run, and a type-level Assert<[Unlisted] extends [never] ? true : false>
    exhaustiveness declaration breaks the file's own workspace typecheck on a fifth member"
  - "placement-runtime.e2e.test.ts — the tree's own record, as an executable assertion, that a
    local wrangler dev cannot carry criterion 1's negative proof at all: namespace.jurisdiction(v)
    throws the platform's own message identically for the permitted value and the hint value"
  - "A measured, load-bearing fix the plan did not carry: a scratch tsconfig under the real OS
    temp directory needs an explicit typeRoots override, or every probe fails TS2688 before it
    ever reaches the union under test"

affects: ["33-04", "33-05"]

tech-stack:
  added: []
  patterns:
    - "Compile-time negative proof: when a runtime cannot discriminate two values, take the
      proof at the earliest point a closed type can refuse one of them, with per-member
      controls plus a type-level exhaustiveness declaration rather than a diagnostic-text
      search over union members (measured not to appear in TypeScript's own output)"
    - "A record of instrument blindness as an executable assertion, not a docblock: the e2e
      spec asserts the local runtime refuses both values identically, so a future workerd
      release implementing jurisdictions reddens the spec instead of silently falsifying prose"

key-files:
  created:
    - packages/cloudflare/src/jurisdiction-closed.node.test.ts
    - packages/cloudflare/src/placement-runtime.e2e.test.ts
  modified:
    - vitest.config.ts

key-decisions:
  - "Added an explicit `typeRoots` override to every scratch tsconfig.json, pointing at the
    repository's own node_modules/@types by absolute path — not in the plan as written. Measured:
    a scratch config under the real os.tmpdir() (e.g. /var/folders/.../T on this machine) has no
    node_modules/@types anywhere in its ancestry, so every probe failed TS2688 before reaching
    the union it was written to check. An earlier hand-verification of the plan's approach had
    accidentally succeeded because the manual scratch directory used happened to sit under a
    sibling with its own node_modules — a coincidence that masked the defect until this file's
    own os.tmpdir()-based mkdtemp reproduced it deterministically."
  - "The scratch worker in placement-runtime.e2e.test.ts forwards the WORKER's own incoming
    Request to stub.fetch(request) — the same shape worker.ts:1390 already uses — rather than a
    fabricated URL string, both because it is the established pattern and because it keeps this
    file's own `127.0.0.1`-only dial criterion trivially satisfiable with nothing to grep for."
  - "MEMBERS is declared `as const satisfies readonly DurableObjectJurisdiction[]` rather than a
    bare annotation, so `(typeof MEMBERS)[number]` stays the four literals rather than widening
    to the alias — without `satisfies` the exhaustiveness declaration's `Unlisted` type would be
    `never` by construction regardless of what the union actually contains, which is a second,
    quieter form of the exact blindness this plan already forbids in the array-typed check."
  - "HOST-06 left unmarked, unchanged from waves 1 and 2 — see Requirements Ledger section below."

requirements-completed: []  # HOST-06 spans plans 01-03; the ledger's "is created" text is still
  # ahead of the tree after this plan too. Left unmarked, same reasoning as 33-01/33-02.

duration: ~75min
completed: 2026-09-14
---

# Phase 33 Plan 03: Criterion 1's Negative Proof, Taken at the Compiler Summary

**A scratch `tsc` compile watches the `sam` hint value refused against the platform's own `DurableObjectJurisdiction` union with the refused value quoted in the diagnostic and a type-level exhaustiveness check that breaks on a fifth member; a companion e2e spec records, as an assertion rather than a docblock, that a local `wrangler dev` cannot tell the hint value and a permitted value apart at all.**

## Performance

- **Duration:** ~75 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `packages/cloudflare/src/jurisdiction-closed.node.test.ts`: five real `tsc` invocations per
  run (once for the hint value, once per permitted member), all against scratch modules that
  import `DurableObjectJurisdiction` and `euJurisdictionOf` from `hosted-object.ts` by absolute
  path. The refusal case asserts a non-zero `tsc` status **and** that the refused value is
  quoted in the compiler's own diagnostic (`'"sam"'`, built by substitution from
  `HOSTED_LOCATION_HINT.sam` rather than typed as a literal); it asserts nothing about the
  union's members appearing in that text, which is measured not to happen. A discrimination
  case asserts the refused value's `tsc` status differs from the `eu` control's. A type-level
  `type _Exhaustive = Assert<[Unlisted] extends [never] ? true : false>` declaration is present
  in the exact form this plan mandates, and the array-typed form the plan forbids
  (`_exhaustive: Unlisted[]`, measured silent on both a clean and a widened union) does not
  appear anywhere in the file — confirmed by grep as its own acceptance criterion (re-checked
  against the committed blob: `0`). The refusal's exact first diagnostic line, verbatim, probe
  path trimmed to the probe-relative form (the temp-directory prefix is per-run and not
  reproducible):
  ```
  probe.ts(3,7): error TS2322: Type '"sam"' is not assignable to type 'DurableObjectJurisdiction'.
  ```
- `packages/cloudflare/src/placement-runtime.e2e.test.ts`: a throwaway scratch worker (its own
  Durable Object class, `wrangler.jsonc`, `worker.ts` — none of it this repository's own
  `worker.ts`) on a local `wrangler dev` at port 8835. Six cases record that
  `namespace.jurisdiction(v)` throws `Jurisdiction restrictions are not implemented in
  workerd.` byte-for-byte identically for the permitted `eu` value and the `sam` hint value; a
  positive control proves the harness reads a live object rather than one that fails on
  everything; two more cases show `namespace.get(id, { locationHint })` never throws for any
  value, declared or not. The scratch object sites with a fresh unique id on every request —
  the two-file guard on the platform's stub-siting call (`hosted-tier-deploy.node.test.ts`)
  still holds at exactly two files, unedited, confirmed by direct measurement.
- `vitest.config.ts`: `files` 263 -> 264, `tests` 3812 -> 3820 (the one new node-lane file and
  its eight cases), `MEASURED_NODE_SPANS` gains an entry for the new file (it spawns five real
  `tsc` processes per run, well above `SLOW_CUTOFF_MS`), and `unitFiles`/`unitTests` are
  unchanged by the identity now that the new file is excluded from the unit lane — confirmed
  behaviourally with a real `O2_UNIT_ONLY=1` run, not merely by arithmetic.

## Task Commits

1. **Task 1: Watch the hint value refused where a jurisdiction is required, with the permitted value compiling beside it** - `3613283` (test)
2. **Task 2: Record that a local runtime refuses every jurisdiction value identically and validates no hint** - `5b722c9` (test)

## Files Created/Modified

- `packages/cloudflare/src/jurisdiction-closed.node.test.ts` — created: criterion 1's negative
  proof at the compiler
- `packages/cloudflare/src/placement-runtime.e2e.test.ts` — created: the record that a local
  runtime cannot carry that same proof
- `vitest.config.ts` — `files`/`tests` counted up, one new `MEASURED_NODE_SPANS` entry,
  `unitFiles`/`unitTests` confirmed unchanged by a real run

## Decisions Made

- The `typeRoots` override (see Deviations below) — not optional, the plan's probes do not
  compile without it.
- `stub.fetch(request)` over a fabricated URL string in the scratch worker, matching
  `worker.ts`'s own established call shape and keeping the loopback-only criterion trivially
  true rather than requiring a lookahead-regex reading of a fake hostname.
- `MEMBERS` typed with `as const satisfies readonly DurableObjectJurisdiction[]` rather than a
  bare array annotation, so the exhaustiveness declaration's `Unlisted` computation depends on
  the real four literal element types instead of the widened alias.
- Two docblock passages that would otherwise have spelled `idFromName` in prose (explaining the
  two-file guard) were worded around the identifier instead — the same class of hazard this
  phase's own waves 1 and 2 already recorded for the same string in different files.
- HOST-06 left unmarked; see Requirements Ledger section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A scratch tsconfig under the real OS temp directory cannot resolve `"types": ["node"]` at all, and every probe fails `TS2688` before reaching the union under test**
- **Found during:** Task 1, first real run of the spec (all 8 cases failed, refusal and every
  permitted control alike)
- **Issue:** The plan's scratch tsconfig is `{ extends: <absolute root tsconfig path>, include:
  ["./probe.ts"] }`, with no `typeRoots` override. TypeScript's default `typeRoots` search for
  the extended config's `"types": ["node"]` walks up from the SCRATCH config's own directory,
  never the extended config's. `os.tmpdir()` on this machine resolves to
  `/var/folders/.../T`, which has no `node_modules/@types` anywhere in its ancestry, so every
  probe failed `error TS2688: Cannot find type definition file for 'node'.` — a configuration
  error that is unrelated to the union and would have been caught by this plan's own `TS5xxx`
  anti-vacuity floor had the floor not caught the WRONG thing first (every control failing
  identically, not distinguishing refused from permitted). **A hand-verification of the plan's
  literal approach, done before writing the spec, had accidentally passed**: the manual scratch
  directory used for that verification happened to sit under a sibling directory that itself
  carried a `node_modules/@types/node` from unrelated prior work, masking the defect. The real
  `mkdtemp(tmpdir())` call the spec actually uses reproduced the failure deterministically,
  confirmed by an isolated plain-`node` script with no vitest involved at all.
- **Fix:** Added `compilerOptions: { typeRoots: [<absolute path to the repo's own
  node_modules/@types>] }` to every scratch tsconfig the spec writes. Verified against all five
  values (the refusal and all four permitted members): the refusal now fails with `TS2322`
  quoting `'"sam"'` as measured, and all four permitted members exit `0`.
- **Files modified:** `packages/cloudflare/src/jurisdiction-closed.node.test.ts` (the fix lives
  in the file created by this same task, so there is no separate "before" state to diff against
  in the tree — recorded here because the plan's action text, taken literally, does not work)
- **Verification:** `npx vitest run --project node packages/cloudflare/src/jurisdiction-closed.node.test.ts`
  — 8/8, and both plants (below) reddened exactly the cases named for them.
- **Committed in:** `3613283` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3, blocking — discovered on the very first run of the
plan's own verification command).
**Impact on plan:** No scope creep and no criterion narrowed. The fix is additive
(`typeRoots`) to a scratch config the plan already specified; every other detail of the plan's
probe design (the refused-value quoting, the four-member controls, the exhaustiveness
declaration's exact form) is unchanged and verified working as written.

## Issues Encountered

**A plan-internal inconsistency in the threat model, not acted on.** `T-33-10`'s mitigation
text reads *"Task 1 asserts the diagnostic names the value **and** the union's four members"* —
this contradicts the plan's own action text and interfaces section, both of which state
(measured 2026-09-13) that TypeScript prints the alias name and never the members, and that
asserting the members would be undeliverable. The action text governs and was followed; the
stale threat-row wording is noted here rather than silently reconciled, per this plan's own
instruction to report rather than narrow a criterion when an instrument or a stated criterion
disagrees with what was measured.

**Pre-existing, unrelated failures surfaced by the required full-sweep counts (not
investigated further, out of scope).** `npx vitest run --project node` (263 -> 264 files) and
`O2_UNIT_ONLY=1 npx vitest run --project node` both surfaced failures unrelated to this plan's
two files: `packages/node/src/coverage-agents.node.test.ts` and
`packages/node/src/speculation-agents.node.test.ts` (both pass alone, 2/2 and 1/1, on isolated
re-run — attributed to host contention by measurement, the full run's own banner having called
the host oversubscribed), `packages/node/src/requirements-ledger.node.test.ts` (the same dated
`AOT-03` stale-promise finding every commit in this phase has already surfaced as "outside this
commit, not blocking" — reproduced identically in isolation), and
`packages/browser/src/nostr-bootstrap.test.ts` — re-run alone rather than assumed:
`npx vitest run --project node packages/browser/src/nostr-bootstrap.test.ts` passed 29/29 on a
quiet host, confirming the full-sweep failure was host contention and not a real defect. None
of the four names anything this plan created or modified.

## Plant Proofs

**Task 1, plant 1 — the union widened to `string`, isolating the refusal and discrimination
cases.**
- Snapshot: `cp packages/cloudflare/src/hosted-object.ts` to a scratchpad path outside the repo.
- Plant: changed `export type DurableObjectJurisdiction = 'eu' | 'fedramp' | 'fedramp-high' |
  'us'` to `export type DurableObjectJurisdiction = string`.
- Observed (named in advance, and both reddened — nothing else did): `refuses the hint value
  with the refused value quoted in the compiler's own diagnostic` —
  `AssertionError: expected +0 not to be +0` (the refusal's `tsc` status was now `0`, so
  `.not.toBe(0)` failed) — and `discriminates: the refused value and the eu control produce
  different tsc exit statuses` — `AssertionError: expected +0 not to be +0` (both now `0`,
  hence equal). 6/8 passed; every permitted-member control and the `MEMBERS.length` case stayed
  green, as expected since widening to `string` does not change what compiles.
- Restoration: reversed exactly the one line. `cmp` against the pre-plant snapshot: byte-identical.
  Re-run: 8/8.

**Task 1, plant 2 — a fifth union member, isolating the exhaustiveness declaration.**
- Snapshot: `cp packages/cloudflare/src/hosted-object.ts` to a second scratchpad path (taken
  after plant 1's restore was already `cmp`-verified).
- Plant: changed the union to `'eu' | 'fedramp' | 'fedramp-high' | 'us' | 'unlisted-test'` —
  `'unlisted-test'` chosen deliberately as an obvious test artifact, not a place word, per
  criterion 2's binding on this plan's own text.
- Observed, exactly as named in advance: `npx vitest run --project node
  packages/cloudflare/src/jurisdiction-closed.node.test.ts` stayed **green, 8/8** — vitest
  strips types and never typechecks this file for real, so nothing in a vitest run can see a
  union member being *added*. `npx tsc --noEmit -p .` (the whole workspace, per this phase's
  inherited refusal on the per-package check) reddened at exactly the case named in advance:
  `packages/cloudflare/src/jurisdiction-closed.node.test.ts(124,27): error TS2344: Type 'false'
  does not satisfy the constraint 'true'.` — line 124 is the `type _Exhaustive =
  Assert<[Unlisted] extends [never] ? true : false>` declaration itself. Had the vitest run
  reddened instead of the `tsc` run, or had both stayed green, that would have been the blind
  instrument this plan explicitly warns to watch for; neither happened.
- Restoration: reversed exactly the added member. `cmp` against the pre-plant snapshot:
  byte-identical. Re-run: `tsc --noEmit -p .` exit `0`, zero output; vitest 8/8.

**Task 2 — the refusal literal changed by one character.**
- Snapshot: `cp packages/cloudflare/src/placement-runtime.e2e.test.ts` to a scratchpad path.
- Plant: changed `EXPECTED_REFUSAL` from `'Jurisdiction restrictions are not implemented in
  workerd.'` to `'Jurisdiction restrictions are not implemented in workerX.'` (one character).
- Observed, exactly as named in advance: `refuses the permitted jurisdiction value, with the
  platform's own exact message` reddened —
  `AssertionError: expected 'Jurisdiction restrictions are not imp…' to be 'Jurisdiction
  restrictions are not imp…'` (received the real, unmodified platform message; expected the
  planted one). **`cannot distinguish the two — which is why criterion 1 is taken at the
  compiler, not here` stayed green**, exactly as the plan requires — it compares two *observed*
  values to each other and never touches `EXPECTED_REFUSAL`, so a wrong literal cannot make it
  agree with itself. 5/6 passed.
- Restoration: reversed the one character. `cmp` against the pre-plant snapshot:
  byte-identical. Re-run: 6/6.

No plant stayed green when it was supposed to redden, and no plant reddened a case other than
the one named for it in advance.

## User Setup Required

None — no external service configuration required. Every task in this plan was `agent-now`.
The live at-creation refusal from Cloudflare's own API — the same value refused during owner
act 2 — is not claimed anywhere in this plan; that is the explicit boundary both new files'
own header docblocks state.

## Requirements Ledger — HOST-06 still deliberately unmarked

Unchanged reasoning from `33-01-SUMMARY.md` and `33-02-SUMMARY.md`: `.planning/REQUIREMENTS.md`'s
checkbox text asserts objects **are created**, present tense, and no object has been created by
any of the three plans in this phase. This plan's own objective states its compile-time proof
and its e2e reading are both `agent-now`, and neither creates, deploys, or reaches a real
Cloudflare account. `requirements-completed: []` in this SUMMARY's own frontmatter; the checkbox
stays as waves 1 and 2 left it.

## Next Phase Readiness

- Criterion 1's negative proof is now in the tree twice, at the two points that can actually
  carry it: the compiler (this plan's Task 1) and the record of why a local runtime cannot
  (this plan's Task 2). The live half — passing `sam` to Cloudflare's own API during owner act
  2 — remains the only piece this phase has not taken, by design.
- The `typeRoots` fix is local to `jurisdiction-closed.node.test.ts`'s own `compileValueAs`
  helper; nothing about it is a repository-wide tsconfig change, and nothing else in this tree
  needs it unless a future plan writes another scratch-tsconfig-under-`os.tmpdir()` probe — if
  one does, this file's header docblock names the trap and the fix in one place.
- The two-file `idFromName`-naming guard (`hosted-tier-deploy.node.test.ts`) still holds at
  exactly two files after this wave, confirmed by direct measurement rather than assumed —
  `placement-runtime.e2e.test.ts` sites its scratch object with a fresh unique id per request
  and never names the platform call that would grow that list to three.
- `.planning/STATE.md` was not touched, per this phase's own standing instruction and the
  measured `state.*` tooling defect both prior waves recorded.

---
*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/cloudflare/src/jurisdiction-closed.node.test.ts`
- FOUND: `packages/cloudflare/src/placement-runtime.e2e.test.ts`
- FOUND: `vitest.config.ts`
- FOUND: `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/33-03-SUMMARY.md`
- FOUND commit: `3613283` (Task 1)
- FOUND commit: `5b722c9` (Task 2)
