---
phase: phase-14-signed-artifact-resolution
plan: 01
subsystem: security
tags: [ed25519, signed-names, provenance, executor-adapter, content-addressing]

# Dependency graph
requires:
  - phase: phase-4
    provides: "signName / SignedNameResolver / NameRecord — signature, anchor, expiry and monotonic-version checks, complete and unreached since Phase 4"
  - phase: phase-12
    provides: "guardSovereignty — the Executor-adapter shape this module copies, and the precedent for an optional Task field that is non-optional in effect"
provides:
  - "Task.moduleRecord?: NameRecord — the field a signed record travels in"
  - "guardModuleProvenance(inner, provenance) — an Executor adapter that refuses before inner.execute is reached"
  - "ModuleRefusal / describeModuleRefusal — three refusal variants and their wording"
  - "ModuleProvenance — a pinned resolver plus a required now() thunk"
  - "Three planted mutations watched failing, captured verbatim below"
affects: [phase-14-plan-03, phase-14-plan-04, phase-15-capability-chains, phase-21-aot]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Refusal guards are Executor adapters, not Executor methods — the port never grows"
    - "A refusal test asserts the inner executor's call counter, not only the reason string"
    - "Mutations are planted and reverted by cp from a scratch baseline, never by git"

key-files:
  created:
    - packages/core/src/executor/module-provenance.ts
    - packages/core/src/executor/module-provenance.test.ts
  modified:
    - packages/core/src/ports.ts
    - packages/core/src/index.ts

key-decisions:
  - "The CID mismatch is NOT a sixth ResolveFailure variant: resolution succeeded, so the failure belongs to the dispatcher, not to the resolver's own failure type"
  - "The guard calls accept() per dispatch rather than resolve(), inheriting rollback protection instead of reimplementing it"
  - "ModuleProvenance.now is required and is a thunk — a node that read the clock once at construction would keep running an expired record for as long as it stayed up"
  - "No exempt case: unlike guardSovereignty, DET-03 carries no label qualifier, so public work is guarded identically"

patterns-established:
  - "Counter-in-every-test: the assertion that separates 'reported a refusal' from 'refused'"
  - "Two distinct fixture CIDs derived by MemoryBlockstore.put, never hand-written, so the substitution case is about two modules rather than two literals"

requirements-completed: []

# Metrics
duration: 22min
completed: 2026-07-31
---

# Phase 14 Plan 01: Signed Artifact Resolution — the mechanism Summary

**`guardModuleProvenance` — an `Executor` adapter that refuses a bare CID, an unpinned signer, a forged signature, an expired record, a replayed older version, and a genuine record that vouches for a different artifact, each without the wrapped executor ever being called; proven by eight behaviours against a real `SignedNameResolver` and by three planted defects watched failing.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-31T13:21:00Z
- **Completed:** 2026-07-31T13:43:00Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `Task` can carry a `NameRecord`, by a type-only import that creates no runtime edge and no cycle.
- `guardModuleProvenance` refuses in three named ways before `inner.execute` is reached, and returns the inner outcome by identity when it does not.
- The check a valid signature does not make — `accepted.cid` versus `task.moduleCid` — is present, and is the one whose deletion no other check in the system catches.
- The whole suite runs unchanged under `node`, Chromium, Firefox and WebKit (DET-07), because the module is pure.
- Three defects planted, run, captured verbatim and reverted by `cp`; `packages/core` is 367 tests green under `node` and 1104 under three browser engines afterwards.

## Task Commits

1. **Task 1: `Task.moduleRecord`** — `b7d7a17` (feat)
2. **Task 2 (RED): the eight behaviours, failing** — `c2cf4a0` (test)
3. **Task 2 (GREEN): `guardModuleProvenance` + barrel export** — `f1db0fe` (feat)
4. **Task 3: plant / watch / capture / revert** — no source commit by design; the mutations were reverted, and their captures are below.

## Files Created/Modified

- `packages/core/src/executor/module-provenance.ts` — the adapter, its three refusal variants, and the module comment recording why the mismatch case does not live in `naming.ts`.
- `packages/core/src/executor/module-provenance.test.ts` — eight behaviours, every one reading the inner executor's call counter.
- `packages/core/src/ports.ts` — `Task.moduleRecord?: NameRecord`, plus the type-only import and the comment saying where the field is actually required.
- `packages/core/src/index.ts` — `guardModuleProvenance`, `describeModuleRefusal`, `ModuleProvenance`, `ModuleRefusal` exported from `@o2/core`.

## Decisions Made

