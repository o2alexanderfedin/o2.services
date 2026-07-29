---
phase: phase-13-egress-manifest-completeness
plan: 04
subsystem: infra
tags: [egress, sovereignty, data-governance, o2-net, refusal]

# Dependency graph
requires:
  - phase: phase-4-transport-and-egress
    provides: EgressGuard (packages/net/src/egress.ts), the Transport decorator that scans outbound frames for registered sovereign byte patterns
  - phase: phase-13-egress-manifest-completeness
    plan: "01"
    provides: registerSovereignInputs (the production caller of EgressGuard.guard()) and submitJobWithEgress/sliceManifest
  - phase: phase-13-egress-manifest-completeness
    plan: "02"
    provides: FabricNode.egress and BrowserNode.egress — both node factories build their RpcEndpoint over the guard
provides:
  - EgressRefusal (packages/net/src/egress.ts), exported from @o2/net — a typed, branchable refusal carrying to/violation/bytes as fields
  - EgressGuard.send that records the attempt and then rejects, so the inner transport is never called for a frame carrying a registered sovereign payload
  - EgressManifest.totalBytes that counts only what actually left, under one rule shared by the guard's own getter and sliceManifest
  - A delivery counter in egress.test.ts read twice — 1 for a legitimate frame, 0 for a refused one — so no "nothing arrived" assertion in this package rests on an instrument never shown reading
