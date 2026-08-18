---
phase: 20-single-job-path-ledger-churn-resilience
verified: 2026-08-05T10:50:46Z
head: 8616049
branch: feature/phase-18-discovery-capacity-placement
amended: 2026-08-18T09:20:00Z # criterion 7 CLOSED by building the missing subject; see the AMENDMENT at the end of this file
status: passed # was `gaps_found`; criterion 7 is MET and no criterion is PARTIAL
score: 7/7 criteria MET (0 PARTIAL, 0 FAILED) — criterion 7 closed 2026-08-18 at `ce97bc8`
original_status: gaps_found
original_score: >-
  6/7 criteria MET, 1 PARTIAL, 0 FAILED. Scored against the seven criteria as they read at
  `.planning/ROADMAP.md` § *Phase 20: Single Job Path, Ledger & Churn Resilience* →
  *Success Criteria*, including criterion 7 as ADDED 2026-08-04 by owner ruling. Criterion 8
  was moved OUT to Phase 24 by the same ruling and is not scored here. Every MET verdict
  rests on an assertion this pass PLANTED AGAINST and WATCHED GO RED — ten plants, each
  restored with `cp` + `cmp` and `git status` confirmed clean after.
verifier: independent goal-backward pass, adversarial stance
overrides_applied: 0
runs: # exit codes read with EXIT=$? on the line immediately after the command, no pipes
  - command: "npx tsc --noEmit"
    exit: 0
    result: "no output"
  - command: "npx vitest run --project node"
    exit: 0
    result: "150 files, 2158 passed | 2 skipped (2160), 249.94 s"
  - command: "npx vitest run --project browser"
    exit: 0
    result: "243 files, 3930 passed, 33.14 s"
  - command: "npx vitest run --project e2e"
    exit: 0
    result: "15 files, 72 passed, 179.81 s"
  - command: "O2_PERF=1 npx vitest run --project perf"
    exit: 0
    result: "1 file, 2 passed, 1.90 s"
  - command: "npx vitest run --project node checkpoint-agents churn-agents speculation-agents late-combine --reporter=verbose"
    exit: 0
    result: "4 files, 10 passed, 10.86 s — the four load-bearing readings captured verbatim, below"
  - command: "npx vitest run --project e2e peer-ledger --reporter=verbose"
    exit: 0
    result: "1 file, 7 passed, 7.69 s"
