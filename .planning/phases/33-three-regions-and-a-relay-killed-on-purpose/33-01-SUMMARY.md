---
phase: 33-three-regions-and-a-relay-killed-on-purpose
plan: 01
subsystem: infra
tags: [cloudflare, durable-objects, typescript, vitest]

requires:
  - phase: 29-hosted-tier-identity
    provides: HOSTED_OBJECT_NAME, HostedObjectNamespace, stubFor, the one-call-site guard

provides:
  - "DurableObjectJurisdiction (platform's four-member union) and HOSTED_JURISDICTION
    (fabric's one-member eu constant), each documented against a measured platform reading"
  - "HOSTED_LOCATION_HINT / HOSTED_LOCATION_HINTS, a closed set for the non-binding hint the
    platform itself does not validate"
  - "UnsupportedJurisdictionError and UnknownLocationHintError, named refusals for an
    undeclared placement value"
  - "euJurisdictionOf and samLocationHint — two separately-named, non-symmetric helpers with no
    shared placement parameter and no internal branch; no third helper exists for the
    already-created path, and that absence is itself documented as the placement"
  - "stubFor's optional third pass-through argument, with the one idFromName call and one
    namespace.get call unchanged"
  - "Spy-namespace proof, in the file the deploy guard already permits, that the two helpers
    reach two different platform calls in a provable order, and that an undeclared jurisdiction
    or hint is refused by name"

affects: ["33-02", "33-03", "33-04", "33-05"]

tech-stack:
  added: []
  patterns:
    - "Non-symmetric placement: two differently-named functions carrying their own literals,
      rather than one function branching on a placement union — HOST-06's rule made structural"
    - "Ordered spy-event log (discriminated union + typed filter-narrowers) instead of separate
      counters, used where a criterion is about recorded ORDER and not merely presence"

key-files:
  created: []
  modified:
    - packages/cloudflare/src/hosted-object.ts
    - packages/cloudflare/src/hosted-identity.test.ts
    - vitest.config.ts
    - .planning/phases/33-three-regions-and-a-relay-killed-on-purpose/deferred-items.md

key-decisions:
  - "HOSTED_JURISDICTION declared with an explicit `Record<'eu', DurableObjectJurisdiction>`
    annotation rather than the plan's literal `as const satisfies Record<...>` — isolatedDeclarations
    rejects an exported `satisfies` expression with no annotation (TS9010); the explicit
    annotation gives the same conformance check without violating that constraint."
  - "Reworded two docblock passages (in hosted-object.ts and in vitest.config.ts) that
    originally spelled the literal call syntax `idFromName(` in prose — the deploy guard
    (hosted-tier-deploy.node.test.ts) counts raw textual occurrences across the whole file, not
    only real calls, so descriptive prose using the literal reddened it at 3 instead of 1. The
    fix is wording, not a guard change, and no call site moved."
  - "Kept `asked` as its own array beside the new `events` log in spyNamespace() rather than
    replacing it, so the three pre-existing cases needed zero changes and Task 1's step 7
    (`jurisdiction` optional on the interface) required zero edits to the test file at all."

requirements-completed: []  # HOST-06 deliberately NOT marked — see "Requirements Ledger" section below

duration: ~40min
completed: 2026-09-13
---

# Phase 33 Plan 01: Placement Vocabulary and Non-Symmetric Siting Helpers Summary

**Two separately-named, non-branching helper functions (`euJurisdictionOf`, `samLocationHint`) and their spy-verified proof that the two placement mechanisms reach two different platform calls in a provable order — with the already-deployed path left byte-unchanged.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 completed
- **Files modified:** 4 (`hosted-object.ts`, `hosted-identity.test.ts`, `vitest.config.ts`, `deferred-items.md`)

## Accomplishments

- `packages/cloudflare/src/hosted-object.ts` now declares the platform's own four-member
  `DurableObjectJurisdiction` union (read out of the installed `workerd` binary's bundled type
  text, not documentation), the fabric's one-member `HOSTED_JURISDICTION`, and a closed
  `HOSTED_LOCATION_HINT`/`HOSTED_LOCATION_HINTS` set — because the platform validates neither
  value at all (measured: a local `workerd` accepted `{ locationHint: 'notareal' }` and
  returned a live stub).
- Two named refusals (`UnsupportedJurisdictionError`, `UnknownLocationHintError`) on the same
  message shape as the existing `UnknownHostedObjectNameError`.
- `euJurisdictionOf` narrows a namespace by jurisdiction and returns a namespace, never a stub;
  `samLocationHint` returns the `sam` hint options and takes no parameter. Neither takes a
  placement union, and neither branches internally on one. No third helper exists for the
  already-deployed path — its docblock states why: narrowing changes the derived object ID, and
  the live `bootstrap-us` object would be orphaned by wrapping its path in any jurisdiction now.
- `stubFor` gained an optional third, pass-through `options` argument with no branch on it — a
  local `workerd` was measured to accept `get(id, undefined)` identically to `get(id)`.
- `hosted-identity.test.ts` gained six new cases proving, via an ordered spy-event log rather
  than three separate counters, that the `eu` path narrows *before* it sites (asserted by
  comparing two recorded event indices, not by `toContain`), that `sam` sites on the plain
  namespace carrying a hint, that `us` carries neither, that an unsupported namespace is refused
  by name, and two anti-vacuity floors (the hint set's literal `1`, the name set's literal `3`
  plus a check that the spy fixture actually recorded calls).
- `worker.ts` and `hosted-tier-deploy.node.test.ts` are byte-unchanged — verified by empty
  `git diff --stat` on both, which is itself one of the plan's acceptance criteria.

## Task Commits

1. **Task 1: Declare the placement vocabulary and the two non-symmetric helpers** - `fa68fcf` (feat)
2. **Task 2: Prove the two helpers reach two different platform calls, and refuse what is not declared** - `bd25f88` (test)

_No separate plan-metadata commit was requested beyond these two task commits and this SUMMARY's own commit._

## Files Created/Modified

- `packages/cloudflare/src/hosted-object.ts` — jurisdiction/hint vocabulary, two named
  refusals, `euJurisdictionOf`/`samLocationHint`, `stubFor`'s widened signature
- `packages/cloudflare/src/hosted-identity.test.ts` — widened `spyNamespace()` event log, six
  new cases, three typed filter-narrowers, one `theOneElementOf` helper
- `vitest.config.ts` — `tests` 3796→3802, `unitTests` 3068→3074, both counted by a real run;
  `files`/`unitFiles` unchanged because no new spec file arrived
- `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/deferred-items.md` — logs a
  pre-existing, unrelated `tsc -p packages/cloudflare` isolation gap (see Issues Encountered)

## Decisions Made

- `HOSTED_JURISDICTION` uses an explicit type annotation instead of the plan's literal
  `as const satisfies Record<...>` text, because `isolatedDeclarations` rejects an exported
  `satisfies` expression without one (measured: `TS9010`). Same conformance guarantee, no
  behavior change.
- Two docblock passages were reworded (not the code they describe) because they spelled the
  literal text `idFromName(` in prose, and `hosted-tier-deploy.node.test.ts`'s guard counts raw
  regex matches across the whole file rather than only real call sites. This is documented as
  a Rule 1 auto-fix below, not a plan deviation in substance — no call site moved, and the guard
  stayed unedited.
- `spyNamespace()`'s pre-existing `asked` array was kept as-is beside the new `events` log
  rather than migrated, so the three pre-existing cases needed zero line changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `HOSTED_JURISDICTION`'s literal `as const satisfies Record<...>` form does not typecheck under this repo's `isolatedDeclarations`**
- **Found during:** Task 1
- **Issue:** `npx tsc --noEmit -p packages/cloudflare` reported `TS9010: Variable must have an explicit type annotation with --isolatedDeclarations` on the exact line the plan specified.
- **Fix:** Changed to `export const HOSTED_JURISDICTION: Record<'eu', DurableObjectJurisdiction> = { eu: 'eu' }` — an explicit annotation gives the same structural conformance check the `satisfies` form was for, without violating the isolated-declarations constraint.
- **Files modified:** `packages/cloudflare/src/hosted-object.ts`
- **Verification:** `npx tsc --noEmit -p packages/cloudflare` — the line no longer appears in output.
- **Committed in:** `fa68fcf` (Task 1 commit)

**2. [Rule 1 - Bug] A docblock's prose spelling `idFromName(` reddened the deploy guard's raw-text count**
- **Found during:** Task 2 (writing the new spy fixture, running the full verification chain)
- **Issue:** `hosted-tier-deploy.node.test.ts`'s "reads back the one call site" case does `source.match(/idFromName\(/g)` — a raw regex across the whole file, not filtered by comment. `euJurisdictionOf`'s docblock (added in Task 1) used the literal call syntax `namespace.jurisdiction('eu').idFromName(n)` twice in prose to explain the different-object-ID mechanism, taking the raw count from 1 to 3 and reddening the guard's `expect(calls.length).toBe(1)`. A second instance of the same pattern was found in this plan's own `vitest.config.ts` dated note, written during Task 2, which spelled `idFromName` once more (a different, unfiltered guard check: `git ls-files ... | xargs grep -l idFromName` lists tracked files that so much as *mention* the string).
- **Fix:** Reworded both passages to describe the mechanism without spelling the literal identifier — e.g. "Deriving a name through `namespace.jurisdiction('eu')` first produces a different object ID than deriving that same name straight off the plain namespace" and "the one platform call that sites a stub" in place of the identifier. No code or call site changed.
- **Files modified:** `packages/cloudflare/src/hosted-object.ts`, `vitest.config.ts`
- **Verification:** `npx vitest run --project node packages/node/src/hosted-tier-deploy.node.test.ts` passes 27/27; `git ls-files '*.ts' | xargs grep -l idFromName` reports exactly the three files the guard itself expects plus the guard file.
- **Committed in:** `fa68fcf` (hosted-object.ts wording) and `bd25f88` (vitest.config.ts wording)

---

**Total deviations:** 2 auto-fixed (both Rule 1, both discovered via the plan's own verification commands, neither changing any runtime behavior).
**Impact on plan:** No scope creep. Both fixes are wording/typing corrections inside files the plan already had open; no guard was weakened, no unrelated file was touched.

## Requirements Ledger — HOST-06 deliberately left unmarked

This plan's own frontmatter lists `requirements: [HOST-06]`, and the standard workflow step
would run `requirements mark-complete HOST-06` on that basis. **This was attempted, measured to
be wrong, and reverted before committing.**

`gsd-sdk query requirements.mark-complete HOST-06` flipped `.planning/REQUIREMENTS.md:1448`
from `- [ ]` to `- [x]` on this text: *"The three regions are `bootstrap-us`, `bootstrap-eu`
and `bootstrap-sam`, one identity in one object each. `bootstrap-eu` **is created** in the `eu`
jurisdiction…"* — present tense, describing objects that exist. **No object has been created.**
This phase's own context is explicit that creation is the owner-gated first `get()`
(`OWNER-ACTIONS.md` row 2), and this plan's objective states outright: *"Every task here is
`agent-now`. Nothing in this plan creates a Cloudflare resource, deploys, or reaches the
network."* Ticking the box would have recorded a claim the tree does not support.

**The edit was also internally self-contradictory on its own terms**: the same requirement's
ledger row at `:2193` reads *"**Not started** — the three names are settled and no object is
created under any of them"* — untouched by the same command, because `mark-complete` only
flips the checkbox list, not the ledger table. Committing the checkbox alone would have left
`[x]` sitting beside its own row's `Not started` disposition, which is exactly the kind of
checkbox-versus-ledger drift this repository's own guards (`requirements-ledger.node.test.ts`)
exist to catch.

**Checked before deciding, rather than assumed:** `HOST-06` also appears in `33-02-PLAN.md` and
`33-03-PLAN.md`'s `requirements:` frontmatter — it is split across three plans in this phase,
not owned solely by 33-01. Even after those land, the checkbox's literal "is created" claim
still needs the owner's `get()` before it is true. Reverted with `git checkout --
.planning/REQUIREMENTS.md` (my own uncommitted, unpushed edit — verified via `git status` that
nothing else had touched the file first). **Left unmarked; this SUMMARY's own frontmatter
carries `requirements-completed: []`.** The orchestrator/owner is the right party to decide
when — and whether — the ledger's "created" language should be loosened to "configured" for the
agent-visible half, or left exactly as written until a real `get()` lands.

## Issues Encountered

**Pre-existing, out-of-scope `tsc -p packages/cloudflare` gap (not fixed — logged to `deferred-items.md`).** `npx tsc --noEmit -p packages/cloudflare` reports 6 `TS2339: Property 'o2' does not exist on type 'Window & typeof globalThis'` errors, in `stop-closes-the-billed-socket.e2e.test.ts` and `packages/node/src/e2e-signin.ts`. Measured against the unmodified tree at this plan's own base commit (`aae2396`, identical to `develop`) via `git stash` / re-run / `git stash pop`: identical six errors, zero edits applied — confirmed pre-existing, not introduced by either task. Root cause read rather than guessed: `Window.o2` is declared by a `declare global` block in `packages/browser/src/tab-api.ts`, which a per-package `tsc -p packages/cloudflare` never includes. **Confirmed a tooling-isolation artifact rather than a real defect**: `npx tsc --noEmit -p .` (the whole workspace, via project references) exits `0` with zero output on this exact tree, after both of this plan's tasks. Out of scope per the scope boundary (neither failing file is touched by either task); full detail in `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/deferred-items.md`.

**Four pre-existing, unrelated test failures surfaced by the required full-sweep counts (not investigated further — out of scope).** Counting `tests`/`unitTests` for `vitest.config.ts` per the plan's own instruction required running `npx vitest run --project node` (full, 263 files) and `O2_UNIT_ONLY=1 npx vitest run --project node`. Both runs surfaced failures unrelated to this plan's two files: `packages/node/src/closed-fabric-agents.node.test.ts`, `packages/node/src/enrolment-residual.node.test.ts`, `packages/node/src/requirements-ledger.node.test.ts` (a dated stale-promise finding tied to the calendar, reproduced identically in both runs and in this plan's own pre-commit guard output), and `packages/node/src/result-signature.node.test.ts` (a real subprocess enrollment RPC timeout). None names `hosted-object`, `hosted-identity`, or anything in `packages/cloudflare`. Named in `vitest.config.ts`'s new dated note rather than investigated, per the scope boundary and per not overdoing verification once the plan's own two target specs (`hosted-identity.test.ts`, `hosted-tier-deploy.node.test.ts`) were independently confirmed green.

## Plant Proof (Task 2's required plant)

- **Snapshot:** `cp packages/cloudflare/src/hosted-object.ts` to a scratchpad path outside the repository, immediately before planting.
- **Plant:** Changed `euJurisdictionOf`'s body from `return namespace.jurisdiction(HOSTED_JURISDICTION.eu)` to `return namespace`.
- **Observed failure (exactly the case the plan named in advance):**
  ```
  FAIL  |node| packages/cloudflare/src/hosted-identity.test.ts > criteria 4 and 6 — one call
  site, and a closed set of names > narrows the namespace to the eu jurisdiction before
  anything is sited, and sites on the narrowed namespace
  AssertionError: expected +0 to be 1 // Object.is equality
  - Expected: 1
  + Received: 0
  at packages/cloudflare/src/hosted-identity.test.ts:325:31 (expect(narrowings.length).toBe(1))
  ```
  Exactly 1 test failed out of 14; no other case reddened.
- **Restoration:** Reversed exactly the planted line back to
  `return namespace.jurisdiction(HOSTED_JURISDICTION.eu)`.
- **Verification:** `cmp` against the pre-plant snapshot reported no difference (byte-identical).
  Re-ran the full spec afterward: 14/14 passed.

## User Setup Required

None — no external service configuration required. Every task in this plan was `agent-now`;
nothing was deployed, created, or reached the network.

## Next Phase Readiness

- `euJurisdictionOf` and `samLocationHint` are ready for `33-02`/`33-03` to wire into the
  three region configurations — the interfaces section of the plan is now backed by working,
  spy-verified code.
- `stubFor`'s widened signature and `HostedObjectNamespace`'s optional `jurisdiction` member are
  additive and backward-compatible; `worker.ts`'s existing `stubFor(env.BOOTSTRAP, SERVED_BY)`
  call needed no change and received none.
- `hosted-tier-deploy.node.test.ts`'s two-file guard on the platform's stub-siting call still
  holds at exactly two files, unedited — the constraint plan 33-02 depends on for its own
  deploy-config wiring.
- The `deferred-items.md` isolation-gap note is available for whichever future plan touches
  `tsconfig` structure; it is not blocking for `33-02` through `33-05`.

---
*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Completed: 2026-09-13*

## Self-Check: PASSED

- FOUND: `packages/cloudflare/src/hosted-object.ts`
- FOUND: `packages/cloudflare/src/hosted-identity.test.ts`
- FOUND: `vitest.config.ts`
- FOUND: `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/deferred-items.md`
- FOUND: `.planning/phases/33-three-regions-and-a-relay-killed-on-purpose/33-01-SUMMARY.md`
- FOUND commit: `fa68fcf` (Task 1)
- FOUND commit: `bd25f88` (Task 2)