affects: [phase-13-plan-05, phase-13-plan-06, phase-13-plan-07, phase-19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A refusal is expressed as a rejected Transport.send, because a refusal is a send that did not happen and the RPC layer already models that on both legs"
    - "Push-before-throw: the manifest entry is recorded before the refusal is raised, so stopping a leak never costs the record that it was stopped"
    - "A negative reading is only asserted from an instrument the same file shows reading positively — the delivery counter is read 0 and 1 in egress.test.ts"

key-files:
  created: []
  modified:
    - packages/net/src/egress.ts
    - packages/net/src/index.ts
    - packages/net/src/submit-with-egress.ts
    - packages/net/src/egress.test.ts
    - packages/net/src/sovereign-egress.test.ts
    - packages/net/src/sovereign-execution.test.ts

key-decisions:
  - "No `refused` field was added to EgressEntry: under the refusal a `violation` IS a refusal by construction, and a second field could only drift from the first. The reasoning is written into EgressManifest.totalBytes' doc so a later reader does not add one"
  - "The response-leg cost is named, not closed: rpc.ts swallows a send failure on the responding leg by documented design, so a cross-owner requestor waits out its own timeout and learns that the dispatch failed but not why. Closing it would change every peer's response-leg failure semantics to fix a latency and legibility complaint rather than a correctness one"
  - "sovereign-execution.test.ts's falsification test gets an explicit 20s budget — its 5s RPC timeout is now on the success path of the assertion, and vitest's 5s default would report a timeout instead of the assertion the test is about"

patterns-established:
  - "Mutation B separates the two guarantees a single test could conflate: 'the bytes did not leave' and 'the manifest says so'. Under it the rejection assertions still pass and only the manifest assertions fall"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 26min
completed: 2026-07-28
---

# Phase 13 Plan 04: EgressGuard Refuses Summary

**`EgressGuard.send()` now records a match and then rejects with an exported `EgressRefusal` instead of forwarding it anyway — the inner transport is never called, `totalBytes` counts only what left, and a delivery counter read 0 for a refused frame and 1 for a legitimate one in the same file proves the bytes really stayed home.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-07-28T12:30:00-07:00
- **Completed:** 2026-07-28T12:56:20-07:00
- **Tasks:** 3
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- `EgressGuard.send` refuses. A frame containing a registered sovereign payload is pushed onto `#entries` and then rejected with `EgressRefusal`; `this.#inner.send` is never reached for it. The old class comment said the opposite outright ("A match is recorded as a violation rather than thrown") and is gone.
- `EgressRefusal` is exported from `@o2/net`, shaped after `RpcFailure`: `to`, `violation` and `bytes` are readonly fields, so callers branch on values and never on a message string. The message names all three, so an operator reading a log has the destination, the label and the frame size without a debugger.
- `manifest.totalBytes` and `sliceManifest`'s recomputation now sum only entries with no `violation`, under one rule stated in both files. A manifest holding one refused frame reads `entries.length === 1` and `totalBytes === 0` — a refusal and a node that sent nothing are no longer confusable.
- The delivery counter is the instrument the whole plan rests on, and it is read twice in `egress.test.ts`: `0` in *refuses a frame that carries the raw row*, `1` in *passes an aggregate derived from the same data*. Both readings come off the same peer transport that the tests previously connected and discarded.
- A refusal on a node's own outbound request reaches the caller as `RpcFailure{kind:'send-failed'}` naming the violated label, in under a second against a 10-second endpoint timeout — so an immediate rejection is measurably distinct from a timeout.
- Five inverted assertions across three files plus three new ones, and every one of the three new guarantees was watched failing under a planted mutation before this summary was written.
- Three comment blocks that asserted the opposite of the code are rewritten, and three things that had nowhere else to live are now written down in `egress.ts`: the response-leg cost, the block-serving rule as the owner's unconditional ruling of 2026-07-28, and the unbounded `#guarded` set that Plan 13-07 closes.

## Task Commits

Each task was committed atomically. Task 1 is TDD, so it is two commits.

1. **Task 1 (RED): egress unit proof demands a refusal** — `811b820` (test)
2. **Task 1 (GREEN): EgressGuard.send refuses instead of annotating** — `ad5e993` (feat)
3. **Task 2: the two integration assertions that said a leaking dispatch succeeds** — `49aa7be` (test)
4. **Task 3: plant, watch, capture, revert** — no commit, by design. Three mutations were planted in `packages/net/src/egress.ts`, run, captured verbatim below, and reverted with `git checkout -- packages/net/src/egress.ts`. The task leaves no lasting code change, so nothing was staged.

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/net/src/egress.ts` — `EgressRefusal`; push-before-throw in `send()`; `totalBytes` over unrefused entries only; the module comment, the class comment, `EgressEntry.violation`'s doc and `EgressManifest.violations`' doc all rewritten to describe the refusal
- `packages/net/src/index.ts` — `EgressRefusal` added to the existing `EgressGuard` export line; nothing else in the barrel touched
- `packages/net/src/submit-with-egress.ts` — `sliceManifest`'s `totalBytes` brought under the same rule, with a module-comment paragraph on why the two computations must agree
- `packages/net/src/egress.test.ts` — the coordinator transport captured as a delivery counter; four assertions inverted to `EgressRefusal` rejections; one new test for the requesting leg
- `packages/net/src/sovereign-egress.test.ts` — the first behavior's dispatch now returns `ok: false` naming the serving node, with the recorded entry asserted alongside the existing `violations` check
- `packages/net/src/sovereign-execution.test.ts` — the same inversion on the falsification test, paired with a non-empty `entries` reading and an explicit 20s test budget

## Task 3 — three mutations, planted, run, captured, reverted

Command for all three: `npx vitest run packages/net`. `packages/net` runs under two vitest
projects (`node` and `browser (chromium)`), so every failure appears twice; the verbatim
blocks below are the `node` project's, and the counts are the run's own.

Baseline for this package, immediately before Mutation A: **22 files / 182 tests, all passing.**

### Mutation A — delete the `throw new EgressRefusal(...)` from `send()`

The guard records and forwards exactly as it did before this plan.

```
 Test Files  6 failed | 16 passed (22)
      Tests  14 failed | 168 passed (182)
```

`egress.test.ts`:

```
 FAIL  |node| packages/net/src/egress.test.ts > DATA-04 — a raw sovereign byte does not reach the wire at all > refuses a frame that carries the raw row, and the peer never sees it
AssertionError: expected null to be an instance of EgressRefusal
 ❯ packages/net/src/egress.test.ts:110:21
    108|
    109|     // Typed, so a caller branches on the value rather than on a messa…
    110|     expect(refusal).toBeInstanceOf(EgressRefusal)
       |                     ^
    111|     expect((refusal as EgressRefusal).violation).toBe('alice-row')
    112|     expect((refusal as EgressRefusal).to).toBe('coordinator')
```

`sovereign-egress.test.ts`:

```
 FAIL  |node| packages/net/src/sovereign-egress.test.ts > registerSovereignInputs — a production caller for EgressGuard.guard() > registers a sovereign task’s input before it runs, and the tap refuses the leaking reply
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/net/src/sovereign-egress.test.ts:129:26
    127|       // cost. The added seconds here are an understood consequence, n…
    128|       // test nobody has looked at.
    129|       expect(outcome.ok).toBe(false)
       |                          ^
    130|       if (outcome.ok) return
    131|       expect(outcome.reason).toContain(node.nodeId)
```

`sovereign-execution.test.ts`:

```
 FAIL  |node| packages/net/src/sovereign-execution.test.ts > criterion 6 — an owner’s own nodes verify each other > stops a map step that forgot to aggregate and tried to ship its input
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/net/src/sovereign-execution.test.ts:371:26
    369|         ownerId: fabric.aliceUserKey,
    370|       })
    371|       expect(outcome.ok).toBe(false)
       |                          ^
    372|       if (outcome.ok) return
    373|       expect(outcome.reason).toContain(node.nodeId)