**The mismatch case is local to this module, not a sixth `ResolveFailure`.** 14-CONTEXT.md Risk 2 left this open and named the alternative a reader will expect. The usual argument for widening `ResolveFailure` — that an exhaustively-switched union makes every consumer fail loudly until updated — buys nothing here, because `ResolveFailure` has exactly one consumer, `describeResolveFailure`, in the same file. There is no distant switch to make fail. The cost is real: it would place a variant `SignedNameResolver` can never itself return inside the resolver's own failure type, which is a false statement about that type. And the mismatch is not a resolution failure at all — resolution succeeded; the *dispatcher* attached a record for a different artifact. So it lives with the code that can detect it, as `ModuleRefusal`.

**`accept` per dispatch, not `resolve`.** `accept` verifies against the pinned anchors, checks expiry, checks the monotonic version and stores. Calling it on every dispatch is what makes the rollback behaviour a property of this guard without a line of rollback code in it. `resolve` would only read back what an earlier call had stored, and there is no earlier call — nothing on this path ever hands the resolver a record except that one line. The test that pins this reads `expect(inner.calls).toBe(1)` after two dispatches: a guard that used a throwaway resolver, or read with `resolve`, reads 2.

**`ModuleProvenance.now` is required and is a thunk.** Required for `capability.ts`'s stated reason — injected so verification is deterministic in tests and needs no clock port — and a thunk rather than a number because expiry is decided per dispatch. A node that captured the clock at construction would keep executing an expired record for its whole uptime.

**No exempt case.** `guardSovereignty` is a no-op for `label: 'public'`. DET-03's criterion has no label qualifier, so this guard has no equivalent early return, and the public path is guarded identically.

## Mutation captures — Task 3

**What these are and are not.** They are a one-time demonstration, recorded on 2026-07-31, that this guard's tests can fail. No command re-derives them on a later run, so they are **not** a standing guarantee and must not be cited as one. What stands on every later run is the eight behaviours in `module-provenance.test.ts` — each of which reads the inner executor's call counter, so any real deletion of a check turns them red with nobody planting anything.

Baseline taken once, before anything was planted:

```
$ cp packages/core/src/executor/module-provenance.ts "$TMPDIR/o2-14-01-baseline.ts"
```

Each mutation was reverted with `cp` from that copy and confirmed with `cmp` before the next was planted. `git checkout`, `git restore`, `git stash`, `git reset`, `git add` and `git commit` were not used on this file during the task.

### Mutation A — the anchor check deleted

`guardModuleProvenance`, the failed-resolution arm changed to fall through instead of refusing:

```ts
      const accepted = provenance.resolver.accept(record, provenance.now())
      if (!accepted.ok) {
        return inner.execute(task)     // was: return refuse({ kind: 'unresolvable', ... })
      }
```

```
$ npx vitest run --project node packages/core/src/executor/module-provenance.test.ts

 ❯ |node| packages/core/src/executor/module-provenance.test.ts (8 tests | 4 failed) 41ms
     × refuses a perfectly-signed record from a key that was never pinned 7ms
     × refuses a record altered after signing 6ms
     × refuses a genuine record that has expired at the supplied clock 6ms
     × refuses a replay of an older version of a name it has already seen higher 10ms

 FAIL  |node| packages/core/src/executor/module-provenance.test.ts > DET-03 — a module runs only when a signed record vouches for it > refuses a perfectly-signed record from a key that was never pinned
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/core/src/executor/module-provenance.test.ts:119:24
    117|     const outcome = await guarded.execute(taskFor(moduleCid, inputCid,…
    118|
    119|     expect(outcome.ok).toBe(false)
       |                        ^
    120|     expect(reasonOf(outcome)).toContain(impostor.pub)
    121|     expect(reasonOf(outcome)).toContain('not a pinned trust anchor')

 FAIL  |node| packages/core/src/executor/module-provenance.test.ts > DET-03 — a module runs only when a signed record vouches for it > refuses a replay of an older version of a name it has already seen higher
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/core/src/executor/module-provenance.test.ts:224:23
    222|
    223|     expect(first.ok).toBe(true)
    224|     expect(second.ok).toBe(false)
       |                       ^
    225|     expect(reasonOf(second)).toContain('offered version 1')
    226|     expect(reasonOf(second)).toContain('already known')

 Test Files  1 failed (1)
      Tests  4 failed | 4 passed (8)
```

Four tests, exactly the four the plan predicted: untrusted signer, bad signature, expired, rollback. **One correction to the plan's prediction, stated rather than glossed:** the plan expected the counter readings of 0 to be seen becoming 1. They were not, because `expect(outcome.ok).toBe(false)` precedes the counter assertion in each of these tests and fires first, so the counter line is never reached. The counter's independent contribution is what Mutation C isolates, and it is isolated there rather than here.

Reverted by `cp` from the baseline; `cmp` silent; `git status --short` empty.

### Mutation B — the CID comparison deleted

`guardModuleProvenance`, step 3 removed entirely:

```ts
      // deleted:
      // const signed = accepted.cid.toString()
      // const dispatched = task.moduleCid.toString()
      // if (signed !== dispatched) return refuse({ kind: 'cid-mismatch', ... })
      return inner.execute(task)
```

```
$ npx vitest run --project node packages/core/src/executor/module-provenance.test.ts

 ❯ |node| packages/core/src/executor/module-provenance.test.ts (8 tests | 1 failed) 34ms
     × refuses a genuine record that vouches for a different artifact, naming both CIDs 6ms

 FAIL  |node| packages/core/src/executor/module-provenance.test.ts > DET-03 — a module runs only when a signed record vouches for it > refuses a genuine record that vouches for a different artifact, naming both CIDs
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/core/src/executor/module-provenance.test.ts:167:24
    165|     const outcome = await guarded.execute(taskFor(moduleCid, inputCid,…
    166|
    167|     expect(outcome.ok).toBe(false)
       |                        ^
    168|     expect(reasonOf(outcome)).toContain(otherCid.toString())
    169|     expect(reasonOf(outcome)).toContain(moduleCid.toString())

 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

**This is the mutation that matters most, and the count is why.** Exactly one test fails, and the other seven stay green — because under this defect every signature still verifies, every anchor is still pinned, every expiry is still fresh, and every version is still monotonic. There is no other check anywhere in the system that would notice. A reader who believes "the record verified" is a sufficient condition for running a module is reading the exact failure this mutation produces: a genuine, correctly-signed record for `other-kernel` authorising the execution of a module it never named.

Reverted by `cp` from the baseline; `cmp` silent; `git status --short` empty.

### Mutation C — the no-record check moved after execution

`guardModuleProvenance`, the refusal still returned but the module allowed to run first:

```ts
      if (record === undefined) {
        await inner.execute(task)      // planted
        return refuse({ kind: 'no-record', moduleCid: task.moduleCid.toString() })
      }
```

```
$ npx vitest run --project node packages/core/src/executor/module-provenance.test.ts

 ❯ |node| packages/core/src/executor/module-provenance.test.ts (8 tests | 2 failed) 32ms
     × refuses a bare CID, naming the CID and the record that did not arrive 5ms
     × reports which node refused, and carries the inner executor nodeId 1ms

 FAIL  |node| packages/core/src/executor/module-provenance.test.ts > DET-03 — a module runs only when a signed record vouches for it > refuses a bare CID, naming the CID and the record that did not arrive
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ packages/core/src/executor/module-provenance.test.ts:100:25
     98|     // Reporting a refusal and refusing are different events. This is …
     99|     // says the module's bytes were never fetched, let alone instantia…
    100|     expect(inner.calls).toBe(0)
       |                         ^
    101|   })

 FAIL  |node| packages/core/src/executor/module-provenance.test.ts > DET-03 — a module runs only when a signed record vouches for it > reports which node refused, and carries the inner executor nodeId
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ packages/core/src/executor/module-provenance.test.ts:265:25
    263|     const outcome = await guarded.execute(taskFor(moduleCid, inputCid))
    264|     expect(reasonOf(outcome)).toContain('node-zeta')
    265|     expect(inner.calls).toBe(0)
       |                         ^

 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

**What this separates.** Both failures are the counter, and only the counter — `expect(reasonOf(outcome)).toContain('signed name record')` and the CID assertion above it both still pass, and `toContain('node-zeta')` on line 264 still passes. "The refusal was reported" and "the module never ran" are two different guarantees. Under this defect the first holds perfectly and the second is gone, and nothing but `expect(inner.calls).toBe(0)` can tell. A suite that asserted only on refusal wording would have certified this code as correct. Two tests fire rather than the one the plan predicted, because the eighth behaviour (the node-id one) also dispatches a record-less task; that is the same defect seen twice, not a second one.

Reverted by `cp` from the baseline; `cmp` silent; `git status --short` empty.

### After the third revert

```
$ cmp "$TMPDIR/o2-14-01-baseline.ts" packages/core/src/executor/module-provenance.ts   # silent
$ git status --short                                                                    # empty
$ npx tsc --noEmit                                                                      # exit 0
$ npx vitest run --project node packages/core
 Test Files  24 passed (24)
      Tests  367 passed (367)
$ npx vitest run --project browser packages/core
 Test Files  75 passed (75)
      Tests  1104 passed (1104)
```

`git status --short` showed no changes outside this plan's own files at any point, so nothing belonging to another agent was touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The worktree had no `node_modules`, and a naive symlink would have type-checked the wrong sources**