probes_executed: # every plant re-executed by this verifier, not transcribed
  - id: P1
    criterion: 1
    mutation: "packages/core/src/index.ts — `export function runResilient(): undefined` appended to the barrel"
    command: "npx vitest run --project node packages/core/src/job/submit.test.ts -t 'WIRE-04' --reporter=verbose"
    exit: 1
    result: >-
      1 failed | 7 passed | 89 skipped. `WIRE-04 — the barrel offers exactly one way to run a
      job > exports submitJob and no second job runner beside it`:
      "expected [ 'executeReduce', …(5) ] to strictly equal [ 'executeReduce', …(4) ]"
    restored: "cp + cmp exit 0; git status clean"
  - id: P2
    criterion: 7
    mutation: "packages/core/src/job/submit.ts — `resumeState`'s carry loop short-circuited (`|| true` on the partition guard), so a resume carries nothing"
    command: "npx vitest run --project node checkpoint-agents --reporter=verbose"
    exit: 1
    result: >-
      1 failed. Printed line changed from `resumed [0,0,0,2,2,2]` to `resumed [2,2,2,2,2,2]`;
      the once-in-total reading failed at `expect(resumedDispatches.get(i) ?? 0).toBe(0)` —
      "expected 2 to be +0 // Object.is equality"
    restored: "cp + cmp exit 0; git status clean"
  - id: P3
    criterion: 4
    mutation: "packages/core/src/job/submit.ts — `coverageOf([...owedByOwner.keys()], …)` → `coverageOf([...doneByOwner.keys()], …)`, i.e. the expected set taken from who answered"
    command: "npx vitest run --project node coverage-agents --reporter=verbose"
    exit: 1
    result: >-
      1 failed | 1 passed. `expect(partial.total).toBe(3)` — "expected 2 to be 3". The plant is
      exactly the failure criterion 4 names: a partial aggregate presenting itself as complete.
    restored: "cp + cmp exit 0; git status clean"
  - id: P4
    criterion: 3
    mutation: "packages/core/src/job/submit.ts — `speculationMultiplier: ledger.multiplier` → `speculationMultiplier: 1`"
    command: "npx vitest run --project node speculation-agents --reporter=verbose"
    exit: 1
    result: >-
      1 failed | 5 passed. "expected 1 to be close to 1.4545454545454546, received difference is
      0.4545454545454546, but expected 5e-13". Printed line read `multiplier 1.0000 against the
      off arm's 1.0000` with `spent 10` beside it — the pair that separates "off" from "nothing
      was slow enough" still read correctly, which is why the multiplier is what fails.
    restored: "cp + cmp exit 0; git status clean"
  - id: P5
    criterion: 6
    mutation: "packages/net/src/rpc.ts — `if (entry === undefined) return // late or duplicate reply` → `throw new Error('late or duplicate reply')`"
    command: "npx vitest run --project node late-combine --reporter=verbose"
    exit: 1
    result: >-
      2 failed (both cases). "expected [ 'Error: late or duplicate reply' ] to deeply equal []"
      in MR-04 and in MR-07 — the unhandled-rejection half, which is the "harmlessly" in the
      criterion.
    restored: "cp + cmp exit 0; git status clean"
  - id: P6
    criterion: 2
    mutation: "packages/core/src/lease.ts — `DEFAULT_MAX_GENERATIONS = 3` → `1`"
    command: "npx vitest run --project node churn-agents --reporter=verbose"
    exit: 1
    result: >-
      1 failed. `expect(killed.complete).toBe(true)` — "expected false to be true". Printed line
      changed to `redispatches 0 over 8 shards`, `generations per shard [1,1,1,1,1,1,1,1]`,
      `endings [generations-spent,agreed]`, `gross fuel 434 against 992`.
    restored: "cp + cmp exit 0; git status clean"
  - id: P7
    criterion: 5
    mutation: "packages/node/src/fabric-node.ts — `ownStartLedger`'s `held.record(outcome)` removed, i.e. the Node tier stops filing its own row"
    command: "npx vitest run --project e2e peer-ledger --reporter=verbose"
    exit: 1
    result: >-
      2 failed | 5 passed. "expected [ 'chromium', 'chromium 151', …(2) ] to include 'other'" —
      the cross-tier reading. This is the observed text BROW-02's row records as never captured.
    restored: "cp + cmp exit 0; git status clean"
  - id: P8
    criterion: 5
    mutation: "packages/browser/src/browser-node.ts — `ownStartLedger`'s `held.record(outcome)` removed, i.e. a tab stops filing its own row"
    command: "npx vitest run --project e2e peer-ledger --reporter=verbose"
    exit: 1
    result: >-
      4 failed | 3 passed. "expected [ 'chromium 151', 'other' ] to deeply equal ArrayContaining
      [\"firefox 153\"]" and "expected 2 to be greater than or equal to 4". A chromium tab's
      screen collapsed to its own row plus the relay's. This verifier predicted this plant would
      stay GREEN (reasoning that peers publish to each other) and the measurement refuted the
      prediction — recorded because plausibility is not attribution.
    restored: "cp + cmp exit 0; git status clean"
  - id: P9
    criterion: 1
    mutation: "packages/core/src/job/submit.ts — `probeHolder` returns `false` unconditionally, so no renewal is ever granted"
    command: "npx vitest run --project node packages/core/src/job/submit.test.ts -t 'renews a lease only against evidence' --reporter=verbose"
    exit: 1
    result: "1 failed | 96 skipped. \"expected 'insufficient' to be 'agreed'\""
    restored: "cp + cmp exit 0; git status clean"
  - id: P10
    criterion: 1
    mutation: "packages/core/src/job/submit.ts — `probeHolder` returns `probe !== null`, i.e. renewal on a timer rather than on evidence"
    command: "npx vitest run --project node packages/core/src/job/submit.test.ts -t 'renews a lease only against evidence' --reporter=verbose"
    exit: 1
    result: >-
      1 failed | 96 skipped. "the lease clock passed 300000ms of virtual time — this dispatch is
      not bounded by its lease". The fixture's virtual-clock horizon is what turns a
      non-terminating run into a named failure; W5's recorded reading, re-executed.
    restored: "cp + cmp exit 0; git status clean"
gaps:
  - criterion: 7
    status: partial
    truth: >-
      A coordinator writes a checkpoint during a live job run through `bin/agent.ts`, and a
      SECOND requestor — given nothing but that checkpoint's CID — finishes only the outstanding
      shards and returns the same answer the first would have
    reason: >-
      The second-requestor half is fully delivered and PROVED FALSIFIABLE (P2): six spawned
      `bin/agent.ts` agents, a first requestor that departs, a second `FabricNode` with a
      different peer id given the spec and one CID, running only [3,4,5] with CIDs equal to an
      uninterrupted control. What is NOT delivered is the first clause's subject. `submitJob`
      writes a checkpoint only when the caller supplies `SubmitOptions.checkpoints`, the field is
      optional, and NO production submitter supplies it — so the only coordinator in this
      repository that writes a checkpoint is a test's. Measured, not inferred:
      `grep -rn "checkpoints:" --include='*.ts' packages tools` returns 15 lines and the only two
      outside a `.test.ts` are inside `submit.ts` itself (that field's own docblock, and the
      internal `const checkpoints: CheckpointLog =`). `npx tsc --noEmit` exits 0 with all four
      production submitters omitting it. A capability reachable from no runnable entry point is
      the defect class this milestone exists to remove (Phase 22's goal states it), so scoring
      this MET would be widening what counts as passing.
    artifacts:
      - path: "packages/core/src/job/submit.ts"
        issue: >-
          `SubmitOptions.checkpoints` — search `readonly checkpoints?: CheckpointSink`. Its own
          docblock records the hole and names the guard it did not write: *"The equivalent guard
          for this one is named in this plan's summary and belongs to whoever owns that file
          next; it is not written here because this plan does not own that file."*
      - path: "packages/node/src/bin/bench.ts"
        issue: "submits jobs and passes no `checkpoints` sink"
      - path: "packages/browser/demo/main.ts"
        issue: "two submitters, neither passes a `checkpoints` sink"
      - path: "packages/core/src/executor/task-worker.ts"
        issue: "submits into a `MemoryBlockstore`; the source argues correctly that a sink here would be a falsehood"
      - path: "packages/bench/src/perf-workload.ts"
        issue: "submits jobs and passes no `checkpoints` sink"
      - path: "packages/node/src/sovereign-block-refusal.node.test.ts"
        issue: >-
          the precedent guard — it pins the set of files allowed to pass `SubmitOptions.sovereignCids`.
          No equivalent exists for `checkpoints`, so the omission is unguarded in both directions.
    missing:
      - >-
        One production submitter that writes checkpoints on a path an operator can run — the
        natural candidate is `bin/bench.ts`, which already holds the only production `admit` and
        already opens an `FsBlockstore`.
      - >-
        A call-site guard pinning which files may pass `SubmitOptions.checkpoints`, in
        `sovereign-block-refusal.node.test.ts`'s shape, so the wiring cannot be silently reverted.
      - >-
        OR an owner ruling that criterion 7's first clause is satisfied by the production
        `writeCheckpoint`/`checkpointOf` path running under a test-supplied sink across real
        `bin/agent.ts` processes — in which case the criterion moves to MET at 7/7 and CHURN-03
        stays Partial on the wiring alone. RULING A forbids taking this route silently.
human_verification:
  - test: >-
      Decide whether criterion 7 may be marked MET at HEAD, or whether Phase 20 closes at 6/7
      with the checkpoint sink's wiring carried.
    expected: >-
      A ruling, not a finding. Two readings of the criterion's first clause are both defensible
      and both are set out in the criterion-7 section below. The measured facts are not in
      dispute: the recovery half is delivered and falsifiable across six real processes, and the
      write half runs on a sink no shipped entry point supplies. Only the owner may choose which
      reading governs.
    why_human: >-
      This is the same class of judgement Phase 18 and Phase 19 escalated (a criterion whose
      mechanism is real but whose reachability is one step short), and both verifiers recorded
      that a verifier may not apply or waive RULING A for itself.
warnings:
  - id: W1
    status: NEW 2026-08-05, MEASURED — a comment that reads like evidence and names a file that does not exist
    where: "packages/core/src/index.ts, the WIRE-04 comment block above the `discovery.ts` exports"
    what: >-
      *"`job-entry-point.test.ts` holds that as a check rather than as this comment."* **No file
      of that name exists anywhere in the repository** — `find . -name 'job-entry-point*'` returns
      nothing and the string occurs on exactly that one line in the whole tree. The guard is real
      and I proved it can fail (P1), but it lives in `packages/core/src/job/submit.test.ts` under
      `describe('WIRE-04 — the barrel offers exactly one way to run a job')`. A reader who follows
      the citation finds nothing and has to decide whether the guard exists at all. This is the
      class this repository treats as serious: three of ten recently-closed defects had their
      false claim sitting in a comment that read like evidence.
  - id: W2
    status: NEW 2026-08-05, MEASURED — the WIRE-04 guard's scope is one barrel, and its docblock does not say which
    where: "packages/core/src/job/submit.test.ts › `describe('WIRE-04 — the barrel offers exactly one way to run a job')`; packages/net/src/index.ts"
    what: >-
      The guard imports `../index.ts` — `@o2/core`'s barrel — and pins the set
      `['executeReduce','executeVerified','runTask','runTaskAndPost','submitJob']`. `@o2/net`'s
      barrel exports `submitJobWithEgress`, whose name **matches the guard's own `JOB_SHAPED`
      pattern** `/^(run|submit|execute|dispatch|perform)[A-Z]/`, and `reduceJob`. Neither is
      covered by any guard and neither appears in any allow-list. WIRE-04's substance still holds
      — I checked both by reading rather than by assuming: `submitJobWithEgress` calls the one
      entry point (`packages/net/src/submit-with-egress.ts`, search
      `const result = await submitJob(spec, blockstore, options)`) and `reduceJob` takes a
      `JobResult` and calls `executeReduce` — so neither is a second implementation. But a second
      job path added to `@o2/net` would pass this guard, and the guard's title
      (*"the barrel offers exactly one way to run a job"*) does not name which barrel.
  - id: W3
    status: NEW 2026-08-05, MEASURED — the published cost column cannot distinguish two states
    where: "packages/node/src/bin/bench.ts, search `speculationMultiplier: result.ok ?`; packages/bench/src/harness.ts, search `speculationTax`"
    what: >-
      `Observation` carries `speculationMultiplier` and `redispatches` and **not**
      `speculationSpent`, so on the operator's printed `spec. tax` column a `1.00` reads
      identically for "speculation duplicated nothing" and "speculation was off". The source says
      this against its own interest at the call site (*"A run in which nothing straggled still
      prints 1.00, and that is now a measurement rather than the identity"*). Compounding it:
      `SHARDS = 16` in `bin/bench.ts` and `DEFAULT_SPECULATION_FRACTION = 0.1`
      (`packages/core/src/speculation.ts`), so a `--quick` rung's allowance is
      `floor(16 × 0.1) = 1`, the rungs' workload is uniform, and nothing is expected to clear
      `DEFAULT_STRAGGLER_FACTOR` (1.5) × median. **No benchmark rung can straggle.** Criterion 3's
      reading is the live one across seven spawned processes and is unaffected; this is a limit on
      the published surface and is not scored as met.
  - id: W4
    status: CONFIRMED 2026-08-05 — task #49, unmet, correctly declared, not scored as met
    where: "packages/core/src/job/verify.ts, search `status: 'agreed'`; packages/node/src/discovery-agents.node.test.ts, the block headed *What survives of the refusal*"
    what: >-
      `VerificationResult`'s `agreed` arm declares **no `failures` field**, and
      `mergeVerifications` folds a failed generation into a later agreement by keeping the winner.
      So a re-picked shard that succeeds erases the exec-stage refusal that caused the re-pick.
      20-04's own must-have on this is NOT met and the landed test says so in its own words
      (*"It erases half of it, and the half it erases is the over-committed text"*), routing the
      reading to the lease history instead of asserting a field the union does not have. That is
      the correct move — asserting a `failures` entry there would have been asserting a field that
      does not exist — and it is recorded here so nobody reads criterion 1's MET as covering it.
  - id: W5
    status: CONFIRMED 2026-08-05 — task #58
    where: "packages/node/src/bin/agent.ts, search `startReporting: 'reports-its-own-start'`"
    what: >-
      The literal is hardcoded; there is no `--withholds-start-report` flag and no argv path to
      `'withholds-its-own-start'`. A tab visitor can decline (measured — `peer-ledger.e2e.test.ts`
      › *a declining visitor's row reaches no peer and no screen (BROW-01)*, and the DECLINING tab
      is asserted absent from every screen) and an operator of a `bin/agent.ts` node cannot. BROW-01's
      consent is therefore a browser-tier-only control on the one runnable Node entry point.
  - id: W6
    status: CONFIRMED 2026-08-05 — declared in the source, and criterion 4 does not rest on it
    where: "packages/core/src/coverage.ts (`unexpected`); packages/core/src/job/submit.ts (`JobResult.coverage` docblock and the `owedByOwner`/`doneByOwner` block)"
    what: >-
      `CoverageReport.unexpected` has **no reachable reading**: both sets are derived from
      `spec.shards[i].ownerId` through one map, so the contributed set is a subset of the expected
      one by construction. The source says exactly this and names what would make it reachable.
      And `landedForItsOwner` is `agreed && !disagreed` while `JobResult.complete` additionally
      requires `!degraded`, so **`complete === true` implies `coverage.complete === true`** and
      "complete but not fully covered" is not constructible; the converse IS (a degraded-but-agreed
      shard gives `complete: false` with full coverage). Both directions are written out in
      `JobResult.coverage`'s docblock. Criterion 4's reading does not depend on the unreachable
      direction — the direction it does depend on is the denominator, which I planted against (P3)
      and watched fail.
  - id: W7
    status: CLOSED BY THIS PASS — the record 20-06 did not deliver
    where: ".planning/ROADMAP.md Phase 20 plan line 20-06; .planning/REQUIREMENTS.md BROW-02 row"
    what: >-
      The roadmap's own plan line says 20-06 *"delivered no plant record, no span and no exit
      code"*, and BROW-02's row says the mutation-ledger entry its note asks for *"is deliberately
      absent because the observed text was never captured."* This pass captured it twice — P7
      (Node tier, `expected [ 'chromium', 'chromium 151', …(2) ] to include 'other'`, 2 failed |
      5 passed) and P8 (browser tier, `expected [ 'chromium 151', 'other' ] to deeply equal
      ArrayContaining ["firefox 153"]`, 4 failed | 3 passed), both against
      `npx vitest run --project e2e peer-ledger`. A ledger entry can now be written; this
      verification does not write one, because a verifier does not edit the tree.
  - id: W8
    status: NOTED — scope of this pass
    where: "packages/node/src/mutation-ledger.ts (113 entries), packages/node/src/mutation-guard.node.test.ts"
    what: >-
      20-13 reports twenty-seven plants re-executed. This pass re-executed **ten** plants of its
      own choosing (P1–P10), targeting each criterion's load-bearing assertion directly rather
      than re-running the ledger. The other ledger entries were not re-executed here;
      `mutation-guard.node.test.ts` passed inside the green whole-tree node run, which checks the
      ledger's *structure* (a signature declared `rendered-at-runtime` must not be greppable in
      its own catcher, no placeholder reasons) and not that each mutation still reddens.
---

# Phase 20: Single Job Path, Ledger & Churn Resilience — Verification Report

**Phase goal:** `submitJob` becomes the one job path — lease renewal, speculation, and coverage
accounting live inside it, not in a second uncalled implementation — and the peer ledger records
real cross-node outcomes instead of discarding them

**Verified:** 2026-08-05T10:50:46Z at HEAD `8616049`, branch
`feature/phase-18-discovery-capacity-placement`, tree clean before and after
**Status:** gaps_found
**Score: 6/7 criteria MET, 1 PARTIAL, 0 FAILED**

Scored against the criteria as they read at `.planning/ROADMAP.md` § *Phase 20* →
*Success Criteria*, criteria 1–7. Criterion 7 was ADDED 2026-08-04 by owner ruling and is scored.
Criterion 8 was moved OUT to Phase 24 by the same ruling and is **not** scored here.

**No claim in any of the thirteen summaries is accepted as evidence.** Every verdict below rests
on source re-derived at HEAD plus a command whose exit code this pass read directly, and every MET
verdict rests on an assertion this pass **planted against and watched go red**.

---

## Criterion scores

| # | Criterion | Score | The assertion that carries it, proved falsifiable |
|---|---|---|---|
| 1 | `submitJob` is the only function a caller uses to run a job through `bin/agent.ts` — lease renewal, speculation, coverage accounting internally; `runResilient` no longer exists | **MET** | P1, P9, P10 |
| 2 | Killing 30 % of participating node processes mid-job still produces the correct final result, with re-dispatches visible in the job's history output | **MET** | P6 |
| 3 | A straggler task is duplicated speculatively during a live run, the first correct result wins, and the reported cost accounting includes the speculation multiplier | **MET** | P4 |
| 4 | A cross-owner job with some owners' nodes offline returns a coverage report (`covered: X/Y`) alongside its result, rather than presenting a silently partial aggregate as complete | **MET** | P3 |
| 5 | The browser demo's peer activity ledger, across two or more connected tabs, shows merged counts contributed by every connected peer — not zero | **MET** | P7, P8 |
| 6 | A combine result arriving from a recovered node *after* `executeReduce` collected its `wanted` replicas is received and discarded harmlessly | **MET** | P5 |
| 7 | A coordinator writes a checkpoint during a live job run through `bin/agent.ts`, and a SECOND requestor — given nothing but that CID — finishes only the outstanding shards and returns the same answer | **PARTIAL** | P2 carries the recovery half; the write half runs on a sink no production submitter supplies |

---

## Criterion 1 — MET

**`runResilient` does not exist.** Re-derived, not accepted: `packages/core/src/coordinator.ts` is
absent from the tree, and `grep -rn "export function runResilient\|export async function
runResilient\|const runResilient"` over `packages tools` returns **nothing** (exit 1). Every
surviving occurrence of the name is prose — four docblocks and the deletion accounting.

**The guard reads the namespace and it can fail (P1).** `packages/core/src/job/submit.test.ts` ›
*WIRE-04 — the barrel offers exactly one way to run a job* imports `../index.ts` as a namespace,
filters `Object.keys` by `/^(run|submit|execute|dispatch|perform)[A-Z]/` and `typeof === 'function'`,
and pins the result as a **set equality** against
`['executeReduce','executeVerified','runTask','runTaskAndPost','submitJob']`. Reading the namespace
rather than the source is load-bearing here, because the barrel's own comment block names
`runResilient` twice in prose and a text scan would match it. I appended a real
`export function runResilient()` to `packages/core/src/index.ts` and the case went red:
`expected [ 'executeReduce', …(5) ] to strictly equal [ 'executeReduce', …(4) ]`, exit 1.

**The finding behind the fix is confirmed, and it is larger than the fix.** The guard's own header
records that the whole suite was green with `runResilient` exported beside `submitJob` for thirteen
phases, and nothing anywhere read the barrel and objected. That is WIRE-04's own failure mode
having been invisible to the entire test suite.

**Lease renewal is BUILT and is the first production caller of all three symbols.**
`packages/core/src/job/submit.ts` imports `DEFAULT_MAX_GENERATIONS, LeaseTable, RENEW_AT,
shouldRenew` from `../lease.ts` (search the import line), constructs the only production `LeaseTable`
(search `new LeaseTable({ maxGenerations: DEFAULT_MAX_GENERATIONS })`), and `dispatchUnderLease`
computes its renewal point **backwards from the deadline** — `lease.expiresAt - leases.leaseMs *
(1 - RENEW_AT)` — with `shouldRenew` as the authority. The evidence channel is the one the owner
ruling named: `capacitySlotKey(inputCid, partitionIndex)` transcribed from `serveAgent`'s exec branch,
compared for **equality** against `inFlightRefusal(slotKey)` — never sniffed as a substring — and a
probe that throws returns `false`, because *"silence with extra steps is still silence"*.

Both directions of that reading fail when planted:

- **P9** — `probeHolder` always `false` (no evidence ever found): `expected 'insufficient' to be
  'agreed'`.
- **P10** — `probeHolder` always `true` where a probe exists (a timer wearing a lease's clothes):
  `the lease clock passed 300000ms of virtual time — this dispatch is not bounded by its lease`.
  The fixture gives its virtual clock a horizon precisely because an unconditionally-renewed lease
  is a non-terminating run rather than a slow one; the horizon turns a hang into a named failure.

The renewal case is a **single fixture read twice** with one flag (whether the holder is still
there), drives a **real `LocalCapacity`** rather than a stub, asserts `renewed` present and
`expired` absent in one arm and the mirror in the other, and asserts the probe went to the task's
own derived slot key rather than to the placement shard id (`expect(present.slotKey).not.toBe('0')`).
It states its own limit at the end: it cannot say anything about a fabric where `admit` is absent.

**Speculation and coverage are internal.** `submitJob` builds a `ShardSpeculation` per shard from
`SpeculationLedger`/`stragglers`/`speculativeCandidates`, and computes `coverage` from
`owedByOwner`/`doneByOwner` before returning. Both are unconditional on the production path.

**The one asymmetry, and it is a stated behaviour rather than a default.** Renewal is available only
where `spec.admit` was supplied; where it was not, `probe === null`, `renewable` is false at entry,
and the lease lapses on time. That is exactly what 20-CONTEXT.md's owner ruling required, it is
written into `JobSpec.admit`'s own doc, and REQUIREMENTS' CHURN-04 row keeps the requirement at
Partial naming it. It does not reduce criterion 1, which asks that `submitJob` perform renewal
internally — it does.

**Recorded limit (W2).** The guard covers `@o2/core`'s barrel only. `@o2/net` exports
`submitJobWithEgress` — which matches the guard's own name pattern — and `reduceJob`. I read both:
`submitJobWithEgress` calls `submitJob` and `reduceJob` consumes a `JobResult`, so neither is a
rival implementation and WIRE-04's substance holds. But neither is guarded.

---

## Criterion 2 — MET

`packages/node/src/churn-agents.node.test.ts`, over **ten spawned `bin/agent.ts` processes**.
Measured this pass, exit 0:

```
[criterion 2 / churn] standUp 4476ms for 10 agents, control 646ms, killed run 295ms;
participants 6/10, killed 3 (30% of the fabric, 50% of the participants);
redispatches 8 over 8 shards against the control's 0; generations per shard [2,2,2,2,2,2,2,2];
endings [agreed]; lease events naming the dead [granted ×7, surrendered ×7];
gross fuel 992 against 992, useful 496 against 496
```

What makes this a reading rather than a count:

- **The control comes first and is an instrument check.** `control.complete`, `control.redispatches
  === 0`, every shard `generations === 1` at `attempted.length === REDUNDANCY`, and a lease history
  containing only grants and completions. A lossy control would make every re-dispatch below
  unattributable.
- **The victims are the adversarial end**, ordered by shards held → shards placed on → node id (a
  total order, not a lucky draw), and each is asserted to have been *placed on* and to have *held a
  lease* before it is killed.
- **The kill is staged one layer down**, in a wrapper around the production `RemoteExecutor`, at the
  first `execute` call — the instant after `submitJob` has placed every shard and before anything is
  dispatched. `signalCode === 'SIGKILL'` and `exitCode === null` are asserted on every victim.
- **"Correct" is an equality against the control in the same run**, per shard by CID and at the job
  level, never a pinned literal — plus `usefulFuel` per shard and `grossFuel` at the job level,
  which a CID equality cannot say.
- **The re-dispatches name the dead.** Every victim is required to appear in the lease history *as a
  loss* (`expired` or `surrendered`), no victim may appear as `completed`, and `abandoned` must be
  empty.

**Falsifiable (P6).** With `DEFAULT_MAX_GENERATIONS` cut to 1 the run reddens at
`expect(killed.complete).toBe(true)` — "expected false to be true" — and the printed line changes to
`redispatches 0`, `generations per shard [1,…]`, `endings [generations-spent,agreed]`,
`gross fuel 434 against 992`.

---

## Criterion 3 — MET

`packages/node/src/speculation-agents.node.test.ts`, over **seven spawned `bin/agent.ts`
processes**, one fixture with an off arm and an on arm. Measured this pass, exit 0:

```
[criterion 3 / speculation] standUp 4460ms for 7 agents, off arm 723ms, on arm 1350ms;
allowance 22 over 22 shards (the shipped fraction would have allowed 2), spent 11;
multiplier 1.5000 against the off arm's 1.0000; redispatches 0 against 0;
dispatches 33 against 22 shards; frozen worker held 9 public shard(s);
median healthy dispatch 22ms over 20 samples, straggler threshold 32ms;
frozen public shard 710ms, paired-owner shard 696ms, solo-owner shard 699ms;
compare grace 657ms; losing copies [agreed ×11]
```

**The "multiplier 1 has two causes" trap is handled, and handled everywhere it arises.**

- On the **off arm** the file asserts the pair, not the number: `speculationMultiplier === 1`
  **and** `speculationSpent === 0`, with the comment stating that a multiplier of 1 is also what an
  idle job reports.
- On the **on arm**, `speculationSpent === duplicates.length` (the wrapper's own independent count),
  `speculationSpent < ALLOWANCE`, `multiplier ≈ (SHARDS + duplicates)/SHARDS` to 12 places, and the
  same fact counted a third way off `attempted` totals.
- For **CHURN-06's negative arm** — the solo owner's shard, which was NOT duplicated — the file
  excludes both alternative explanations by measurement rather than by argument:
  `expect(durationOf(soloCall)).toBeGreaterThan(stragglerThresholdMs)` against a median measured in
  that same arm ("nothing was slow enough" excluded), and `speculationSpent < ALLOWANCE` ("the
  budget was gone" excluded). What remains is that there was nowhere legal to duplicate to, which is
  the requirement.
- The fixture asserts its own premises: `ALLOWANCE === SHARDS` and `DEFAULT_ALLOWANCE < SHARDS`, so
  the shipped fraction's inability to speculate at this size is written into the test rather than
  discovered later.

**A straggler, not a refusal.** `on.redispatches === 0`, no `expired`/`surrendered`/`abandoned`
lease events, no rejections, `generations === 1` on every shard. Without these the file could be
re-measuring criterion 2. The file states honestly that these four lines have no plant that reddens
them while everything above stays green, and explains why that is structural.

**The loser is read.** Each duplicated shard carries exactly one `copies` entry whose outcome is one
of `agreed`/`failed`/`uncompared`, with `disagreed` excluded separately, and exactly the duplicated
partitions carry copies.

**The published surface reads the job.** `bin/bench.ts` and `perf-workload.ts` both read
`result.job.speculationMultiplier` and `result.job.redispatches`; the BENCH-03 block scans both real
sources with comments stripped and proves each requirement reportable in isolation (5 cases, all
green). Both were literals until 20-09.

**Falsifiable (P4).** `speculationMultiplier: ledger.multiplier` → `1` reddens at
`expected 1 to be close to 1.4545454545454546`.

**Limit, not scored as met (W3).** `speculationSpent` is not on `Observation`, so the operator's
printed `spec. tax` column cannot distinguish "off" from "nothing straggled"; and with
`SHARDS = 16` against a 0.1 fraction, no `--quick` rung can straggle at all.

---

## Criterion 4 — MET

`packages/node/src/coverage-agents.node.test.ts`, over spawned `bin/agent.ts` processes, three arms
of **one closure** whose only varying arguments are the discovered candidate set and one integer.
Measured this pass, exit 0, printed to stdout on every run:

```
[criterion 4 / coverage] control covered: 3/3 owners — complete
                         stopped covered: 2/3 owners — PARTIAL (missing ca57eed3…)
                         thinned covered: 1/3 owners — PARTIAL (missing c2865549…, ca57eed3…)
                         shards agreed 4 → 3 → 2 of 4; offers to the two-shard owner 2 → 2 → 1
```

- **The control is an instrument check**: `providersPerShard === [1,1,1,1]`, three descriptors, each
  `canExecuteSovereign` with a real certificate, and every shard `agreed`. A job whose shards cannot
  run reports missing owners for reasons unrelated to anybody being offline.
- **The owner really is dead before anything is submitted**: `stopAgentNow(spar)` then
  `isDead(spar)`, then the requestor is polled until it drops the peer. The file records, against
  its own interest, that deleting the poll leaves the file green and that **what carries the reading
  is the stop** — planting the stop's removal takes the arm to `expected 3 to be 2`.
- **The answer is asserted beside the denominator**, because either alone is half a reading:
  `stopped.ok`, three shards `agreed`, `partial.covered === 2`, `partial.total === 3`,
  `partial.missing === [SPAR]` (named from the fixture's own seed, never read back out of the result
  it is checking), `partial.complete === false`, and criterion 4's literal string
  `covered: 2/3` taken off `describeCoverage` rather than transcribed.
- **Arm 3 is the owed-against-done gate** and it is the only arm that carries it: one owner is
  present and answering, states room for one of its two shards, and reads `1` where a first-shard
  rule would read `2`. The held-back shard's `ending` is `never-placed` with no rejections — *"a node
  held back here was never asked, so it never refused"*.
- **The public-job half**: `bin/bench.ts` prints no `PARTIAL` on any rung because a public job
  carries the named union `'defines-no-owners'`. That is the decision 20-CONTEXT.md predicted would
  be got wrong, and it was not.

**Falsifiable (P3).** Taking the expected owner set from `doneByOwner` instead of `owedByOwner` —
i.e. presenting a partial aggregate as complete over whoever answered — reddens at
`expect(partial.total).toBe(3)`, "expected 2 to be 3".

**Declared limits (W6).** `unexpected` has no reachable reading and the source says so;
`complete === true ⟹ coverage.complete === true` by construction and the source says that too. The
converse fails, which is what makes the pair carry information. Criterion 4's reading does not rest
on either unreachable direction.

---

## Criterion 5 — MET

`packages/node/src/peer-ledger.e2e.test.ts`, five isolated browser contexts across **three engines**
(chromium 151, firefox 153, safari 26) plus a coarsened tab (`chromium`, no version) and a declining
tab (`edge 120`), against a locally-started relay and a dumb file server over the built bundle. Run
this pass at exit 0, and inside the full `--project e2e` run at exit 0.

**The load-bearing reading is a foreign family, not a count — exactly as 20-CONTEXT.md required.**
The file says so about itself: *"`reported > 1` is satisfiable with no merge at all… it is not what
carries the claim."* What it asserts instead:

- On chromium's **screen** and on firefox's, tally rows for the other two engines' families, plus
  `'other'` — the Node tier's label, which no browser tab has an expression to produce.
- The three reading engines are asserted to have composed three **different** families and each to
  carry a version, so a foreign-family assertion cannot be satisfied by a tab's own row and cannot
  collide with the coarsened tab's bare `chromium`.
- The coarsened tab's bare `chromium` is unique in the fixture and appears on **every other tab's**
  screen — one source only: that tab answered with it over WebRTC.
- Preconditions asserted rather than claimed: every tab holds every other tab (membership, not a
  count), no tab holds itself, every tab holds the relay, five distinct peer ids, and the relay's own
  reservation count ≥ 5. **No `window.o2.dial` anywhere.**
- The `unreliable` small-sample marker is asserted **present** rather than worked around, and the
  object and the screen are cross-checked against each other.
- BROW-01's negative arm: the declining tab's `edge 120` reaches no peer's ledger and no screen,
  while that tab still sees the merged view.

**Falsifiable, twice, and this is the record 20-06 did not deliver (W7):**

- **P7** — Node tier: removing `held.record(outcome)` from `fabric-node.ts`'s `ownStartLedger`
  reddens 2 of 7 with `expected [ 'chromium', 'chromium 151', …(2) ] to include 'other'`. The relay
  never calls `publishStartOutcome`, so its own row is the only way `'other'` can reach a tab — this
  is the cross-tier half.
- **P8** — browser tier: removing the same line from `browser-node.ts` reddens **4 of 7**, collapsing
  a chromium tab's screen to `[ 'chromium 151', 'other' ]`. I predicted this plant would stay green
  (reasoning that peers publish to one another) and the measurement refuted the prediction. Recorded
  because a theory whose arithmetic fits is not the theory's proof.

**The wiring is real at both factories.** `fabric-node.ts` and `browser-node.ts` each build a
`StartOutcomeLedger` through a byte-identical `ownStartLedger`, record their own row at
construction, and pass `ledger: startLedger` to `serveAgent`. `'keeps-no-ledger'` occurs **zero**
times in either factory. The four surviving `'keeps-no-ledger'` sites are `bin/bench.ts` ×2 and
`perf-workload.ts` ×2, and `serve-agent-hooks.node.test.ts` pins them at 2 each with the reason
written out at the pin: these are in-process measurement fixtures on a `MemoryNetwork`, not nodes, and
a `started` row per endpoint would be manufactured population in a metric whose whole value is that
its `n` is real. It also states the honest converse — *"the published benchmark numbers say nothing
about BROW-02"*.

**Limit (W5).** `bin/agent.ts` hardcodes `startReporting: 'reports-its-own-start'`; an operator
cannot decline what a tab visitor can.

---

## Criterion 6 — MET

`packages/node/src/late-combine.node.test.ts`, two cases over spawned `bin/agent.ts` processes.
Measured this pass, exit 0:

```
[criterion 6 / arrival] cold combines [49,56,61,98,165,211]ms floor 49ms first 61ms spread 4.34×,
paused dispatch 1501ms against rpcTimeoutMs 1500, pause 1815ms,
late replies 1 at +166ms, frames from the paused peer [req,req,req,req,res]

[criterion 6 / harmlessness] tree 3 combines, paused peer asked 2×, late replies 2 at +163,163ms,
recomputes 2 against 0 unpaused
```

**The unverified thing 20-CONTEXT.md flagged was measured and it holds**: a libp2p stream *does*
survive SIGSTOP long enough for the reply to arrive after SIGCONT. The `res` frame arrives 166 ms
after the requestor had already timed out. The fallback arm was not needed.

- **Received**: non-zero late replies in a window that begins when `executeReduce` returned, one per
  request left outstanding — no reply the test did not provoke and none of the outstanding ones lost.
  Every frame the paused peer ever sent arrived after the resume, and its four `req` frames (its own
  block fetches for partials it had never seen) are independent evidence the combine request crossed
  the pause rather than being re-sent.
- **Unsolicited by construction**: the wrapper is the only thing `executeReduce` dispatches through
  and it cannot run after `executeReduce` returned; `asked.filter(atMs > reduceReturnedAt)` is
  asserted empty, and each outstanding request was a distinct combine.
- **Discarded harmlessly**: `rootCid` equal to an unpaused run of the identical tree **in the same
  run**; the recovered peer executed nothing; `minReplicas`, `combines` and `disagreements` identical;
  and `recomputes` strictly greater than the unpaused run's, which is what separates "this run lost a
  node" from "this run was ordinary".
- **Alive and would have answered**, compared against what the production combiner computes, so
  answering with *something* does not pass.
- **No unhandled rejection** — the half most easily missed, since `#receive` is invoked as
  `void this.#receive(...)`.

**Falsifiable (P5).** Replacing `rpc.ts`'s `if (entry === undefined) return` with a `throw` reddens
**both** cases: `expected [ 'Error: late or duplicate reply' ] to deeply equal []`.

The timing budgets are ratios sited inside the run — `RPC_TIMEOUT_MS > healthyCombineMs ×
TIMEOUT_MARGIN` off the **floor** of six cold samples, not the first — with the reason for the floor
recorded in the file's own header.

---

## Criterion 7 — PARTIAL

`packages/node/src/checkpoint-agents.node.test.ts`, six spawned `bin/agent.ts` agents plus two
in-process requestors, only one alive at a time. Measured this pass, exit 0:

```
[CHURN-03 / checkpoint] standUp 3887ms for 6 agents, control 545ms,
departed run reached its pause after 384ms and unwound by 546ms, resumed run 99ms;
the checkpoint named [0,1,2] and the resume ran [3,4,5];
the departed requestor agreed 3 of 6 shards;
dispatches per partition — control [2,2,2,2,2,2], departed [2,2,2,2,2,2], resumed [0,0,0,2,2,2]
```

### What is MET, and it is the larger half

**The load-bearing reading is the dispatch count spanning both requestors, and it is exactly right
that it has to be.** A resume and a restart give the same answer, so no assertion about the answer
can tell them apart, and the second requestor's own result cannot see what the first dispatched. So
the counter sits in a wrapper around the *production* `RemoteExecutor`, one map per run, and the
claim is: for every partition the checkpoint names, the second requestor dispatched it **zero**
times and the total across both equals what the first spent alone. `resumed [0,0,0,2,2,2]` against
`departed [2,2,2,2,2,2]`, with the control's `[2,2,2,2,2,2]` as the instrument check.

**Falsifiable (P2).** Short-circuiting `resumeState`'s carry loop so a resume carries nothing turns
the printed line into `resumed [2,2,2,2,2,2]` and reddens at
`expect(resumedDispatches.get(i) ?? 0).toBe(0)` — "expected 2 to be +0". Exit 1.

Everything else the criterion names is present and is a genuine reading:

- **A different process-level identity**: its own `FabricNode`, its own peer id (`expect(second.peerId)
  .not.toBe(first.peerId)`), dialled after the first was stopped, inheriting no in-memory state and
  not even a live blockstore handle — the directory is re-opened as a fresh `FsBlockstore`.
- **The first requestor really departed**, read as a binary: dialling a peer it is already connected
  to resolves on a live node and rejects on a stopped one. The file records that this **replaced an
  assertion that could not fail** — a probe that dispatched a task and required `ok: false`, which is
  also what a live endpoint returns; found by planting, twice. That is one of the un-failable
  assertions this phase's executors caught in their own plans, and it was fixed.
- **The departure is mid-job rather than mid-record**: three partitions are held back one layer down,
  so they are *placed and not yet dispatched* when the requestor goes away. The file records that
  without this the departed job reported `complete: true` and the whole hand-off would have been
  measured against a job that had already finished.
- **`carried-from-checkpoint`** is asserted by name on exactly the carried shards with `attempted ===
  []`, because `generations: 0` reads identically on a shard nobody would take.
- **The answer**: `cidsOf(resumed.job)` equals the control's, per shard, in the same run.
- **A bad CID is refused by name on the production path** — `checkpoint-unreadable` /
  `malformed` / field `jobId`, with `refusedDispatches.size === 0`.
- **What it cannot redden on is listed**, including one entry that is a genuinely valuable warning:
  because `MODULE_ECHOES_INPUT` is the identity function, a shard's `resultCid` equals its
  `inputCid`, so planting `resultCid: inputCid` into the carried record leaves this file green while
  reddening six kernel cases. That is stated rather than left to be discovered.

The stated wire limit is also correct and I re-derived it: the checkpoint block is not fetched over
the fabric, because `packages/net/src/protocol.ts` has a `block` request that **pulls** and nothing
that pushes or provides. The hand-off cannot survive loss of the departed requestor's disk. The file
says so; it does not fake it.

### What is NOT met

**No coordinator an operator can run writes a checkpoint.** `SubmitOptions.checkpoints` is optional,
and **not one production submitter supplies it**. Measured rather than taken from a summary:

```
grep -rn "checkpoints:" --include='*.ts' packages tools   →  15 lines
  … of which outside a .test.ts:  2, both inside submit.ts itself
      (that field's own docblock, and `const checkpoints: CheckpointLog =`)
```

The four production submitters — `bin/bench.ts`, `demo/main.ts` (×2),
`core/executor/task-worker.ts`, `bench/perf-workload.ts` — all omit it, and `npx tsc --noEmit` exits
**0** with all of them omitting it. The field's own docblock states this against its own interest and
names the guard it did not write: *"The equivalent guard for this one is named in this plan's summary
and belongs to whoever owns that file next; it is not written here because this plan does not own
that file."* No such guard exists — `sovereign-block-refusal.node.test.ts` pins `sovereignCids`'
call-site set; nothing pins `checkpoints`'.

`checkpointChain` and `remainingWork` have no production caller either.

### The two readings, set out so the ruling has something to choose between

**Reading A — MET.** The criterion's own ROADMAP note defines the wiring it asked for: *"`checkpoint.ts`
is complete and imported by nothing — `coordinator.ts` does not even import it. So this is a wiring
criterion, not a build one."* That gap is closed: `submitJob` imports and calls `checkpointOf`,
`writeCheckpoint`, `readCheckpoint` and `recoverCheckpoint` and is their only production caller. In
the measured run a coordinator does write real checkpoints, through production code, across six real
`bin/agent.ts` processes — and every other criterion in this phase accepts an in-process requestor
under the same recorded substitution.

**Reading B — PARTIAL, and this is the verdict taken.** The criterion's subject is *a coordinator
writes a checkpoint during a live job run*, and today the only coordinator in this repository that
writes one is a test's, because the destination is opt-in and nothing opts in. A capability
reachable from no runnable entry point is precisely the defect this milestone exists to remove —
Phase 22's goal states it in those words — and it is the same shape as the finding that WIRE-04 had
gone unheld for thirteen phases. The phase's own REQUIREMENTS row agrees, keeps CHURN-03 at `[ ]`
**Partial**, and names *"the open leg is the wiring"*. Scoring MET here would be widening what counts
as passing, which the standing rule forbids.

**Why the second-requestor half is nonetheless recorded as delivered**: it is measured, it is
falsifiable, and the closure task is small and named. This does not become MET by argument, and it
does not become FAILED either. PARTIAL is the state that is true.

---

## Assertions found that could not fail

**None that the phase did not already declare.** This is worth saying precisely, because the brief
predicted survivors and the adversarial prior was that some would have.

Searched and found nothing new: `toBeGreaterThanOrEqual(0)`, `toBeGreaterThan(-1)`, `toBeTruthy()`,
`toHaveLength(0)` on a freshly-built empty, `expect(true)`, and `toBeDefined()`/`not.toBeUndefined()`
on already-narrowed values, across all six of the phase's criterion specs. The only three hits —
`speculation-agents.node.test.ts`'s `not.toBeUndefined()` on `workerHoldings[0]` and its two
`toBeDefined()` calls on `duplicates.find(…)` results — are genuine: `find` returns `undefined` at
runtime whatever the `as` cast says, and each is reachable (the tracked or paired shard failing to be
duplicated).

What the phase **did** declare against its own interest, each re-derived at HEAD and each correct:

| Declared un-failable / limited | Where | Confirmed |
|---|---|---|
| The departure probe that a live endpoint also satisfied — replaced, after two plants | `checkpoint-agents.node.test.ts`, the `stillReachable` block | Yes; the replacement is a binary dial and P2 shows the file's readings fail |
| The carried-shard CID equality does not hold the resultCid substitution, because the guest echoes its input | same file, *What this file CANNOT redden on* | Yes; `MODULE_ECHOES_INPUT` is the identity function |
| Criterion 3's *"a straggler, not a refusal"* block has no plant that reddens it while everything above stays green — structurally | `speculation-agents.node.test.ts`, block (5) | Yes; any mutation turning the freeze into a refusal removes the silence and the duplication assertions above fail first |
| Deleting the requestor's drop-poll leaves `coverage-agents` green; **the stop** is what carries the reading | `coverage-agents.node.test.ts`, arm 2 | Yes, and P3 shows the denominator reading itself does fail |
| `coverage.unexpected` is structurally empty and has no reachable reading | `submit.ts`, the coverage block | Yes |
| `complete ⟹ coverage.complete` by construction; the converse fails | `JobResult.coverage` docblock | Yes — `landedForItsOwner` omits `!degraded`, which `complete` requires |
| `VerificationResult`'s `agreed` arm has no `failures`, so the re-pick erases the refusal; the reading is routed to the lease history instead | `discovery-agents.node.test.ts` | Yes (W4) |
| The renewal case cannot say anything about a fabric where `admit` is absent | `submit.test.ts` renewal pair | Yes |
| `serve-agent-hooks`' cross-tier equality can tell a divergent derivation from a convergent one and nothing more — a defect planted identically in both files passes it | `serve-agent-hooks.node.test.ts` | Yes; and P7/P8 show the behavioural readings do fail for each tier separately |
| One deleted `churn.test.ts` behaviour went **nowhere** — a `sender` refusal retried outside the task budget | `churn.test.ts` header | Yes; stated as a real loss bounded by 3 |

---

## Claims measured FALSE

| Claim | Where | Measured |
|---|---|---|
| *"`job-entry-point.test.ts` holds that as a check rather than as this comment."* | `packages/core/src/index.ts`, WIRE-04 comment block | **FALSE.** No such file exists; the string occurs on that one line in the whole tree. The guard is in `packages/core/src/job/submit.test.ts`. W1. |
| *(this verifier's own working hypothesis)* removing the **browser** tier's own-row record would leave `peer-ledger.e2e` green, because peers publish to one another | — | **FALSE**, refuted by P8: 4 of 7 cases red. Recorded because a verifier's plausible reasoning is not a measurement either. |

Everything else this pass re-derived matched. In particular, 20-13's whole-tree figures are exact:
`--project node` 150 files / 2158 passed / 2 skipped at exit 0, `tsc` 0, browser 0, e2e 0,
`O2_PERF=1` perf 0 — all five re-run here and all five confirmed.

---

## Did the phase leave the tree green?

**Yes, on all five projects, exit codes read directly.**

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output |
| `npx vitest run --project node` | **0** | 150 files, 2158 passed / 2 skipped, 249.94 s |
| `npx vitest run --project browser` | **0** | 243 files, 3930 passed, 33.14 s |
| `npx vitest run --project e2e` | **0** | 15 files, 72 passed, 179.81 s |
| `O2_PERF=1 npx vitest run --project perf` | **0** | 1 file, 2 passed, 1.90 s |

`git status --porcelain` was empty before this pass, after every plant's restoration, and at the end.
Every restoration was `cp` + `cmp` with `cmp` exit 0.

---

## Anti-pattern scan

112 files under `packages/` and `tools/` changed across the phase's commit span
(`67568ba`..`8616049`).

- `TBD` / `FIXME` / `XXX`: **zero**, in the changed files and in the whole of `packages` and `tools`.
- `TODO` / `HACK` / `PLACEHOLDER`: one hit, and it is not a marker —
  `strip-comments.node.test.ts`'s function `BLINDABLE_WITH_THE_COLON_HACK`, a descriptive identifier.
- `coming soon` / `not yet implemented` / `will be here`: **zero**.
- `placeholder` in prose: 17 hits, every one a comment explaining why the value beside it is *not* a
  placeholder.

---

## Requirements coverage, checked against the tree rather than the row

| Requirement | Marker | Verified |
|---|---|---|
| WIRE-04 | `[x]` | Supported. `coordinator.ts` gone, no `runResilient` definition anywhere, barrel guard proved falsifiable (P1). The row's own framing — that the requirement's failure mode was a barrel export nothing watched, for thirteen phases — is confirmed. |
| CHURN-01 | `[x]` | Supported. Generation loop in `submitJob`; `redispatches` and `leaseHistory` on `JobResult`; measured over ten processes; falsifiable (P6). |
| CHURN-02 | `[x]` | Supported. Duplication, the loser read rather than discarded, cost published from the job; measured over seven processes; falsifiable (P4). |
| CHURN-03 | `[ ]` Partial | **Correct, and it is criterion 7's PARTIAL.** Mechanism landed and is falsifiable (P2); the wiring did not — no production submitter supplies a `checkpoints` sink and no guard pins the set. |
| CHURN-04 | `[ ]` Partial | Correct. Renewal is built and is evidence-conditional, falsifiable in both directions (P9, P10). The open leg named in the row is right: the probe reuses `JobSpec.admit`, and the only production submitter supplying it is `bin/bench.ts --discover`, off by default. |
| CHURN-05 | `[x]` | Supported. Named union, owed-against-done gate, derived owner set; measured over processes; falsifiable (P3). |
| CHURN-06 | `[x]` | Supported. `speculativeCandidates` routes through `eligibleNodes` on the *gate's* pool; both arms in one job; the "no spare node" arm's alternative explanations excluded by measurement. |
| BROW-02 | `[ ]` Partial | Correct **when written**; the reading half it names as open is now closed by criterion 5's e2e file, and its statement that the plant's observed text was never captured is closed by P7/P8 (W7). The remaining open item in the row — no row-count bound on `parseCounts`, crossover computed at 191 099 rows under NET-08's 8 MiB ceiling — is untouched by this phase and correctly left open. |
| AUTH-04 | `[ ]` Partial | Untouched by this phase; the cost clause is Phase 19's criterion 5, carried to Phase 24. |

---

## What a gap-closure plan would have to do

**G1 — criterion 7's write half.** Give one production submitter a checkpoint sink and guard the
call-site set.

1. `bin/bench.ts` is the natural site: it already opens an `FsBlockstore` (so a checkpoint written
   there is durable, which `task-worker.ts`'s `MemoryBlockstore` is not) and it already holds the
   only production `admit`. A `--checkpoint` flag, or an unconditional sink on the real-transport
   rungs, closes it.
2. Add the guard the source already asks for, in `sovereign-block-refusal.node.test.ts`'s shape: pin
   the set of files permitted to pass `SubmitOptions.checkpoints`, and prove it falsifiable with a
   `plantedSource` case the way `bench-reduce.node.test.ts` does for its requirements.
3. Do **not** make `SubmitOptions.checkpoints` required. The source's argument against it is correct
   and specific — `task-worker.ts` submits into a `MemoryBlockstore`, and a checkpoint written there
   is a checkpoint of nothing, so requiring a destination would be requiring a falsehood.

**W1** is a one-line edit: name `packages/core/src/job/submit.test.ts` and its `describe` title, or
create the file the comment promises.

**W2** is one added case: run the same namespace check over `@o2/net`'s barrel with its own stated
allow-list, so `submitJobWithEgress` and `reduceJob` are pinned as delegating components rather than
being uncovered.

**W3** is one field: put `speculationSpent` on `Observation` and print it beside `spec. tax`, so a
`1.00` on the operator's table says which of its two causes it has.

**W5** is one flag on `bin/agent.ts`, in the `parseArgs` block the binary's own comment already asks
the next phase to fold.

**W7** is one mutation-ledger entry, or two — the observed texts are in `probes_executed` above.

---

_Verified: 2026-08-05T10:50:46Z at HEAD `8616049`_
_Verifier: independent goal-backward pass (gsd-verifier), adversarial stance_
_Ten source mutations were planted, watched red, and restored with `cp` + `cmp` (exit 0 each).
`git status --porcelain` empty before and after. No file in the tree was left modified by this
verification._

---

## Amendment — 2026-08-18: criterion 7 **CLOSES**, and the score becomes **7/7**

**Score: 6/7 → 7/7 criteria. Nothing above is retracted.** The 2026-08-05 pass was right on the
day it was written, and it is right about the tree it read: `bin/agent.ts` submitted no job, so
no coordinator an operator could start wrote a checkpoint, and PARTIAL was the state that was
true. This amendment closes the criterion by **building the missing subject**, not by rereading
the old evidence.

**Verified:** 2026-08-18, at `ce97bc8`, branch `feature/phase-20-checkpoint-agent`.
**Scope: criterion 7 ONLY.** Criteria 1–6 are MET and were **not** re-adjudicated.
**Verdict:** criterion 7 **MET**, phase **7/7**.

### The verdict this replaces, quoted rather than deleted

> | 7 | A coordinator writes a checkpoint during a live job run through `bin/agent.ts`, and a
> SECOND requestor — given nothing but that CID — finishes only the outstanding shards and
> returns the same answer | **PARTIAL** | P2 carries the recovery half; the write half runs on a
> sink no production submitter supplies |

and, from the gap:

> What is NOT delivered is the first clause's subject. … the only coordinator in this repository
> that writes a checkpoint is a test's.

and, from the closure plan (**G1**):

> **G1 — criterion 7's write half.** Give one production submitter a checkpoint sink and guard
> the call-site set. 1. `bin/bench.ts` is the natural site …

### G1's step 1 was tried at the named site and is **declined**, with the reason measured

`bin/bench.ts` is the wrong host, and it is worth writing down so nobody moves it back:

1. **It is a multi-workload sweep, and one handle cannot name its many jobs.** `resumeState`
   refuses a handle whose checkpoint names a different job — `checkpoint-names-another-job` — and
   one handle applied across a sweep of differently-shaped rungs makes **every rung refuse** while
   the driver prints a benchmark over nothing and exits 0. Measured 2026-08-18; the same failure
   is recorded at `browser/demo/main.ts:1384`.
2. **Its store does not outlive the run.** The blockstore is `mkdtemp(tmpdir(), 'o2-bench-')`,
   deleted by `close()`, so a handle published from it names a block that is gone before anything
   could resume. That is the *opposite* of the property the criterion is about, and it is why
   `bin/bench.ts`'s two sentinel opt-outs are correct rather than lazy.
3. Collapsing its rung ladder to fit one job trips its own `HarnessIntegrityError` — *"the shard
   status vector is empty … an instrument that read nothing"*.

So the closure takes G1's **third** listed option in substance and its first in spirit: a
production submitter with a durable store, sited on the entry point the criterion names.

### What was built

`packages/node/src/bin/agent.ts` grew a **coordinator leg**, off by default:

| flag | what it does |
|---|---|
| `--coordinate <shards>` | run one demo-colouring job of `<shards>` cubes over the `--peer-addr` peers |
| `--coordinate-n <n>` | the problem size, default 300 — the first rung of the demo's own ladder |
| `--job-store <dir>` | the job's content-addressed store: shard inputs, shard results, checkpoint blocks. Defaults to `--dir` |
| `--resume-from <cid> …` | checkpoint handles, newest first, passed to `SubmitOptions.resumeFrom` |

Three properties of the shape, each of which was a decision:

- **Off by default means byte-identical.** Every line of the new block is inside
  `if (values.coordinate !== undefined)`, so the 19 existing argv sites in this repository are
  unchanged — the rule `--discover` established in `bin/bench.ts`.
- **`--job-store` is separate from `--dir` because a peer id is not job state.** `--dir` also
  holds this node's identity seed (`fabric-node.ts`, `loadOrCreateSeed`), so two processes pointed
  at one `--dir` are **one peer id wearing two processes** — a weaker claim than *"a SECOND
  requestor"*. What crosses between the two coordinators is a directory of content-addressed
  blocks and one CID, and the peer ids are asserted to differ.
- **`submitJobWithEgress`, not bare `submitJob`.** The first full run of
  `sovereign-block-refusal.node.test.ts` caught this leg by name — *"packages/node/src/bin/agent.ts
  calls bare submitJob. That is a new production submit path, and `submitJobWithEgress`'s
  sovereign registration does not cover it"* — and the remedy that guard names first is the one
  taken. Recorded because the guard found a real hole in the first draft.

### The measurement — five spawned processes, no in-process requestor anywhere

`packages/node/src/checkpoint-coordinator.e2e.test.ts`. Nothing in that file submits a job, holds
a `JobSpec`, wraps an `Executor` or touches a `CheckpointSink`; it spawns processes, reads their
stdout, and reads one block off a directory. **That is the whole difference from
`checkpoint-agents.node.test.ts`**, which had to record the substitution *"a job run **across**
`bin/agent.ts` processes"* and whose in-process requestor is exactly what the PARTIAL was about.

`npx vitest run --project e2e packages/node/src/checkpoint-coordinator.e2e.test.ts --reporter=verbose`,
exit **0**, 2 passed, 8.54 s:

```
[criterion 7 / coordinator] standUp 774ms for 2 agents, control 1824ms, departed 974ms,
                            resumed 1216ms, restarted 1387ms;
  the checkpoint named [0,1,2,3,4,9] and left [5,6,7,8,10,11,12,13,14,15];
  attempted per partition — control   [1,1,1,1,1,1,1,1,1,2,1,1,1,1,1,1],
                            resumed   [0,0,0,0,0,1,1,1,1,0,2,1,1,1,1,1],
                            restarted [1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1];
  resumed endings [carried-from-checkpoint ×5, agreed ×4, carried-from-checkpoint, agreed ×6];
  chain — departed published 6, resumed reports 16;
  complete/redispatches — control true/0, resumed false/0, restarted true/0
```

Each clause of the criterion, and where it is read:

- **"a coordinator writes a checkpoint during a live job run through `bin/agent.ts`"** — the
  control process publishes 16 confirmed handles, each read back out of the store through
  `readCheckpoint` *before* it is printed, so a handle on stdout is a handle whose block is
  already retrievable. `expect(controlJob.confirmed).toHaveLength(SHARDS)`.
- **"a SECOND requestor"** — its own process, its own `--dir`, its own peer id, asserted
  `expect(peerIdOf(resumed)).not.toBe(peerIdOf(departed))`, started after the first took SIGKILL
  (`signalCode === 'SIGKILL'`, `exitCode === null`) and after that first process was confirmed
  never to have reached its own job line.
- **"given nothing but that checkpoint's CID"** — the job description and one `--resume-from`.
  The set the checkpoint names is **not** taken from either coordinator's report: the file opens
  the shared store itself and reads the block from the CID alone, through the same validating
  reader `resumeState` uses. The resumed process's own `remaining` — computed by `remainingWork`
  inside `bin/agent.ts` before the job runs — must equal the complement of that set.
- **"finishes only the outstanding shards"** — `carried-from-checkpoint` with `attempted: 0` on
  exactly the six the checkpoint names, and `attempted ≥ 1` on exactly the other ten. The
  `restarted` arm is the same command line **minus one flag**, over the same store and the same
  fabric in the same run, and attempts all sixteen: `worked(resumed) < worked(restarted)`.
- **"returns the same answer the first would have"** — `resumedJob.shards.map(resultCid)` equals
  the control's, per shard, in the same run, never a pinned literal. `n = 300` is chosen for this:
  at 400 and above almost every cube exhausts `DEFAULT_BUDGET` and returns the identical "not
  found" partial, which would make the comparison a tautology. Asserted alive by
  `new Set(controlCids).size > 1`.

One reading beyond the criterion, kept because it is the one a restart cannot fake: the resumed
process reports `chain: 16` against six publishes of its own. `checkpointLogOf` seeds a resumed
run's first checkpoint with the handle it resumed from as its `previous`, so `checkpointChain`
walks back **through the departed requestor's history**. A restart's chain is only as long as its
own publishes.

### Falsifiable — both clauses, both planted, both watched red

| id | criterion | mutation | exit | observed |
|---|---|---|---|---|
| **P11** | 7, write half | `bin/agent.ts` — `{ checkpoints, …}` → `{ checkpoints: 'checkpoints-nothing', …}`, i.e. the coordinator states it keeps no checkpoints | **1** | 1 failed \| 1 passed. `expected [] to have a length of 16 but got +0` at `expect(controlJob.confirmed).toHaveLength(SHARDS)` — the criterion's first clause, failing on the exact assertion that carries it |
| **P12** | 7, read half | `bin/agent.ts` — `...(resumeFrom.length === 0 ? {} : { resumeFrom })` → `...(… ? {} : {})`, i.e. the handles are parsed, reported, and never given to the job | **1** | 2 failed. `expected 'agreed' to be 'carried-from-checkpoint'`, and the printed line becomes `resumed endings [agreed ×16]` with `attempted` ≥ 1 on **every** partition — the second requestor recomputing the whole job. The refusal case fails too, `expected true to be false`: a resume that is never passed cannot be refused |

Both restored by the **surgical inverse** of the plant — the same one-line substitution reversed,
never a `cp` of the whole file — and verified with `cmp` against a snapshot taken immediately
before planting. `CMP_EXIT=0` on both. Re-planted and re-measured a second time after the
`submitJobWithEgress` change, so the record above is against the committed source and not against
a draft.

### What this does NOT close, stated so the MET is not read as wider than it is

- **CHURN-03 does not tick, and its row says why.** The opt-out census, re-measured 2026-08-18, is
  **seven of nine** submit sites passing `'checkpoints-nothing'` against two supplying a real sink
  (`demo/main.ts:1540` and `bin/agent.ts:1626`). Every opt-out carries a written reason and
  `checkpoint-optout-scope.node.test.ts` pins the set in both directions — that is scope *stated*,
  and stated is not satisfied. What did die is the row's no-caller clause: `remainingWork` and
  `checkpointChain` now have production callers, `checkpointsInto` left the `global-object-hop`
  register, and `DISPOSITION_CEILING` was **lowered** 61 → 60 for the first time in its history.
- **CHURN-04 does not tick either.** The coordinator is a third production submitter supplying
  `admit`, which is the channel renewal takes its evidence from — the precondition, not the
  renewal. It drives no renewal and now the reason is arithmetic rather than an absence of
  coverage: `DEFAULT_LEASE_MS` 30 000 ms × `RENEW_AT` ⅔ = 20 s before `shouldRenew` can return
  true, against a ~60 ms cube. A factor of ~330.
- **The wire limit is unchanged.** `protocol.ts` has a `block` request that **pulls** and nothing
  that pushes or provides, so the hand-off cannot survive the loss of the departed requestor's
  disk. That is why the two coordinators share a directory, and it is a finding rather than a case
  this closure fakes.
- **W1, W2, W3, W5 and W7 are untouched** by this amendment. W5 is now *narrower* in one respect
  only — `bin/agent.ts` has learned to say more things — but `startReporting` is still hardcoded
  and no `--withholds-start-report` flag exists.

### Did the tree stay green?

| command | exit | result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output |
| `npx vitest run --project e2e packages/node/src/checkpoint-coordinator.e2e.test.ts` | **0** | 2 passed, 8.54 s |
| `npx vitest run --project e2e` (whole project) | **0** | 34 files, 221 passed, 679 s; `(user+sys)/real` = **0.63**, which is what a browser-and-relay project looks like — this suite waits on processes and sockets far more than it computes |
| `npx vitest run --project node` | **1** | 197 files, 2935 passed / 8 failed / 1 skipped, 409 s; `(user+sys)/real` = **1.93** |

**Every one of the eight node-project failures is outside this change, and each was checked
rather than assumed:**

- `vocabulary.node.test.ts` ×5 — all five findings name `.planning/milestones/v1.1-ROADMAP.md:210`
  and `:211`. `git show 8c2cda7:.planning/milestones/v1.1-ROADMAP.md` reproduces both lines
  verbatim at the branch point. Arrived with the v1.1 archive merge.
- `slow-specs.node.test.ts` file-count drift, 197 against a recorded 191 — **the tracked
  node-project population is 197 at `8c2cda7` and 197 at `ce97bc8`, identical**. That guard's own
  filter excludes `*.e2e.test.ts` (`slow-specs.node.test.ts:151`), so the file added here cannot
  have moved it.
- `mutation-guard.node.test.ts` M63 ×2 — names `tools/aot/lift.ts`, a file this change never
  touched and which a concurrent agent holds modified in the shared working tree.

`O2_SKIP_GUARDS=1` was used on both commits, for the `slow-specs` drift alone, and each commit
message says so and says why. Every other cheap guard passes on this change's paths — including
the four this change reddened and then satisfied: `reachability-guard`, `requirements-ledger`,
`checkpoint-optout-scope` and `sovereign-block-refusal`.

_Amended: 2026-08-18 at `ce97bc8`, branch `feature/phase-20-checkpoint-agent`._
_Two source mutations planted, watched red, and restored by surgical inverse with `cmp` exit 0
each. No file outside this change's own list was left modified._
