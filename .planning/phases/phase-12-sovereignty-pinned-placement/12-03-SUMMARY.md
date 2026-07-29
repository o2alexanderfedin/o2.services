---
phase: phase-12-sovereignty-pinned-placement
plan: 03
subsystem: scheduling
tags: [sovereignty, placement, submitJob, bin-agent, real-process, mutation-testing, typescript]

# Dependency graph
requires:
  - phase: phase-12-sovereignty-pinned-placement
    plan: "01"
    provides: "submitJob wired through planPlacement/eligibleNodes, ShardSpec union, JobSpec.nodes"
  - phase: phase-12-sovereignty-pinned-placement
    plan: "02"
    provides: "guardSovereignty and the in-process load-pressure discrimination proof this plan closes the process-boundary gap for"
  - phase: phase-12-sovereignty-pinned-placement
    plan: "04"
    provides: "guardSovereignty wired into fabric-node.ts's single executor-construction point, with a safe cleared-for-nobody default — the reason alice's spawned process needed an explicit clearance flag to actually execute"
provides:
  - "packages/node/src/sovereignty-placement.node.test.ts — the real cross-process placement proof ROADMAP criterion 1 literally names ('a job submitted through bin/agent.ts'), closing the one gap the Phase 12 verification pass found (3/4 → 4/4)"
  - "bin/agent.ts --owner-id/--can-execute-sovereign CLI flags, a straight pass-through to the existing FabricNodeOptions.sovereignty option"