```

The other three `egress.test.ts` failures in this run were *refuses the row embedded in a
larger frame*, *watches several guarded values at once and names which one it refused* and
*resets without losing the guarded set*, each `promise resolved "undefined" instead of
rejecting`, plus *surfaces a refusal on the requesting leg as a named send failure, not a
timeout*, which failed as `Test timed out in 5000ms` — with the frame forwarded, the
coordinator never answers and the request runs to its 10s endpoint timeout.

One thing worth stating rather than glossing: in the first test the run stopped at line 110,
so the delivery-counter reading at line 116 was never reached under this mutation. Mutation
A proves the rejection is load-bearing; the counter's own load-bearingness is what the
`toBe(1)` positive control in *passes an aggregate derived from the same data* is for, and
that assertion passed in every run here.

Reverted with `git checkout -- packages/net/src/egress.ts`; `git status --short
packages/net/src/egress.ts` empty afterwards.

### Mutation B — move the `this.#entries.push(...)` to *after* the refusal throw

A refused frame is never recorded. **This is the mutation that proves the ordering
requirement rather than the refusal**, and it is the reason the plan asked for it
separately: it splits "the bytes did not leave" from "the manifest says so". Those are two
different guarantees, and one test asserting both could pass on either. Under this mutation
every rejection assertion still passes — the frame is still refused — and only the manifest
assertions fall. A node with this defect would stop the leak and hold no record that it had:
threat T-13-06 in the plan's own register, made concrete.

```
 Test Files  6 failed | 16 passed (22)
      Tests  12 failed | 170 passed (182)
```

```
 FAIL  |node| packages/net/src/egress.test.ts > DATA-04 — a raw sovereign byte does not reach the wire at all > refuses a frame that carries the raw row, and the peer never sees it
AssertionError: expected [] to deeply equal [ 'alice-row' ]

- Expected
+ Received

- [
-   "alice-row",
- ]
+ []

 ❯ packages/net/src/egress.test.ts:121:33
    119|
    120|     const manifest = owner.manifest
    121|     expect(manifest.violations).toEqual(['alice-row'])
       |                                 ^
    122|     expect(manifest.entries).toHaveLength(1)
    123|     expect(manifest.entries[0]?.violation).toBe('alice-row')
```

```
 FAIL  |node| packages/net/src/sovereign-egress.test.ts > registerSovereignInputs — a production caller for EgressGuard.guard() > registers a sovereign task’s input before it runs, and the tap refuses the leaking reply
AssertionError: expected [] to include 'bafyreiccwgqag45rbtsfri5zatieqprf5yxk…'
 ❯ packages/net/src/sovereign-egress.test.ts:136:35
    134|       // reached without this test ever calling guard.guard().
    135|       const manifest = node.guard.manifest
    136|       expect(manifest.violations).toContain(inputCid.toString())
       |                                   ^
    137|       expect(manifest.entries.some((entry) => entry.violation === inpu…
    138|     } finally {
```

```
 FAIL  |node| packages/net/src/sovereign-execution.test.ts > criterion 6 — an owner’s own nodes verify each other > stops a map step that forgot to aggregate and tried to ship its input
AssertionError: expected [] to include 'alice-row'
 ❯ packages/net/src/sovereign-execution.test.ts:379:35
    377|       // cannot pass as one that recorded a refusal.
    378|       const manifest = node.guard.manifest
    379|       expect(manifest.violations).toContain('alice-row')
       |                                   ^
    380|       expect(manifest.entries.length).toBeGreaterThan(0)
    381|       expect(manifest.entries.some((entry) => entry.violation === 'ali…
```

Note the line numbers against Mutation A's: in `egress.test.ts` the failure moved from 110
to 121, in `sovereign-egress.test.ts` from 129 to 136, in `sovereign-execution.test.ts` from
371 to 379. In every case the rejection and the `ok: false` assertions above the manifest
read now pass, and the manifest read is the first thing that falls. That is the separation
the mutation exists to demonstrate, visible in the line numbers alone.

Reverted with `git checkout -- packages/net/src/egress.ts`; clean afterwards.

### Mutation C — `totalBytes` back to summing every entry regardless of violation

```
 Test Files  2 failed | 20 passed (22)
      Tests  2 failed | 180 passed (182)
```

