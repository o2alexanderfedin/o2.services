---
phase: phase-13-egress-manifest-completeness
plan: 06
subsystem: docs
tags: [egress, sovereignty, requirements-ledger, roadmap, call-site-guard]

# Dependency graph
requires:
  - phase: phase-13-egress-manifest-completeness
    plan: "04"
    provides: EgressGuard.send records then refuses, and EgressRefusal — the mechanism the rewritten DATA-05 row states, and the mechanism that makes the sovereign-data-does-not-move ruling checkable rather than remembered
  - phase: phase-13-egress-manifest-completeness
    plan: "05"
    provides: the in-process and two-spawned-process proofs the DATA-05 row cites
  - phase: phase-13-egress-manifest-completeness
    plan: "07"
    provides: EgressGuard.release and the registration lifetime the DATA-05 row's fourth clause states
provides:
  - packages/node/src/bench-egress.node.test.ts — the automated coverage 13-VERIFICATION.md found missing for bin/bench.ts's egress leg, with a comment-stripping matcher so prose cannot satisfy it
  - .planning/REQUIREMENTS.md DATA-05/DATA-06 restated against the amended criteria, in both the checklist and the traceability table
  - .planning/PROJECT.md Key Decisions — the owner's 2026-07-28 ruling that raw sovereign data does not move between nodes, verbatim and unhedged
  - .planning/ROADMAP.md Phase 19 Constraints — the same ruling plus the browser tier's compiled-but-never-executed refusal branch