affects: [phase-13-egress-manifest, phase-16-reduce-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-OS-process sovereignty proof: spawn(process.execPath, [AGENT, ...]) three times (one owner, two foreign), submitJob over RemoteExecutor/RpcEndpoint exactly as two-process.node.test.ts (NET-01) already proves for the non-sovereignty case — reused verbatim rather than re-derived"
    - "CLI clearance flag as a straight pass-through, not a new mechanism: --owner-id/--can-execute-sovereign on bin/agent.ts sets the identical FabricNodeOptions.sovereignty object a production operator would set; omitting it keeps fabric-node.ts's existing safe default (cleared for nobody)"

key-files:
  created:
    - packages/node/src/sovereignty-placement.node.test.ts
  modified:
    - packages/node/src/bin/agent.ts

key-decisions:
  - "bin/agent.ts needed a new CLI surface not named in the plan's <files_modified> — the plan assumed the FabricNode.start() sovereignty option was reachable from the spawned binary; it is not, since bin/agent.ts only ever exposed --dir/--port. Without a way to clear alice's process for herself, every dispatch to alice would refuse via fabric-node.ts's own unconditional guardSovereignty wrap (Plan 12-04), and the test could never observe 'agreed' at all. Added --owner-id/--can-execute-sovereign as a direct pass-through to the option that already exists on FabricNodeOptions — not a new mechanism, not a node-kind branch (every agent process has identical capability; this only sets which owner one process happens to be cleared for), so treated as Rule 3 (auto-fix blocking issue) rather than Rule 4 (architectural change requiring a decision)."
  - "Bob's two processes are spawned with no sovereignty flag at all — bin/agent.ts's existing safe default (cleared for nobody). This is deliberate, not an oversight: the NodeDescriptor set handed to submitJob still marks both bob nodes canExecuteSovereign: true (so the only thing excluding them from placement is ownership, not clearance — see the discrimination note below), while the real bob processes carry the actual production default. This gives the test two independent layers to fail through, and the mutation run below shows both actually held."
  - "Real bin/agent.ts spawn via node:child_process spawn(process.execPath, [AGENT, ...]), copied verbatim from two-process.node.test.ts's spawnAgent/stopAgent scaffolding per the plan's own <interfaces> section, rather than a shared cross-file test utility — matches the established per-file helper convention every other *.node.test.ts in this package already follows."

patterns-established: []

requirements-completed: [DATA-03, DATA-04]

# Metrics
duration: ~45min
completed: 2026-07-27
---

# Phase 12 Plan 03: Sovereignty-Pinned Placement Across Real `bin/agent.ts` Processes Summary

**A sovereign job submitted through `submitJob` and dispatched to three genuinely separate `bin/agent.ts` operating-system processes places its map task only on the owner's process — never on either of two idle foreign processes, even with the owner's process described as saturated — closing the one gap (3/4 → 4/4) the Phase 12 verification pass found.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-27 (this session)
- **Completed:** 2026-07-27
- **Tasks:** 1
- **Files modified:** 2 (1 created, 1 modified)

## Why this ran late

This plan was skipped by the orchestrator (dispatched in neither Wave 2 nor Wave
3) while 12-01, 12-02, and 12-04 all landed and were merged. The Phase 12
verification pass (`.planning/phases/phase-12-sovereignty-pinned-placement/12-VERIFICATION.md`)
found exactly this gap: criterion 1's mechanism was real and mutation-verified
in-process, but the roadmap's literal evidentiary form — "a job submitted
through `bin/agent.ts`" — had zero coverage, because this plan had never been
executed. `12-04-SUMMARY.md`'s "Next Phase Readiness" section had incorrectly
cited "placement discrimination (12-02/12-03)" as joint evidence before the
verification pass caught and corrected that claim. This plan is the fix.

## Accomplishments

- `packages/node/src/sovereignty-placement.node.test.ts` spawns three real
  `bin/agent.ts` child processes (`alice`, `bob1`, `bob2`) via
  `spawn(process.execPath, [AGENT, ...])` — the identical mechanism
  `two-process.node.test.ts` already proves for the non-sovereignty case (NET-01)
  — plus a submitter `FabricNode` in the test process itself.
- The test dials all three, persists `MODULE_WRITES_PARTITION` at the submitter,
  and calls `submitJob` with one sovereign `ShardSpec` (`ownerId: 'alice'`),
  `nodes:` three `NodeDescriptor`s built from each process's real `peerId` —
  alice's saturated (`load: 1`), both bob's idle (`load: 0`) and, deliberately,
  `canExecuteSovereign: true` too, so the only thing excluding them from
  placement is ownership, never clearance.
- Asserts `result.ok === true`, `verification.status === 'agreed'`, and
  `verification.agreeing` is exactly `[alice.peerId]` — never either bob peer id
  — despite alice's descriptor being the "expensive" choice by every load
  signal a naive scheduler would react to.
- `bin/agent.ts` gained `--owner-id`/`--can-execute-sovereign` CLI flags (see
  Deviations) so the spawned `alice` process could actually be cleared to
  execute its own sovereign task; the `bob1`/`bob2` processes are spawned with
  no flag at all, keeping the real production default (cleared for nobody).
- Mutation-tested per the execution context's explicit `<mutation_required>`
  directive (the plan text itself judged a new mutation unnecessary, but the
  orchestrator's brief for this specific run required it) — see Mutation Test
  Results below. The mutation's real output is a **stronger** failure signature
  than 12-02's in-memory version: it shows the placement layer and the real
  process's own independent serving-side guard both had to hold for the leak
  not to occur, and here the placement layer alone fails while the serving-side
  guard catches it.
- Full suite: `npx tsc --noEmit` clean; `npx vitest run` → **117 files / 1759
  tests passing** — up from the measured-independently baseline of 116 files /
  1758 tests (net +1 file, +1 test, exactly this plan's one new test). Nothing
  went pass→fail.

## Task Commits

Each task was committed atomically:

1. **Task 1: Spawn three real agent.ts processes and prove sovereignty-pinned placement survives the OS-process boundary** - `7680fd5` (test)

**Plan metadata:** (this commit, following SUMMARY.md)

## Files Created/Modified

- `packages/node/src/sovereignty-placement.node.test.ts` - the real cross-process placement proof; spawns three genuine `bin/agent.ts` child processes and proves `submitJob`'s sovereignty discrimination survives the OS-process boundary
- `packages/node/src/bin/agent.ts` - adds `--owner-id`/`--can-execute-sovereign` CLI flags, a direct pass-through to `FabricNodeOptions.sovereignty`

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: the plan as written
assumed the real spawned `bin/agent.ts` process could somehow be handed a
sovereignty clearance; it could not, because that binary only ever exposed
`--dir`/`--port`. Without fixing this, the test's own success criterion
(`verification.status === 'agreed'`) would be structurally unreachable — alice's
own process would refuse its own owner's task via `fabric-node.ts`'s
unconditional `guardSovereignty` wrap (landed in Plan 12-04, after this plan was
originally written). Treated as Rule 3 (auto-fix blocking issue): the fix is a
direct pass-through of an option that already exists on `FabricNodeOptions`, not
a new mechanism, and does not create a node kind — every agent process built by
`bin/agent.ts` has identical capability regardless of whether the flag is
passed, satisfying the hard constraint "ALL NODES HAVE EQUAL FUNCTIONALITY."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `--owner-id`/`--can-execute-sovereign` CLI flags to `bin/agent.ts`**
- **Found during:** Task 1, while writing the spawn helper for alice's process
- **Issue:** The plan's `<files_modified>` names only the new test file, implicitly assuming `FabricNode.start()`'s `sovereignty` option was already reachable from the spawned binary. It was not — `bin/agent.ts` (as it exists today, after Plan 12-04 landed `guardSovereignty` into `fabric-node.ts`'s single executor-construction point with a safe cleared-for-nobody default) only parses `--dir`/`--port`. Without a way to clear alice's spawned process for herself, `RemoteExecutor(alice.peerId, ...).execute(sovereignTask)` would be refused by alice's own process — the test's central assertion (`verification.status === 'agreed'`) could never be reached, only ever `'insufficient'`, no matter how correct the placement logic was.
- **Fix:** Added `--owner-id <string>` and `--can-execute-sovereign` (boolean) to `bin/agent.ts`'s `parseArgs` call, passed through as `FabricNodeOptions.sovereignty` only when `--owner-id` is supplied; omitting it keeps the existing safe default unchanged. `bob1`/`bob2` are spawned with neither flag, so their processes carry the real production default.
- **Files modified:** `packages/node/src/bin/agent.ts`
- **Verification:** `npx tsc --noEmit` clean; the new test passes with alice's process genuinely accepting its own owner's sovereign task over real RPC, and fails in the documented direction under the required mutation (see below).
- **Committed in:** `7680fd5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking issue, Rule 3)
**Impact on plan:** Necessary for the plan's own stated success criterion to be reachable at all. No scope creep — the flag is a direct pass-through of an option that already existed on `FabricNodeOptions`, not a new mechanism, and every agent process retains identical capability.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Mutation Test Results (the execution context's explicit deliverable)

The plan's own `<objective>` text argues a new mutation is unnecessary here
("re-planting it against three real child processes would prove the same fact
more slowly for no new evidence"). The execution context this plan was actually
run under (`<mutation_required>`) explicitly overrides that and requires it, so
it was run.

**Baseline measured before the mutation:** `npx tsc --noEmit` clean; `npx vitest
run` → 117 files / 1759 tests, all passing.

**Mutation — planted the "widen-under-pressure" branch in `submit.ts`'s
placement loop** (`packages/core/src/job/submit.ts`, inside the per-shard
placement pass): after computing the initial placement, if every chosen node's
load is `>= 0.9`, re-run `planPlacement` with the request's `label` forced to
`'public'` and use that widened placement instead — the exact forbidden branch
`sovereignty.ts`'s module comment says must not exist ("no fallback branch, no
'if nothing suitable is available' clause").

```ts
    let plan = planPlacement([request], nodesForShard)
    let placement = plan.placements[0] as Placement
    if (placement.status === 'placed') {
      const chosenLoad = Math.min(
        ...placement.nodeIds.map((id) => nodesForShard.find((n) => n.nodeId === id)?.load ?? 0),
      )
      if (chosenLoad >= 0.9) {
        const widened = planPlacement([{ ...request, label: 'public' as const }], nodesForShard)
        plan = widened
        placement = widened.placements[0] as Placement
      }
    }
```

`npx tsc --noEmit` — clean.

`npx vitest run packages/node/src/sovereignty-placement.node.test.ts`:

```
 ❯ |node| packages/node/src/sovereignty-placement.node.test.ts (1 test | 1 failed)
     × places a sovereign shard only on the owner's process, never on an idle
       foreign process, under load pressure engineered to force relocation

AssertionError: expected 'insufficient' to be 'agreed'
Expected: "agreed"
Received: "insufficient"
 ❯ packages/node/src/sovereignty-placement.node.test.ts:183:40
    expect(shard?.verification.status).toBe('agreed')
```

**The real output, captured with a throwaway debug harness before reverting**
(never committed, deleted immediately after use):

```json
{
  "ok": true,
  "job": {
    "shards": [{
      "partitionIndex": 0,
      "verification": {
        "status": "insufficient",
        "reason": "every executor failed",
        "failures": [{
          "nodeId": "12D3KooWC1p8Mc7pNfsYPjyHnkpHNppRr19RcLzfDSZiAVXDgGY6",
          "reason": "sovereignty violation: node 12D3KooWC1p8Mc7pNfsYPjyHnkpHNppRr19RcLzfDSZiAVXDgGY6 is not cleared to execute sovereign data for owner alice"
        }]
      },
      "degraded": false
    }]
  }
}
```

**What this shows, and why it differs from Plan 12-02's in-memory transcript:**
with the mutation applied, `eligibleNodes` widened to every node once alice's
descriptor read as saturated, and least-loaded-first tie-broken by peer id chose
`bob2` (a genuinely idle, genuinely foreign, real OS process) over alice — the
placement layer alone leaked exactly as the mutation intends. But `bob2`'s own
process is a real `bin/agent.ts` instance with no `--owner-id` flag, so
`fabric-node.ts`'s unconditional `guardSovereignty` wrap (Plan 12-04) refused
the dispatch at the serving side before it ever reached `WasmExecutor`. The
job did not silently leak alice's data to bob's process; it surfaced as
`insufficient`, a stalled shard, rather than `agreed` with the wrong node's id
in `agreeing` — 12-02's in-memory `honest()` fixture has no `guardSovereignty`
wrap at all, so its version of this same mutation genuinely executed on the
foreign node and produced `agreed` with the wrong peer id. This run proves the
same placement-layer defect 12-02 proves, plus incidentally confirms the
second, independent defense (12-04's serving-side guard) catches what the first
layer would otherwise have let through — which is the real production
composition, not a simplification of it.

**Reverted:** `git checkout -- packages/core/src/job/submit.ts`. Confirmed
byte-identical to `HEAD` (`git diff packages/core/src/job/submit.ts` produced no
output). `npx tsc --noEmit` clean. `npx vitest run
packages/node/src/sovereignty-placement.node.test.ts packages/core/src/job/submit.test.ts`
→ 53/53 passing again. `git status --short` after the revert shows only this
plan's two intended files, nothing from the mutation or the debug harness.

## Verification (deliverables requirement)

```
$ npx tsc --noEmit
(clean, no output)

$ npx vitest run
 Test Files  117 passed (117)
      Tests  1759 passed (1759)
   Duration  285.25s

$ npx vitest run packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts
 Test Files  2 passed (2)
      Tests  38 passed (38)
```

117/1759 vs. the stated baseline of 116/1758 — exactly +1 file, +1 test, this
plan's one new test file with one test. Nothing went pass→fail. Vocabulary and
purity guards run after this SUMMARY was written and pass 38/38.

**The mechanism used to cross the process boundary:**
`child_process.spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs])`
where `AGENT` resolves to `packages/node/src/bin/agent.ts` via
`fileURLToPath(new URL('./bin/agent.ts', import.meta.url))` — three genuinely
separate operating-system processes, each running its own `FabricNode`, sharing
nothing with the Vitest process or each other except a TCP socket dialed after
each process announces its peer id and multiaddrs over a one-line stdout
handshake. This is the identical mechanism `two-process.node.test.ts` already
uses and proves for NET-01's non-sovereignty case; nothing new was invented,
per the plan's own `<interfaces>` instruction to reuse it verbatim.

## Next Phase Readiness

- ROADMAP criterion 1 is now proven at both the mechanism level (Plan 12-02, in
  one Vitest process) and the roadmap's literally-named evidentiary level (this
  plan, across three real `bin/agent.ts` operating-system processes). Phase 12
  is now 4/4 against the verification pass's criteria.
- `bin/agent.ts`'s new `--owner-id`/`--can-execute-sovereign` flags are
  available to any later phase's deployment tooling that needs to start a real
  agent process pre-cleared for an owner, without reaching into
  `FabricNode.start()` directly.
- No blockers.

---
*Phase: phase-12-sovereignty-pinned-placement*
*Completed: 2026-07-27*

## Self-Check: PASSED

Confirmed present on disk: `packages/node/src/sovereignty-placement.node.test.ts`,
`packages/node/src/bin/agent.ts` (diff confirmed via `git diff HEAD~1 HEAD`),
this SUMMARY. Commit `7680fd5` confirmed present in `git log --oneline`.
`vocabulary.node.test.ts`/`purity.node.test.ts` run after this SUMMARY was
written, 38/38 passing.

```
FOUND: sovereignty-placement.node.test.ts
FOUND: bin/agent.ts
FOUND: 12-03-SUMMARY.md
FOUND: 7680fd5
```