```
 FAIL  |node| packages/net/src/egress.test.ts > DATA-04 — a raw sovereign byte does not reach the wire at all > refuses a frame that carries the raw row, and the peer never sees it
AssertionError: expected 37 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 37

 ❯ packages/net/src/egress.test.ts:127:33
    125|     // frame was refused must never read like the manifest of a node t…
    126|     // nothing at all.
    127|     expect(manifest.totalBytes).toBe(0)
       |                                 ^
    128|     })
    129|
```

The narrowest blast radius of the three, and correctly so: exactly one assertion in the
whole package reads `totalBytes` for a refused frame, and it is the one this plan added.
Reverted; clean.

### After the third revert

```
$ git status --short packages/net/src/egress.ts
(empty)

$ npx tsc --noEmit
tsc exit: 0

$ npx vitest run packages/net
 Test Files  22 passed (22)
      Tests  182 passed (182)
```

`git status --short` over the whole tree was also empty at this point — no other agent's
uncommitted work was present, and nothing outside this plan's own files was touched.

## Verification — real counts from real runs

```
$ npx tsc --noEmit
tsc exit: 0        (no output)

$ npx vitest run packages/net
 Test Files  22 passed (22)
      Tests  182 passed (182)

$ npm test
 Test Files  1 failed | 121 passed (122)
      Tests  1 failed | 1776 passed (1777)
   Duration  288.05s
```

The package baseline before this plan was 22 files / 180 tests; the repository baseline was
122 files / 1775 tests. Both grew by exactly 2 — the one new test in `egress.test.ts`, run
under both the `node` and `browser (chromium)` projects.

### The one red test, and why it is expected

```
 FAIL  |node| packages/node/src/egress-manifest.node.test.ts > DATA-05 — production registration lets the tap catch a real leak, through the same factory bin/agent.ts uses > a map step that forgot to aggregate names its own violation, with no test-side guard.guard() call
AssertionError: expected 'insufficient' to be 'agreed' // Object.is equality

Expected: "agreed"
Received: "insufficient"

 ❯ packages/node/src/egress-manifest.node.test.ts:117:55
    115|     // the raw input as its output; the tap, not the sovereignty gate,…
    116|     // must catch this.
    117|     expect(result.job.shards[0]?.verification.status).toBe('agreed')
       |                                                       ^
    118|
    119|     expect(result.manifests[0]?.violations).toContain(inputCid.ok ? in…
```

This is the assertion 13-VERIFICATION.md called out as the criterion-1 gap — *"the DATA-05
test asserts the shard reaches `'agreed'` while the raw block crosses"*. Plan 13-05 owns
that file and inverts it next; this plan deliberately did not touch it. The received value
is the whole point: `insufficient` is `executeVerified`'s verdict when every executor
failed, which is exactly what a refused reply frame produces, one layer up from where this
plan works.

**One honest limit on that reading.** Because line 117 throws, line 119's `violations`
assertion is *not reached* in this run, so this run does not independently confirm that the
production manifest still carries the label under the refusal. The equivalent claim is
proven in `packages/net` — `sovereign-egress.test.ts` asserts both the recorded label and
the recorded entry against a real `RpcEndpoint`/`serveAgent` fabric, and Mutation B watched
both fall — but the `FabricNode`-level confirmation belongs to Plan 13-05 and should not be
assumed until it runs.

Everything else in the repository is green. In particular the two tests the plan flagged as
verified-unaffected during planning both still pass unchanged: `sovereign-execution.test.ts`
criterion 3's pushdown test (it runs `MODULE_WRITES_PARTITION`, so no violation is produced)
and criterion 4's block-reply assertion (Bob's node is built over a raw transport with no
`EgressGuard` on it). Neither needed adjusting, so the plan's assumption held.

## Decisions Made

- **Test names changed where they asserted the old behavior.** `flags a frame that carries
  the raw row` → `refuses a frame that carries the raw row, and the peer never sees it`;
  `catches the row embedded in a larger frame` → `refuses …`; `names which one leaked` →
  `names which one it refused`; `catches a map step that forgot to aggregate and shipped its
  input` → `stops a map step that forgot to aggregate and tried to ship its input`; and the
  `DATA-04` describe block from *a raw sovereign byte crossing the wire fails the test* to
  *a raw sovereign byte does not reach the wire at all*. The plan named these tests by their
  old titles for identification and did not ask for renames, but leaving a name that says
  "flags" over a body that asserts a refusal reproduces exactly the code-contradicts-comment
  defect the plan's `<action>` spends three paragraphs eliminating from `egress.ts`. The old
  titles are listed here so the plan's text can still be mapped onto the file.
