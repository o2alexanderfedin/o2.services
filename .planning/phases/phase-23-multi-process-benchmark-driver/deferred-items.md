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
