---
status: resolved
trigger: "packages/node/src/late-combine.node.test.ts — 2 failed / 2267 passed in a full --project node run at load 68.45. Both failures are expect(arrived).toBe(true), MR-04 and MR-07. Passes alone. Fix must be a within-run calibration, not a bigger constant."
created: 2026-08-05T23:05:00Z
updated: 2026-08-17T11:55:00Z
resolved_by: adbd17e
---

## Current Focus

status: CLOSED. The hypothesis below was confirmed **structurally, by reading**, and the fix
is committed as `adbd17e` ("fix(test): one node's rpc budget was bounding a map it was sited
against a combine for"), refined since by `38ce0f0`, `52b821f`, `aee2f62`. `next_action` is
discharged — the read it asked for is recorded under Evidence 2026-08-17.

hypothesis: The red is NOT `expect(arrived).toBe(true)`. Both failures are `expect(result.job.complete).toBe(true)` inside `runMap` — the map precondition — which carries the identical assertion text `expected false to be true`. The map did not complete because the submitter's `rpcTimeoutMs: 1500` also bounds each cold map `exec` dispatch (module pull + WASM compile), and that cost moves with load while 1500 does not.
test: read `submitJob` to establish what makes `complete` false; then reproduce under synthesised load and instrument which shard/dispatch failed
expecting: a shard with fewer than 1 agreeing replica after every executor's exec dispatch hit the 1500 ms correlation timeout
next_action: none — closed

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

- timestamp: 2026-08-17T11:52:00Z
  checked: whether the hypothesis' two structural claims hold, read from source rather than timed
  found: |
    Both claims hold, and neither needed a stopwatch.

    CLAIM A — `rpcTimeoutMs` is a node-wide budget that bounds every `exec` dispatch:
      - `net/src/rpc.ts:144` `readonly #timeoutMs: number` — one per endpoint.
      - `net/src/rpc.ts:150-152` set once in the constructor,
        `options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS`. Never reassigned.
      - `net/src/rpc.ts:179` `async request(to, body)` — **no per-call override parameter**.
      - `net/src/rpc.ts:186-189` the rejection timer fires on `this.#timeoutMs`, raising
        `RpcFailure({ kind: 'timeout', afterMs: this.#timeoutMs })`.
      - `net/src/remote-executor.ts:160` `execute()` dispatches `kind: 'exec'` through that
        very `request`, and `:161-164` converts the throw into
        `{ ok: false, reason: 'dispatch to <id> failed: …' }`.
      So a map `exec` and a combine RPC share one budget by construction. Confirmed.

    CLAIM B — a timed-out dispatch starves the shard and falsifies `complete`:
      - `core/src/job/submit.ts:78-79` states it in the file's own words: *"At redundancy 2
        with one executor dead it returns `agreed` with `replicas: 1` — a shard that
        silently got less redundancy than it asked for."*
      - `core/src/job/submit.ts:3204` `degraded: … (settled.status === 'agreed' ?
        settled.replicas < spec.redundancy : placementDegraded)` — replicas short of
        redundancy sets `degraded`.
      - `core/src/job/submit.ts:3312-3313` `complete: shards.every((s) =>
        s.verification.status === 'agreed' && !s.degraded && !s.disagreed)` — `complete` is
        a conjunction that `degraded` alone defeats.
      So one late `exec` → `ok:false` → `replicas < redundancy` → `degraded:true` →
      `complete === false`, with the shard still reading `agreed`. Confirmed — and it
      explains why the failure never presented as a disagreement.
  implication: |
    The hypothesis is established without a timing run, which is the stronger evidence: the
    coupling is a property of the types, not of the day's load. Load only decides how often
    the 1500 ms budget is exceeded, never whether exceeding it can break `complete`.

- timestamp: 2026-08-17T11:53:00Z
  checked: whether host load permitted a timing reading — measured as CPU share of THIS process, not load average
  found: |
    /usr/bin/time -p on a 3 s CPU-bound node busy loop, exit code read on the next line
    (EXIT=0): real 3.05, user 2.33, sys 0.03 ⇒ (user+sys)/real = **0.774**.
    Machine context beside it: 8 logical CPUs, load average 9.58 / 10.46 / 16.76, a linker
    at 183% CPU, two sibling agents. Load average did NOT predict the share, exactly as the
    Measurement convention warns.
  implication: |
    **A timing reading was NOT taken, and the reason is the opposite of the obvious one: the
    host is not loaded ENOUGH to be diagnostic.** This file's own Resolution records the
    reproduction regimes as CPU share 0.533-0.551 (48 burners) and 0.298-0.321 (96 burners).
    At 0.774 the host sits ABOVE both — in the quiet regime, which was green *before* the fix
    as well as after. A run taken now therefore cannot discriminate fixed from unfixed: a
    green would be the null result the unfixed tree also produced, and a red would be
    unattributable. That is a comparative reading (my share against this file's recorded
    regimes, same derived ratio, same units), not an absolute threshold.
    Second, independent blocker: **this worktree has no `node_modules`**, and the standing
    rule forbids symlinking it wholesale from the main checkout, because that verifies the
    main checkout rather than this tree.
    Conclusion: the structural route above carries the finding; nothing here rests on a span
    that was not measured.

- timestamp: 2026-08-17T11:54:00Z
  checked: whether the fix is still live in the tree three commits after it landed
  found: |
    Present and load-bearing in `packages/node/src/late-combine.node.test.ts`:
      - `:634` `RPC_TIMEOUT_MS = 1_500` — unmoved, as the fix promised.
      - `:671` `MAP_RPC_TIMEOUT_MS = 15_000`, `:688` `MAP_DISPATCH_MARGIN = 3`,
        `:704` `SEND_BUDGET_MARGIN = 2`.
      - `:730` a second `mapper: FabricNode`, stood up at `:770-778` on the map budget;
        `:844` wraps each `RemoteExecutor` over `fabric.mapper.rpc` in `timedExecutor`.
      - Live guards, not prose: `:1280` + `:1286` (MR-04) and `:1422` + `:1423` (MR-07)
        assert `MAP_RPC_TIMEOUT_MS > slowestExecMs * MAP_DISPATCH_MARGIN` and
        `sendWindowMs < DEFAULT_SEND_TIMEOUT_MS / SEND_BUDGET_MARGIN`.
  implication: |
    The 2026-08-05 Evidence entry demanded a calibrator for MR-07, which then had none.
    Lines 1422-1423 supply it, so that gap is closed rather than descoped. Subsequent
    commits `38ce0f0`, `52b821f`, `aee2f62` refined the surrounding measurement guards and
    left the budget split intact.

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

closed: |
  2026-08-17. The `status:` field read `investigating` until today while the Resolution above
  was already complete and already committed — the session was finished but never marked. The
  bookkeeping is the only thing this session changed in the source tree; no code was touched.

  What today added is the part the 2026-08-05 `next_action` asked for and never recorded: the
  hypothesis had been confirmed by *reproduction* (4/8 red at 96 burners) but not by *reading*.
  It now has both. `rpc.ts:144/150-152/179/186-189` + `remote-executor.ts:160-164` establish
  that one endpoint has exactly one correlation budget and that `exec` rides it;
  `submit.ts:78-79/3204/3312-3313` establish that a short replica count sets `degraded` and
  that `degraded` alone defeats `complete`. Those are properties of the types, so they hold at
  every load — which is why the structural route is the stronger evidence and why closing this
  did not require putting the host back into the failing regime.

  No timing reading was taken today, and the honest reason is recorded in Evidence: at CPU
  share 0.774 the host is above both regimes in which this defect reproduces, so a run would
  have had no diagnostic power in either direction.

  Not verified today, and deliberately: that the fix still passes under load. That claim rests
  on the runs recorded under `verification` above (5/5 exit 0 at 48 burners, share 0.533-0.551)
  and on the three later commits, not on anything measured on 2026-08-17.