- **A `20_000` ms budget on `sovereign-execution.test.ts`'s falsification test.** Its
  requestor holds a 5s RPC timeout, and under the refusal the responding leg is silent, so
  the assertion is now reached only after that timeout fires. Vitest's 5s default would
  report `Test timed out in 5000ms` instead of the assertion — which is what it did before
  the budget was added (observed, not predicted). `sovereign-egress.test.ts` needed no such
  change: its endpoints are built with a 2s timeout.
- **`EgressRefusal` takes one detail object, not three positional arguments**, matching
  `RpcFailure(detail)` and `TransportError(detail)` in this same package. Three positional
  strings-and-a-number at a call site would be exactly the shape that gets transposed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The falsification test could not reach its own assertion inside vitest's default timeout**

- **Found during:** Task 2, first run after inverting the assertion
- **Issue:** `sovereign-execution.test.ts`'s falsification test dispatches through a
  `RemoteExecutor` whose `RpcEndpoint` has `timeoutMs: 5_000`. Before this plan the reply
  arrived promptly and the test finished in milliseconds. Under the refusal the reply frame
  is refused on the responding leg, `rpc.ts` swallows the failure by design, and the
  requestor only resolves when its own 5s timeout fires — at or past vitest's 5s default
  test timeout. The observed failure was `Test timed out in 5000ms` at the `it(...)` line,
  not the assertion the test is about.
- **Fix:** Added an explicit `20_000` ms budget to that one `it(...)`, and a comment saying
  why, cross-referencing the responding-leg cost `egress.ts` states.
- **Files modified:** `packages/net/src/sovereign-execution.test.ts`
- **Verification:** the test now reports the assertion it is about. Under Mutation A it
  failed at `expect(outcome.ok).toBe(false)`; under Mutation B at
  `expect(manifest.violations).toContain('alice-row')`. Both inside the budget.
- **Committed in:** `49aa7be`

---

**Total deviations:** 1 auto-fixed (1 blocking, test-timing only)
**Impact on plan:** None on scope. Every `<action>` in all three tasks was executed as
written; the budget is the mechanical consequence of the plan's own intended behavior
change meeting a default the plan did not know about.

## Issues Encountered

**The plan predicted five inverted assertions; the count is five, but they are distributed
across seven assertion sites.** `egress.test.ts` contributed four inversions (three
`violations` reads that became `rejects.toBeInstanceOf(EgressRefusal)` plus the second send
in `resets without losing the guarded set`), `sovereign-egress.test.ts` one, and
`sovereign-execution.test.ts` one. That is six, not five, because the plan's `<objective>`
counted the two integration inversions as one item while its Task 2 `<action>` describes
both. No assertion was inverted that the plan did not name, and none the plan named was
left alone.

**Nothing outside `packages/net` and the one known-red file changed behavior.** The full
suite's red set is exactly `{egress-manifest.node.test.ts DATA-05 :117}`. No regression was
found, and nothing was adjusted away.

## Next Phase Readiness

- Plan 13-05 can now prove the job outcome: a refused reply produces
  `verification.status === 'insufficient'` and `JobResult.complete === false` at the
  `FabricNode` level, which is already observable in this plan's own full-suite output.
  It owns `egress-manifest.node.test.ts:117` and must invert it.
- Plan 13-06 owns the two records `egress.ts`'s new comment *points at* rather than
  restates: the constraint the unconditional block-serving rule places on redundant
  sovereign execution, in `.planning/PROJECT.md` and against the Phase 19 roadmap entry. If
  13-06 does not land them, the comment points at nothing.
- Plan 13-07 owns the gap `egress.ts` now names in full: `#guarded` is never released, so
  this plan knowingly moved an unbounded, lifetime-growing set onto the path that decides
  whether a frame may leave. Releasing each registration once its reply frame has settled
  bounds the scan set by in-flight sovereign tasks instead of node uptime.
- **Not closed by this plan, and not claimed:** the responding leg still tells a dispatcher
  only that the dispatch failed, never why. That is written into `egress.ts` as an accepted
  cost with the reason it was accepted, so a later reader finds a decision rather than an
  oversight.

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-28*

## Self-Check: PASSED

All six modified files present. All three task commit hashes (`811b820`, `ad5e993`,
`49aa7be`) verified present in `git log`. `EgressRefusal` verified exported from
`packages/net/src/index.ts:40`. `packages/net/src/egress.ts` verified clean after the third
mutation revert. `vocabulary.node.test.ts` and `purity.node.test.ts` re-run with this
summary staged and therefore inside the scan's own jurisdiction: 38/38 passing.

`.planning/STATE.md` and `.planning/ROADMAP.md` were not touched by this plan — they belong
to the orchestrator and to Plan 13-06 respectively.
