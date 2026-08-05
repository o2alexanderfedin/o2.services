# Deferred items — Phase 23

Out-of-scope discoveries logged during execution. Nothing here was fixed.

## 2026-08-05, during 23-02

- **Two orphaned `orphan-leash.node.test.ts` driver processes**, pids 89890 and 90017,
  started `Wed Aug 5 01:57:23` and `01:57:25` — roughly ten hours before this plan ran, from
  a session that is not this one. Both are the `agent-leashed.mjs` / `agent-unleashed.mjs`
  driver scripts that file writes to a temp directory and that hold `setInterval` open by
  design, not agent processes. `pgrep -f "agent\.ts --dir"` returns nothing, so no
  `bin/agent.ts` survives. The `agent-unleashed` one is the file's declared control and is
  *supposed* to outlive its parent; the `agent-leashed` one surviving is the interesting
  half, and it is unexplained. Not touched: killing another session's processes is a
  shared-tree hazard, and neither is caused by this plan's changes.

- **`packages/core/src/job/submit.ts`'s `placeAgain` docblock cites the deleted
  `coordinator.ts`.** Already recorded in `23-CONTEXT.md`'s deferred list; restated here
  because it was still present in the tree read on 2026-08-05.

## 2026-08-05, during 23-01 — four live `tsc` errors this plan caused and may not fix

23-01 made `RunConfig.driver`, `RunConfig.fixture` and `RunConfig.leg` **required**, which
is the plan's central `must_haves` truth. Four `RunConfig` object literals elsewhere in the
tree therefore no longer type-check. **None of the two files is in 23-01's
`files_modified`, and this executor was instructed not to touch a file outside that list
even to fix something obviously wrong.** So `npx tsc --noEmit` exits **1** for the whole
repository, with exactly these four errors and no others:

```
packages/bench/src/perf-workload.ts(316,3)  — gateConfig
packages/node/src/bin/bench.ts(1477,9)      — memory ladder
packages/node/src/bin/bench.ts(1503,11)     — real ladder
packages/node/src/bin/bench.ts(1535,5)      — skew rung
```

**The remedy is three added properties per literal**, and the values are determinate today
because every one of these rungs is an in-process, trivial-fixture, public-leg run:

```ts
driver: 'in-process',
fixture: 'trivial',
leg: 'public',
```

- **`bin/bench.ts`'s three** belong to **Plan 23-03**, which owns that file and whose task
  is exactly to supply these call sites. No action needed beyond doing 23-03.
- **`perf-workload.ts`'s one, in `gateConfig`, is owned by nobody in this phase.** No
  Phase 23 plan names the file. It is the one that will otherwise stay broken, and it is
  the item this entry exists for. It is exercised by `--project perf`, not `--project
  node`, so no node-tier suite reports it; only a whole-tree `tsc` does.

Neither file was edited and neither figure was changed.

## 2026-08-05, during 23-03 — the driver does not exit after a rung that threw

**Measured, isolated, and pre-existing — nothing this plan added causes it.**

A full run of `bin/bench.ts` (no flags, temp cwd) writes both output files, prints its
closing line, and then **never exits**. The process sat alive for 11 minutes 40 seconds
after the write before it was killed. No agent process survived — `pgrep -f "agent.ts
--dir"` returned nothing — so the spawned children are disposed correctly and it is the
driver's own event loop that will not drain.

**Attribution by measurement rather than by plausibility.** The run was repeated with the
speedup sweeps switched off entirely (`SPEEDUP_LADDER = []`), a one-rung memory ladder and
`REAL_LADDER = [16]` — that is, with **none** of Plan 23-03's new code executing and only
the one rung that is known to fail. It wrote its report and was still running 200 s later.
So the cause is on the pre-existing path.

**The mechanism, read from source rather than guessed.** `realFabric` starts N `FabricNode`s
in a loop and returns the rig at the end. When construction throws part-way — which is what
the real-transport 16-node rung does, on `connect ECONNRESET` — the rig object is never
returned, so `runnerFor`'s cache never receives it and `dispose()` never stops the nodes
that did start. They keep libp2p handles open for the rest of the process's life.
`processFabric` does not have this defect: Plan 23-02 gave it an `undo` path on partial
construction, for exactly this reason, and stated so in its summary.

**Why it was not fixed here.** It is not caused by this plan's changes, and the repair is a
`try`/`finally` around `realFabric`'s whole body — a function that three committed guards
read by name and by call-site shape, in the most contended file in the repository, at the
end of a plan that already rewrote a third of it.

**Who it blocks, and it does.** **Plan 23-05 produces the published run**, and the published
ladder contains the rung that throws. That run will write its artifact and then hang, so
whoever drives it needs to know the exit is not a signal. **Plan 23-04 owns the excluded-rung
path in `main()`** and is the natural place for the repair, since it is already editing the
`catch` that publishes the excluded row.

**What is NOT affected.** A `--quick` run exits 0 — its `REAL_LADDER` is `[1, 2]` and no rung
throws — which is why `coverage-agents.node.test.ts` has never seen this. And a run aborted
by `HarnessIntegrityError` exits **1** promptly, because an uncaught rejection terminates the
process whatever handles are open; both integrity plants below confirmed that.

## 2026-08-05, during 23-03 — the node test-file count drift was already over tolerance

`slow-specs/file-count-drift` reads **157** node test files against a recorded **150**,
tolerance **5**. It was already at 156 — one over — before this plan added a file, and was
reported then as "outside this commit". Two of the surplus files are untracked and belong to
another agent: `job-entry-points.node.test.ts` and `opt-in-only-sources.node.test.ts`.

Re-taking `MEASURED_NODE_SPANS` needs a quiet host by the guard's own procedure; the one-minute
load average was 79 throughout this plan's execution with two other agents active. Spans taken
under that would be spans nobody measured under the conditions claimed. Left for whoever can
get the host quiet. `bench-driver.node.test.ts`'s own span, for that pass: **446 ms** reported,
`real 1.79 user 0.86 sys 0.24` alone at load 79 — below the 1000 ms cutoff, so not an exclusion.