- **Found during:** Task 1 (before the first `tsc` run)
- **Issue:** The execution worktree was created without an install, so `npx tsc` and `npx vitest` could not run at all. Symlinking the main checkout's `node_modules` wholesale would have run, and would have been worse than failing: `node_modules/@o2/core` there is a relative symlink to the *main* checkout's `packages/core`, so every cross-package `@o2/*` import would have resolved to unmodified sources and `tsc --noEmit` would have reported a clean repository without ever reading this plan's changes.
- **Fix:** Built a symlink farm — every third-party entry points at the main install, and `node_modules/@o2/*` was rebuilt to point at *this worktree's* `packages/*`. Verified by the RED run failing on `Cannot find module './module-provenance.ts'` from the worktree path, which is proof the resolver was reading worktree sources.
- **Files modified:** none tracked (`node_modules/` is gitignored; the farm is build state, not source)
- **Verification:** `npx tsc --noEmit` exit 0 on the untouched baseline before any edit, then failing/passing in step with the edits.
- **Committed in:** nothing to commit — no tracked file changed.

**2. [Rule 1 - Correction to the plan's own prediction] Mutation A does not exhibit the counter change the plan expected**

- **Found during:** Task 3
- **Issue:** The plan says of Mutation A: "Expect ... the counter readings of 0 to become 1." They do become 1 in the running code, but no assertion observes it, because `expect(outcome.ok).toBe(false)` precedes `expect(inner.calls).toBe(0)` in each affected test and aborts it first.
- **Fix:** Nothing changed in code or tests — reordering assertions to make the prediction come true would be writing the test to fit the report. The capture above states what actually happened and points at Mutation C as the place the counter's independent contribution is isolated, which it does cleanly.
- **Files modified:** none
- **Verification:** the verbatim Mutation A output above, which shows four `expected true to be false` failures and no counter failure.
- **Committed in:** this summary.

**3. [Rule 2 - Missing critical] An eighth behaviour, for the node id in the refusal**

- **Found during:** Task 2
- **Issue:** The plan specifies that every refusal carries `inner.nodeId` "for the same reason `guardSovereignty`'s refusal carries it: a dispatcher reading a `failures` entry needs to know which machine said no", and specifies `nodeId` reading `inner.nodeId` — but lists seven behaviours, none of which reads either. Both would have been unverified.
- **Fix:** Added an eighth test asserting `guarded.nodeId` and that the refusal reason names the wrapped executor's node id, with its own counter reading.
- **Files modified:** `packages/core/src/executor/module-provenance.test.ts`
- **Verification:** passes under `node` and all three browser engines; fails under Mutation C, which is how it appears twice in that capture.
- **Committed in:** `c2cf4a0` (RED) / `f1db0fe` (GREEN)

---

**Total deviations:** 3 (1 blocking, 1 correction to a stated prediction, 1 missing critical coverage)
**Impact on plan:** No scope creep. The plan's structure, decisions and file list are unchanged; one prediction inside it is corrected against what was measured, which is the discipline the plan itself asks for.

## Issues Encountered

- Host load average was 65 during execution. Nothing here is timing-sensitive — every clock is an injected thunk over a fixed constant and no test has a wall-clock bound — so no reading in this summary is load-dependent. The durations quoted in the captures are incidental and are not offered as measurements of anything.

## Requirements

`requirements-completed` is deliberately **empty**, and DET-03 / DATA-08 are **not** marked complete. The plan closes them only "in part": nothing is wired. No production entry point composes this guard, and the plan says so in its own words — "This plan deliberately claims nothing about the live path." Marking the requirements complete here would assert a property of the dispatch path that does not hold until Plans 14-03 and 14-04 land.

## Known Stubs

None. Every export is reached by a test, no placeholder values are returned, and no data source is left unwired — because this plan wires nothing by design, which is a stated boundary rather than a stub.

## User Setup Required

None.

## Next Phase Readiness

- **14-03** can wrap `packages/node/src/fabric-node.ts`'s serving executor with `guardModuleProvenance`, and add the resolver census. The adapter's signature is `(inner: Executor, provenance: ModuleProvenance) => Executor`; composing it with `guardSovereignty` needs no ordering decision at the type level, but note that whichever is outermost is the one whose node id appears in the reason string.
- **14-04** can wrap the whole `worker ?? new WasmExecutor(...)` expression in `packages/browser/src/browser-node.ts`, which is what covers the `WorkerExecutor` arm — the one the demo actually ships, and the one that resolves its own `blockstore.get(task.moduleCid)` on the main thread.
- **The three resolution sites remain three.** Nothing in this plan changed that, and nothing here verifies it either; 14-03 Task 3's census is what turns the figure into a re-read rather than a quotation.
- **Concern, unresolved and belonging to 14-04:** 14-CONTEXT.md Risk 1 stands untouched. `packages/demo/src/kernel.ts`'s bundle-embedded bytes have no signed record, and DET-03 has no public-path exemption for them to fall under. Whoever wires the browser tier has to produce that record or state explicitly why the demo is exempt.

---
*Phase: phase-14-signed-artifact-resolution*
*Completed: 2026-07-31*
