---
status: investigating
trigger: "packages/node/src/late-combine.node.test.ts — 2 failed / 2267 passed in a full --project node run at load 68.45. Both failures are expect(arrived).toBe(true), MR-04 and MR-07. Passes alone. Fix must be a within-run calibration, not a bigger constant."
created: 2026-08-05T23:05:00Z
updated: 2026-08-05T23:05:00Z
---

## Current Focus

hypothesis: The red is NOT `expect(arrived).toBe(true)`. Both failures are `expect(result.job.complete).toBe(true)` inside `runMap` — the map precondition — which carries the identical assertion text `expected false to be true`. The map did not complete because the submitter's `rpcTimeoutMs: 1500` also bounds each cold map `exec` dispatch (module pull + WASM compile), and that cost moves with load while 1500 does not.
test: read `submitJob` to establish what makes `complete` false; then reproduce under synthesised load and instrument which shard/dispatch failed
expecting: a shard with fewer than 1 agreeing replica after every executor's exec dispatch hit the 1500 ms correlation timeout
next_action: read packages/core/src/**/submit-job to find where `complete` is set and what a timed-out dispatch does to a shard

## Symptoms

expected: `expect(arrived).toBe(true)` at both sites — a `res` frame from the resumed victim within 15 s
actual: `arrived === false` at both sites, only in a full `--project node` run at load 68.45
errors: `expected false to be true` × 2 (MR-04 arrival case, MR-07 harmlessness case)
reproduction: full `npx vitest run --project node` at high load; passes alone at load 11-12 (3/3, real 12.94 user 11.38 sys 1.91, ratio 1.03)
started: not a regression from today's work — the sibling ratio assertion `RPC_TIMEOUT_MS > healthyCombineMs * TIMEOUT_MARGIN` (defect #46's fix) held at load 68; the un-gated absolute 15_000 beside it broke

## Eliminated

## Evidence

- timestamp: 2026-08-05T23:05:00Z
  checked: the two failing sites by symbol
  found: MR-04 `const arrived = await waitFor(() => repliesFrom(watch.frames, victimId, timedOutAt).length > 0, 15_000)`; MR-07 `const arrived = await waitFor(() => repliesFrom(watch.frames, victimId, reduceReturnedAt).length >= victimAsks.length, 15_000)`
  implication: both are wall-clock absolutes. MR-04 has `healthyCombineMs` in scope (floor of six cold combines). **MR-07 samples no cold combine at all** — it has no calibrator in scope today. Any fix must supply one for MR-07 as well.

## Resolution

root_cause: |
  The red is `expect(result.job.complete).toBe(true)` inside `runMap` — NOT `expect(arrived).toBe(true)`.
  Both assertions produce the identical text `expected false to be true`; only the stack frame
  distinguishes them, and the report conflated them.

  Direct evidence from the reported failing run (/tmp/verify_all.txt, 2 failed / 2267 passed):
    ❯ runMap packages/node/src/late-combine.node.test.ts:533:31
       533| expect(result.job.complete).toBe(true)
    ❯ packages/node/src/late-combine.node.test.ts:746:17   (MR-04's runMap call)
    ❯ packages/node/src/late-combine.node.test.ts:880:17   (MR-07's runMap call)
  and `grep "criterion 6 /" /tmp/verify_all.txt` exits 1 — the arrival print (which runs BEFORE
  `expect(arrived)`) never executed. The arrival assertion and the defect-#46 ratio assertion
  (line 850, after line 828) were both unreached, so "the ratio assertion did not fail" is vacuous.

  Mechanism: the submitter's `rpcTimeoutMs: 1500` is a NODE-WIDE correlation budget. It bounds
  the map's cold `exec` dispatches (module pull + WASM compile + execute) as well as the combine.
  Under load one of a shard's two dispatches exceeds 1500 ms, the shard settles `agreed` at
  `replicas: 1` of 2, `degraded: true`, and `complete` (a conjunction over every shard) is false.
  Reproduced on demand at 96 CPU burners; every shortfall reads
  `shard N agreed replicas 1/2 degraded true disagreed false` — never a disagreement, never a
  non-agreed shard.
fix: |
  Split the one correlation budget into two, because one node has exactly one
  (`RpcEndpoint.#timeoutMs` is fixed at construction; `request` takes no per-call override):
    - `standUp` now starts a second requestor, the `mapper`, on `MAP_RPC_TIMEOUT_MS = 15_000`;
      `runMap` dispatches through it. `RPC_TIMEOUT_MS` stays 1_500 — no constant was raised.
    - `runMap` wraps each `RemoteExecutor` in `timedExecutor` (the two-member `Executor` port)
      and returns every dispatch span, so the term the budget must cover is measured.
    - New within-run guard: `MAP_RPC_TIMEOUT_MS > slowestExecMs * MAP_DISPATCH_MARGIN (3)`.
    - New upper-bound guard: `sendWindowMs < DEFAULT_SEND_TIMEOUT_MS / SEND_BUDGET_MARGIN (2)`,
      importing the transport constant rather than restating 20_000. This stops the first
      guard being satisfied by raising a budget until the late reply stops arriving.
    - `runMap` names its shortfall (shard, status, replicas, degraded, disagreed, spans)
      instead of `expect(...).toBe(true)`, so it can never again be read as the arrival red.
    - The arrival assertions carry a message naming `frames from the paused peer`, which
      distinguishes an aborted send (`[]`) from a process that ran and did not finish.
verification: |
  Reproduced before the fix at 96 burners: 4/8 trials red at the map precondition, every
  short shard reading `agreed replicas 1/2 degraded true`.
  After the fix, /usr/bin/time -p, exit code read on the next line:
    - quiet: exit 0 (repeatedly)
    - 48 burners, CPU share 0.533-0.551 (the regime matching the load-68 failure): 5/5 exit 0,
      slowest exec dispatch 1389-1718 ms — each above or at the old 1500 ms budget
    - 96 burners, CPU share 0.298-0.321: 6/8 exit 0; the 2 reds are the PRE-EXISTING
      TIMEOUT_MARGIN floor guard (floor 224/234 ms > 150 ms), not the map precondition.
      Floor >150 ms rate before 3/6 vs after 2/8 — unchanged, not a regression.
  Plants, each watched red then restored:
    - MAP_DISPATCH_MARGIN 3 -> 300: "expected 15000 to be greater than 53387.28" (both cases)
    - SEND_BUDGET_MARGIN 2 -> 40: "expected 1686.97 to be less than 500" / "3185.45"
    - MAP_RPC_TIMEOUT_MS -> 60: named shortfall renders, "32 of 32 exec dispatches failed,
      spans [59..62]ms against rpcTimeoutMs 60" — censored at the budget, same signature
    - resume withheld: "no late reply; frames from the paused peer [] — empty means the send
      was aborted, non-empty means it ran and did not finish"
files_changed:
  - packages/node/src/late-combine.node.test.ts