affects: [phase-19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A source-scanning guard strips comments before matching, because the file it guards names every identifier it keys on in its own prose — a guard satisfiable by a description of the thing it guards is not a guard"
    - "A requirement holds a list of patterns, all of which must match: a value constructed and passed, a manifest indexed and read. A requirement met by half of itself is the exact shape mutation 4 walked through"
    - "toEqual([name]) rather than toContain on a planted removal, so every planted case is simultaneously the control for the other three"

key-files:
  created:
    - packages/node/src/bench-egress.node.test.ts
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/PROJECT.md
    - .planning/ROADMAP.md

key-decisions:
  - "A second real mutation was planted, on the same authorised path, because the first one answered the wrong question. Deleting `guard: requestor.egress` is caught by `tsc` too (Fabric.guard is a required field), so mutation 1 alone shows 'both catch it' — a weak answer to 'what does only this test catch'. Mutation 2 is the edit 13-VERIFICATION.md said would pass the whole suite: call and manifest read removed together. Under it `tsc --noEmit` exits 0 and the full suite reports exactly one failure, this test"
  - "13-VERIFICATION.md's mutation 4 could not be reproduced as literally written: `submitJob` is exported from `@o2/core`, not `@o2/net`, so a bare-`submitJob` revert that only edits the call site fails to resolve the import. Mutation 2 moves the import to the barrel that actually has it, which is what makes the tsc-clean reading real rather than an artefact of a broken import"
  - "The DATA-05 checklist entry's own requirement text was rewritten, not only its comment. It said 'a stream-tap test fails'; the subject of the requirement is now the refusal, because a requirement phrased about a test is satisfiable by editing the test"
  - "`.planning/REQUIREMENTS.md`'s standing note beneath the two rows ('marked done on their executors' reports … re-check the ledger against the code') was left untouched. It is accurate history and its instruction is exactly what this plan carried out"

patterns-established:
  - "When a planted mutation is caught by the type-checker as well, that is a finding to report rather than a result to accept — plant the variant the type-checker misses, or the capture proves the wrong thing"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 18min
completed: 2026-07-28
---

# Phase 13 Plan 06: The Ledger Says What The Code Does Summary

**The DATA-05/DATA-06 rows now state the refusal, its whole-payload granularity and its
response-leg cost instead of a test that fails; the owner's ruling that raw sovereign data
never moves is recorded verbatim where Phase 19 reads it; and `bin/bench.ts`'s egress leg
is held by a comment-stripping call-site guard that was watched failing under an edit
`tsc --noEmit` passes clean.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-28T13:36 -0700
- **Completed:** 2026-07-28T13:54 -0700
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Task Commits

1. **Task 1: restate the DATA-05/DATA-06 ledger rows against the amended criteria** — `cf68a85` (docs)
2. **Task 2: record the two rulings where Phase 19 will read them** — `d5a3b1b` (docs)
3. **Task 3: guard bin/bench.ts's egress leg with a test, not the type-checker** — `895f96b` (test)

The two real mutations that follow Task 3's commit leave no lasting change, so nothing was
staged for them.

**Plan metadata:** (this commit, following)

## Accomplishments

- **DATA-05 is now a statement about the mechanism, not about a test.** Its requirement
  text moves from "a stream-tap test fails if raw sovereign bytes cross" to the tap
  refusing the send, so the bytes never leave and the job fails as a consequence. Its
  comment states four things and no more than it can support: the push-before-throw
  refusal with `totalBytes` excluding a frame that never left (13-04); the granularity as
  measured — whole registered payload, contiguous and byte-identical, with the eleven-byte
  probe that crossed unremarked, and Phase 4's phrase *a detector, not a prover*; the
  asymmetry a caller observes, named as an accepted cost rather than an open defect; and
  the registration lifetime that bounds the scan set (13-07).
- **DATA-06 is re-checked against the criterion that exists.** The comment says plainly
  what the amendment gave up and where it went — a remote node's manifest needs a wire
  message kind `protocol.ts` does not define, `13-CONTEXT.md` deferred building one, and
  cross-process retrieval is now a named future item rather than an implied promise. The
  "each owner's node" clause is gone rather than quietly reinterpreted, and `bin/agent.ts`
  is stated out of scope because it is serving-only and never submits a job.
- **Both traceability rows cite the plans behind each claim** — 13-04 for the refusal,
  13-05 for the in-process and cross-process proofs, 13-07 for the registration lifetime,
  13-06 for the benchmark call-site coverage — so a later reader can check rather than
  trust. That is the specific failure mode `13-VERIFICATION.md` closed its report on.
- **The owner's ruling is in `.planning/PROJECT.md`'s Key Decisions, verbatim and
  unhedged**, with the mechanism named so the row is checkable, and the owner-domain
  replication row now points at it: the owner places the data, the fabric does not move it.
- **`.planning/ROADMAP.md`'s Phase 19 block gains a Constraints line** carrying the same
  ruling against criterion 2, plus the browser tier's refusal branch — identical guard
  composition, never executed — extending the WIRE-03 routing `13-03-PLAN.md` opened.
- **`bench-egress.node.test.ts` exists and has been watched failing twice.** Six tests: one
  over the real source, four planted single-requirement removals asserted with
  `toEqual([name])`, and one comments-only case proving prose cannot satisfy it.
- **The finding that mattered most was not predicted by the plan.** The mutation the plan
  named is caught by `tsc` as well, so it proves the wrong thing. The variant that isn't —
  call and manifest read removed together — leaves `tsc --noEmit` at exit 0 and produces
  **exactly one failure in the entire 124-file suite**, this test.

## Files Created/Modified

- `packages/node/src/bench-egress.node.test.ts` — new, 196 lines. `stripComments` and
  `unmetRequirements` are plain functions over a string; the source is read once at module
  scope, the way `vocabulary.node.test.ts` computes `REPO` once. Four requirements in a
  data array, each with a name, its patterns, its stated reason and a minimal satisfying
  fragment. Header states what the guard is (a call-site shape guard in
  `purity.node.test.ts` / `disclosure-gate.node.test.ts`'s idiom), what it is not
  (behavioural), why behavioural was rejected (`bin/bench.ts` drives its ladders and a
  real-libp2p sweep from a top-level `main()` on import), and the one limit of a
  regex-based comment strip along with the direction its failure falls.
- `.planning/REQUIREMENTS.md` — the DATA-05 checklist entry and comment, the DATA-06
  checklist entry and comment, and both traceability rows. Four places, exactly the four
  the plan named.
- `.planning/PROJECT.md` — one new Key Decisions row; one clause appended to the
  owner-domain replication row pointing at it. The integrity-mechanism table near line 26
  was deliberately left alone: it describes what is verified, not how the data arrives.
- `.planning/ROADMAP.md` — one hunk, inside the Phase 19 block. Nothing else.

## `git diff .planning/ROADMAP.md` — the required evidence

Captured before the Task 2 commit. One hunk (`git diff … | grep -c '^@@'` → `1`), at
`@@ -395,6 +395,9 @@`, inside the Phase 19 block whose header is at line 392:

```diff
diff --git a/.planning/ROADMAP.md b/.planning/ROADMAP.md
index 9187ede..40b5c9d 100644
--- a/.planning/ROADMAP.md
+++ b/.planning/ROADMAP.md
@@ -395,6 +395,9 @@ Plans:
 **Depends on**: Phase 18, Phase 17
 **Requirements**: AUTH-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10, WIRE-03
 **Research**: None — `composeQuorum`, `attestationReceipt`, and `resolveReplicaSets` exist and are unit-verified in Phase 6; the gap is that nothing on the production dispatch path calls them, and no test has ever put two tabs on a static bundle without a harness dialing for them
+**Constraints** (recorded 2026-07-28 by Phase 13, before criterion 2's plan is written):
+  - Raw sovereign data does not move between nodes, including two nodes the same owner controls — `EgressGuard.send` refuses any frame carrying a registered sovereign payload rather than forwarding it (Plan 13-04). Criterion 2 below is therefore reachable only if the owner has already placed the input on both of their live nodes; the fabric will not fetch it onto the second one. See the **Raw sovereign data does not move between nodes** row in `.planning/PROJECT.md`'s Key Decisions
+  - That refusal path has no runtime coverage in a real tab anywhere. `BrowserNode` composes the identical `EgressGuard` and `registerSovereignInputs` wiring `FabricNode` does, but no sovereign job has ever run in a browser, so the refusal branch is compiled and never executed. This is the same structural gap `12-VERIFICATION.md` recorded and `13-03-PLAN.md` already routed to WIRE-03; naming it here so the WIRE-03 planner knows there is now a *behavior* to exercise and not only a composition to inspect
 **Success Criteria** (what must be TRUE):
   1. A verification quorum assembled during a job run through `bin/agent.ts` contains at least one backbone-anchored replica and no two replicas from the same operator — a run engineered to try to fill a quorum from one operator's nodes is refused rather than silently accepted
   2. Several node certificates chaining to one owner's user key resolve, through `bin/agent.ts`, as a single discoverable replica set; a sovereignty-pinned task with two or more of that owner's nodes live executes on two of them, the outputs are compared, and the receipt reports the agreement as owner-domain, not independent-operator
```

The Phase 13 block, the amended criteria, the plan list and the milestone checklist are all
byte-identical afterwards — they are not in the diff at all.

Both of `vocabulary.node.test.ts`'s `EXEMPT_LINES` entries for `.planning/ROADMAP.md`
survive verbatim. Each was grepped for by its exact phrase after the edit and each returned
its line — 208 and 209 respectively, both far outside the Phase 19 block and both untouched
by the hunk above. The phrases are deliberately **not** reproduced here: those exemptions
are scoped to `.planning/ROADMAP.md`, and this summary is a different file inside the same
scan's jurisdiction, so quoting them back would turn the guard red in the act of reporting
that it is green. `vocabulary.node.test.ts`'s dead-exemption check passing in every run
below asserts the same fact from the other side, and does it without the hazard.

## Task 3 — two real mutations, planted, run, captured, reverted

Both in `packages/node/src/bin/bench.ts`, the one path this task authorises for revert.
The guard test was committed first (`895f96b`), so both mutations were measured against a
committed test rather than a working copy.

### Mutation 1 — delete the `guard: requestor.egress` line (the mutation the plan named)

```diff
@@ -228,7 +228,6 @@ async function realFabric(nodes: number): Promise<Fabric> {
     // `FabricNode.start` already wraps its transport in an `EgressGuard` (`egress`)
     // and builds `rpc` over that wrapper (13-02) — nothing to construct here, only
     // to surface, exactly the same field `bin/agent.ts`'s own `FabricNode` exposes.
-    guard: requestor.egress,
     async close() {
```

```
$ npx vitest run packages/node/src/bench-egress.node.test.ts

 FAIL  |node| packages/node/src/bench-egress.node.test.ts > bin/bench.ts still routes its jobs through the submitting node’s tap > satisfies every call-site requirement in the real source
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "packages/node/src/bin/bench.ts — missing: realFabric hands the submitting node’s own tap to the job path. Why it matters: Amended ROADMAP criterion 2 promises the manifest of the *submitting* node, and this is the site that supplies it. FabricNode.start already built the guard and constructed rpc over it, so realFabric only has to surface the field — which is why deleting one line is enough to leave the real-libp2p sweep reporting egress for nobody.",
+ ]

 ❯ packages/node/src/bench-egress.node.test.ts:165:60
    163|     expect(BENCH_SOURCE).toContain('async function realFabric')
    164|
    165|     expect(describeUnmet(unmetRequirements(BENCH_SOURCE))).toEqual([])
       |                                                            ^
    166|   })
    167| })

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

`npx tsc --noEmit` on the same mutated tree:

```
packages/node/src/bin/bench.ts(224,3): error TS2741: Property 'guard' is missing in type '{ executors: RemoteExecutor[]; blockstore: MemoryBlockstore; moduleCid: CID<unknown, number, number, Version>; close(): Promise<void>; }' but required in type 'Fabric'.
tsc exit: 1
```

**Reported rather than smoothed over: this mutation proves the wrong thing.** The test
fails and names the right requirement — but `tsc` fails too, because `Fabric.guard` is a
required interface field. So mutation 1 establishes "both the type-checker and this test
catch it", which is a weak answer to the question the plan asked the capture to settle:
*what does the type-checker catch versus what does only this test catch?* On this
particular deletion, the answer is "nothing only this test catches". Left there, the
capture would have shown the new guard to be redundant with `tsc` — the opposite of the
finding it exists to record.

Reverted with `git checkout -- packages/node/src/bin/bench.ts`; clean.

### Mutation 2 — the edit 13-VERIFICATION.md said would pass the whole suite

The call and the manifest read removed *together* — the combination §"`bin/bench.ts`:
wired, real numbers, but only `tsc` guards it" names in its closing sentence: *"an edit
removing both together would pass the whole suite."*

```diff
@@ -33,6 +33,7 @@ import {
   WasmExecutor,
   canonicalCid,
   publicNodes,
+  submitJob,
 } from '@o2/core'
@@ -42,7 +43,6 @@ import {
   RpcBlockSource,
   RpcEndpoint,
   serveAgent,
-  submitJobWithEgress,
 } from '@o2/net'
@@ -264,7 +264,7 @@ function runnerFor(build: (nodes: number) => Promise<Fabric>): {
     const started = performance.now()
-    const result = await submitJobWithEgress(
+    const result = await submitJob(
       {
         moduleCid: fabric.moduleCid,
         shards: shards.map((value) => ({ value, label: 'public' as const })),
@@ -273,20 +273,9 @@ function runnerFor(build: (nodes: number) => Promise<Fabric>): {
       },
       fabric.blockstore,
-      [fabric.guard],
     )
     const makespanMs = performance.now() - started

-    if (result.ok) {
-      // Exactly one guard was supplied above, so exactly one manifest comes back —
-      // still read defensively rather than asserted, per `noUncheckedIndexedAccess`.
-      const manifest = result.manifests[0]
-      if (manifest !== undefined) {
-        egressEntries += manifest.entries.length
-        egressBytes += manifest.totalBytes
-      }
-    }
-
     const complete = result.ok && result.job.complete
```

**The type-checker does not notice:**

```
$ npx tsc --noEmit
tsc exit: 0        (no output)
```

The test does:

```
$ npx vitest run packages/node/src/bench-egress.node.test.ts

 FAIL  |node| packages/node/src/bench-egress.node.test.ts > bin/bench.ts still routes its jobs through the submitting node’s tap > satisfies every call-site requirement in the real source
AssertionError: expected [ …(2) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "packages/node/src/bin/bench.ts — missing: the measured job path calls submitJobWithEgress with a guard array. Why it matters: Bare submitJob returns no manifests at all, so this one call is the driver’s entire egress leg. The guard array is what makes the manifest that comes back the submitting node’s own, rather than an argument nobody supplied.",
+   "packages/node/src/bin/bench.ts — missing: the returned manifest is read, not merely requested. Why it matters: The half mutation 4 showed the type-checker catches only incidentally — it flagged the reverted call because this read was still there to fail on, and an edit removing both together would have passed the whole suite. A manifest requested and discarded is not a measurement, and these two figures are what the run prints.",
+ ]

 ❯ packages/node/src/bench-egress.node.test.ts:165:60

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

And the whole suite under the same mutated tree — **exactly one failure in 124 files, and
it is this test**:

```
$ npm test        # under Mutation 2

 Test Files  1 failed | 123 passed (124)
      Tests  1 failed | 1797 passed (1798)
   Duration  303.92s
```

That is the closure of `13-VERIFICATION.md`'s second `missing:` entry for criterion 2,
measured rather than argued: before this plan the count under that mutation would have been
124 passed / 1798 passed with `tsc` clean, and nothing in the repository would have said a
word.

**One correction to `13-VERIFICATION.md`'s mutation 4, found while reproducing it.**
`submitJob` is exported from `@o2/core`, not `@o2/net` (`packages/core/src/index.ts:42`).
A bare-`submitJob` revert that edits only the call site therefore fails to resolve:

```
packages/node/src/bin/bench.ts(45,3): error TS2305: Module '"@o2/net"' has no exported member 'submitJob'.
tsc exit: 1
```

That is an import error, not a detection of the missing egress leg, and taking it as
evidence would have been the same mistake in miniature. Mutation 2 above moves the import
to the barrel that actually has the symbol, which is what makes its `tsc exit: 0` a real
reading.

### After the revert

```
$ git status --short packages/node/src/bin/bench.ts
(empty)

$ git status --short
(empty)

$ npx tsc --noEmit
tsc exit: 0
```

`git status --short` over the whole tree was empty — no other agent's uncommitted work was
present at any point, and nothing outside this plan's own four files was touched. No
`git add -A`, no `git commit -a`, and `git checkout --` was used against exactly one path,
`packages/node/src/bin/bench.ts`, which is the one path this task authorises.

## Verification — real counts from real runs

```
$ npx tsc --noEmit
tsc exit: 0        (no output)

$ npx vitest run packages/node/src/bench-egress.node.test.ts --reporter=verbose
 ✓ bin/bench.ts still routes its jobs through the submitting node’s tap > satisfies every call-site requirement in the real source 2ms
 ✓ the scan can report an unmet requirement — proved by planting, not assumed > reports exactly "realFabric hands the submitting node’s own tap to the job path" when only that call site is gone 0ms
 ✓ … > reports exactly "memoryFabric builds a tap for the submitting endpoint and supplies that same one" when only that call site is gone 0ms
 ✓ … > reports exactly "the measured job path calls submitJobWithEgress with a guard array" when only that call site is gone 0ms
 ✓ … > reports exactly "the returned manifest is read, not merely requested" when only that call site is gone 0ms
 ✓ … > reports all four when every identifier appears only inside a comment 0ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npx vitest run packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts
 Test Files  2 passed (2)
      Tests  38 passed (38)

$ npm test
 Test Files  124 passed (124)
      Tests  1798 passed (1798)
   Duration  295.64s
```

**The counts reconcile exactly.** The repository was at 123 files / 1792 tests when this
plan started. It adds one file with six tests, and `.node.test.ts` files run under the
`node` project only: 1792 + 6 = **1798**, 123 + 1 = **124**. Nothing else changed state at
any point outside the two deliberate mutations.

## Decisions Made

- **A second mutation, on the same authorised path.** Recorded above in full. The plan
  asked for one; the one it asked for turned out to be caught by `tsc` as well, which
  answers the plan's own stated question ("what the type-checker catches versus what only
  this test catches") with "nothing". Planting the variant the type-checker misses is the
  same discipline applied to its own result, not a change of design — same file, same
  plant/watch/capture/revert cycle, same single authorised revert path.
- **A requirement holds a list of patterns, not one.** The plan's `<action>` says "a name,
  a pattern, and a stated reason", but two of the four requirements it then describes are
  conjunctions in the source — the `requestorGuard` construction *and* its use as `guard`;
  the `manifests` index *together with* an `entries.length` and a `totalBytes` read. A
  single pattern cannot express those without becoming a brittle multiline regex, and a
  requirement met by half of itself is precisely the shape mutation 4 exposed. `patterns:
  readonly RegExp[]`, all of which must match, is the honest reading of the plan's own
  text, and the interface says why.
- **`toEqual([name])` on every planted removal**, never `toContain`. It asserts that the
  other three requirements are still satisfied by the same synthetic source, so each of
  the four planted cases doubles as the control for the rest. That is why no separate
  "the complete synthetic source reports nothing" test was added — it would restate what
  four assertions already carry.
- **An anti-vacuity reading sits in the real-source test** — length, plus both function
  names. `readFileSync` would throw on a wrong path, but a truncated or replaced file would
  not, and "nothing unmet" over an empty string is the failure mode every scan has.
- **The DATA-05 requirement text itself was rewritten, not only its comment.** A
  requirement phrased as "a stream-tap test fails" is satisfiable by editing the test. The
  subject is now the refusal, which is satisfiable only by the code.
- **`.planning/REQUIREMENTS.md`'s standing note beneath the two rows was left in place.**
  It reads "Both rows above were marked done on their executors' reports … re-check the
  ledger against the code, not the reports." That is accurate history, its instruction is
  exactly what this plan carried out, and the plan named four places to edit — this is not
  one of them.
- **The integrity-mechanism table near `.planning/PROJECT.md` line 26 was left alone**, as
  the plan directed: it describes what is verified, not how the data arrives, and a
  transport caveat would blur a table that is deliberately about integrity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] The plan's named mutation does not prove the plan's named claim**

- **Found during:** Task 3, immediately after the first planted mutation ran
- **Issue:** The plan asks for the `guard: requestor.egress` deletion to be captured
  "alongside the `npx tsc --noEmit` result for the same mutated tree, so the summary shows
  what the type-checker catches and what only this test catches". `tsc` exits 1 on that
  mutation — `Fabric.guard` is a required interface field — so the capture as specified
  demonstrates redundancy with the type-checker, not coverage beyond it. The `missing:`
  entry this whole task exists to close is specifically about the edit that *removes both
  together*, which the plan's chosen mutation does not exercise.
- **Fix:** A second mutation on the same authorised file, reverting the driver to bare
  `submitJob` with the manifest read removed. `tsc --noEmit` exits 0 under it and the full
  suite reports exactly one failure. Both mutations are captured above; neither is
  presented as the other.
- **Files modified:** `packages/node/src/bin/bench.ts` (mutated and reverted; no lasting
  change, nothing staged)
- **Verification:** `git status --short` empty over the whole tree afterwards; `tsc` exit 0;
  full suite 124/1798 green.
- **Committed in:** no commit — a mutation leaves no lasting change by design.

---

**Total deviations:** 1 auto-fixed (1 missing-functionality, in the evidence rather than in
the code).

**Impact on plan:** None on scope. Every `<action>` in all three tasks was executed as
written, including the mutation the plan named — the second one is additional evidence, not
a substitution. Nothing forbidden was added, `.planning/STATE.md` was not touched, and
`.planning/ROADMAP.md` was edited only inside its Phase 19 block.

## Issues Encountered

**Nothing red that this plan did not deliberately create.** The suite was 123/1792 green at
this plan's start and is 124/1798 green now. The only red readings anywhere in this plan are
the two mutation runs, both intended and both reverted.

**`13-VERIFICATION.md`'s mutation 4 is not reproducible exactly as written**, and the reason
is recorded above: `submitJob` lives in `@o2/core`, so a call-site-only revert produces an
unresolved-import error rather than the missing-`manifests` error the report shows. The
report's *conclusion* is correct and is now measured — the removal that keeps the tree
type-clean is the both-together one — but its mutation as described would not compile.

**One pre-existing defect found and deliberately not fixed.**
`.planning/phases/phase-13-egress-manifest-completeness/13-07-SUMMARY.md` ends with two
stray lines, `</content>` and `</invoke>`, committed in `473fb89`. It is cosmetic, it
belongs to another plan, and this is a shared working tree — this plan's files list does not
include it and nothing here stages it. Flagged for whoever owns that file.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no
schema at a trust boundary. `bench-egress.node.test.ts` reads exactly one file, at a path
constructed from `import.meta.url`, and writes nothing.

## Next Phase Readiness

- **Every `missing:` entry in `13-VERIFICATION.md` is now closed or explicitly superseded.**
  Criterion 1's three: the spawned-process proof (13-05), the fail-or-record decision
  (recorded as the ROADMAP amendment and now restated in the ledger), and the honest
  granularity statement (this plan, in both the DATA-05 checklist comment and its
  traceability row). Criterion 2's two: the cross-process retrieval path (superseded by the
  amendment, and named as a future item rather than dropped) and automated coverage for
  `bin/bench.ts`'s egress leg (this plan, watched failing). Criterion 3's one: superseded
  by the amendment, which moved the pushdown claim to `encodeCanonical` where Phase 12
  already proved it.
- **Phase 19 inherits two written constraints rather than two summary paragraphs.** A
  planner reaching VER-08/09 will find, in the roadmap entry itself, that criterion 2
  presumes the owner has already placed the input on both nodes — and, in `PROJECT.md`'s
  Key Decisions, the ruling and the mechanism that enforces it.
- **WIRE-03 now has a behavior to exercise, not only a composition to inspect.** The
  browser tier's refusal branch is compiled and never executed anywhere; that is stated in
  the Phase 19 block.
- **Not claimed by this plan.** That `bin/bench.ts`'s egress leg *works* — this guard reads
  its source and asserts the call sites are written down. It runs no benchmark and observes
  no frame, its own header says so in those words, and a green result here should never be
  read as a measurement. The behavioural reading remains what `13-VERIFICATION.md`'s own
  spot-check produced by running the binary (287 / 171 frames), which is a human act.
- **Whether Phase 13 is met is the next verification pass's call.** The milestone checkbox
  at `.planning/ROADMAP.md:51` is deliberately still un-checked, and no plan in this phase
  ticked it.

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-28*

## Self-Check: PASSED

`packages/node/src/bench-egress.node.test.ts` verified present on disk. All three task
commit hashes (`cf68a85`, `d5a3b1b`, `895f96b`) verified present in `git log`.
`packages/node/src/bin/bench.ts` verified clean after both mutation reverts, with
`git status --short` empty over the whole tree at that point. `vocabulary.node.test.ts` and
`purity.node.test.ts` re-run with this summary staged and therefore inside the scan's own
jurisdiction: **38/38 passing**, including the dead-exemption check.

`.planning/STATE.md` was not touched by this plan. `.planning/ROADMAP.md` was touched only
inside its Phase 19 block, confirmed by the single-hunk `git diff` reproduced above.
