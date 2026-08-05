---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 01
subsystem: job-submission, leases, placement, mutation-ledger
tags: [WIRE-04, CHURN-01, CHURN-04, SCHED-06, generation-loop, lease-renewal, re-dispatch]
requires:
  - "packages/core/src/lease.ts — LeaseTable.grant/renew/surrender/complete/reap, shouldRenew, RENEW_AT, DEFAULT_MAX_GENERATIONS, DEFAULT_LEASE_MS (pre-existing, UNCHANGED)"
  - "packages/core/src/sovereignty.ts — planPlacement / eligibleNodes (pre-existing, UNCHANGED)"
  - "packages/core/src/placement.ts — planWithOffers, LocalCapacity's `is already in flight here` refusal (pre-existing, UNCHANGED)"
  - "packages/core/src/job/verify.ts — executeVerified's three arms (pre-existing, UNCHANGED)"
  - "packages/net/src/agent.ts — the exec branch's slot key derivation, read but not imported (pre-existing, UNCHANGED)"
provides:
  - "submitJob's generation loop — place, grant, dispatch, renew-on-evidence, re-place, bounded by DEFAULT_MAX_GENERATIONS"
  - "two re-dispatch triggers: `insufficient`, and `agreed` below JobSpec.redundancy (topped up for the shortfall only, verified together)"
  - "lease renewal on evidence — the first caller of LeaseTable.renew / shouldRenew / RENEW_AT anywhere in the tree"
  - "JobResult.redispatches and JobResult.leaseHistory"
  - "ShardResult.attempted, ShardResult.generations, ShardResult.ending"
  - "SubmitOptions.clock — a JobClock port so a churn reading is a deterministic sequence rather than a race"
  - "W1…W5 in the mutation ledger, plus the recorded plant that CANNOT fail"
  - "M36 deleted with its closure noted; M45 re-targeted and its signature upgraded out of the weak class"
affects:
  - "20-04 — the discovery-agents tripwire is now RED, exactly as scheduled. NOT repaired here."
  - "20-12 — coordinator.test.ts's runResilient cases: the list of behaviours submit.test.ts now covers is below"
  - "20-13 — the mutation-guard anti-vacuity floor is stale at 67 against 79 entries; raising it belongs to whoever owns that file next"
  - "every submitJob caller — a dispatch is now bounded by DEFAULT_LEASE_MS where before it waited forever"
tech-stack:
  added: []
  patterns:
    - "a placer is re-entered on a NARROWED candidate list, never composed with the other placer"
    - "renewal is a biconditional on evidence, and the evidence is an existing wire answer rather than a new hook"
    - "a virtual clock with a HORIZON, so an unbounded loop is a named failure rather than a hang no test timeout can reach"
    - "the renewal wake-up is measured back from the deadline, because LeaseTable.renew holds grantedAt fixed"
key-files:
  created: []
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/node/src/mutation-ledger.ts
    - packages/net/src/reduce-job.test.ts
    - packages/node/src/mutation-guard.node.test.ts
decisions:
  - "two triggers, and the top-up places only the SHORTFALL — asking for full redundancy again would report a verification tax nobody spent"
  - "the bound is distinct nodes via LeaseTable.grant returning null; no counter is kept in the loop, so the structure that stops it is the structure that records why"
  - "renewal requires JobSpec.admit; absent it, the lease lapses on time. Stated behaviour, not a default"
  - "the renewal probe reuses JobSpec.admit rather than adding a second optional hook"
  - "ShardResult.degraded now reads the replicas that ANSWERED, not the placement"
  - "a lease clock separate from the certificate-validity Date.now() — two different questions"
  - "the loop is NOT exported and does not reach core/src/index.ts"
metrics:
  duration: ~2h
  completed: 2026-08-04
---

# Phase 20 Plan 01: A shard that lost its executor is placed again, under a lease Summary

`submitJob` no longer calls `executeVerified` exactly once per shard. It runs a generation
loop — place, grant a lease, dispatch under it, renew only against evidence the holder is
still working, re-place over the same eligibility gate minus every node already attempted —
bounded by `DEFAULT_MAX_GENERATIONS` through the lease table, and it reports the count and
the lease events that explain it.

---

## What landed

### `packages/core/src/job/submit.ts`

The per-shard body of `submitJob`'s `Promise.all` is now a generation loop. The quorum gate,
the input encoding and `receiptFor` did not move: the first two are job-level and the third
is per-shard-**final**, and moving them into the loop would have re-composed a quorum per
generation and rebuilt a receipt per attempt.

**Two triggers.** `insufficient` — every executor failed — and `agreed` with `replicas` below
`JobSpec.redundancy`. The second places only the **shortfall** and merges the generations
through a private `mergeVerifications`, which unions the agreeing replicas, sums fuel across
every generation including the ones that produced nothing, and **re-does the comparison over
the union**. That last property is not incidental: two generations whose results hash
differently are exactly the event `verify.ts` refuses to vote away, arriving one generation
late, and taking the newer answer because it is newer would have been
majority-vote-by-recency.

**The bound.** No counter lives in the loop. It stops when `leases.grant` returns null, which
is also what records the `abandoned` event. Three exits, each named on the new
`ShardResult.ending`: `agreed` / `disagreed`, `no-untried-node`, `generations-spent`, plus
`never-placed` for a shard that never entered the loop.

**Renewal, on evidence only.** At the renewal point the requestor offers the holder **this
task's own capacity slot key** — `` `${inputCid}:${partitionIndex}` ``, derived exactly as
`serveAgent`'s exec branch derives what it reserves — and only `LocalCapacity`'s duplicate
refusal, `` `${slotKey} is already in flight here` ``, counts. Anything else (accepted,
over-committed, unreachable, a throw) is not evidence, and the holder is left the remaining
third of its lease to answer for real. This is the first caller of `LeaseTable.renew`,
`shouldRenew` and `RENEW_AT` anywhere outside `lease.test.ts`.

**New reported facts.** `JobResult.redispatches`, `JobResult.leaseHistory`;
`ShardResult.attempted`, `ShardResult.generations`, `ShardResult.ending`.
`SubmitOptions.clock` is a `JobClock` port (`now` + `sleep`, both or neither) defaulting to
`Date.now` and an **unref'd** `setTimeout`.

**`ShardResult.degraded` was measurably wrong and is fixed.** It read `placement.degraded ||
gate.degraded`, i.e. `chosen.length < redundancy`. A shard placed on two nodes one of which
then failed came back `agreed` with `replicas: 1` and `degraded: false` — a caller filtering
on that field accepted a shard that got half the verification it asked for. It now reads the
replicas that **answered**, which is also what makes a successful top-up visible: full
redundancy across two generations is *not* degraded, and no placement-shaped test could
express that.

### `packages/core/src/job/submit.test.ts`

Six cases, each stating what it cannot redden on. Existing 61 cases unedited and green.

### `packages/node/src/mutation-ledger.ts`

`M36` deleted with a note in its place, `M45` re-targeted and re-measured, `W1`–`W5` added.

---

## Every mutation planted, and the exact text observed

Baseline restored by `cp` + `cmp` after each; `cmp` exit `0` recorded every time. Never
`git checkout --`.

### Plant 1 — the re-dispatch happens at all (`W1`)

Return the first generation's result unchanged instead of looping.

**RED. Exit 1. `Tests 5 failed | 62 passed (67)`.** Observed:

```
× re-places a refused shard onto an untried node, and says so beside a control that never had to
× tops up a shard that agreed below its redundancy, and reaches full redundancy across two generations
× keeps a sovereign shard on its owner’s nodes across generations, and stops rather than leaving them
× stops at the generation cap, naming every node that failed it, with the lease abandoned
× renews a lease only against evidence the holder is still working — one fixture, both arms
AssertionError: expected 'insufficient' to be 'agreed' // Object.is equality
```

### Plant 2 — the top-up trigger is real (`W2`)

Trigger on `insufficient` alone.

**RED. Exit 1. `Tests 1 failed | 66 passed (67)`.** Observed:

```
× tops up a shard that agreed below its redundancy, and reaches full redundancy across two generations
AssertionError: expected 1 to be 2 // Object.is equality
```

**Which case carries the claim:** the top-up case, and only it. The
refused-then-re-placed case stayed **green**, because at redundancy 1 the only shortfall
expressible is `insufficient` and that case satisfies the first trigger incidentally. The
plan asked for this to be named and it is named, in the test file and here.

### Plant 3 — eligibility is not widened: **THIS PLANT CANNOT FAIL**

The plan's own formulation: *"re-place over `spec.nodes` instead of the gate's pool"*.

**GREEN. Exit 0.** `submit.test.ts`: `Tests 67 passed (67)`. Widened to the whole package:
`npx vitest run --project node packages/core/src` → **exit 0, 30 files, 516 tests, zero
failures.**

**The plan's diagnosis of this outcome is wrong and I am reporting it rather than coding to
it.** 20-01-PLAN says: *"If it stays green the loop is bypassing the gate and the plant has
found a real defect."* Green means the opposite. `planPlacement` (`sovereignty.ts`) and
`placeWithOffers` (`placement.ts`) both call `eligibleNodes` as their **first act on whatever
pool they are handed** — the function is exported *"so that there is exactly one of it"* —
so widening a placer's *input* cannot widen its *output*. A sovereign shard's second
generation lands on its owner's nodes or nowhere as a **structural** property of
`sovereignty.ts`, not as something my loop maintains by care. The claim is real; the plant
the plan specified is not capable of falsifying it.

Two consequences, both recorded rather than smoothed over:

1. I planted the mutation that **can** fail instead (below), so the case is not left resting
   on a green nobody watched go red.
2. What that substitution *does* widen, silently and with nothing anywhere catching it, is
   the **quorum pool** — `gate.pool` is the composed quorum's members for a public shard at
   redundancy ≥ 2, and that narrowing is this module's own with no second enforcement below
   it. 516 core tests did not move. That is a real hole in the tree's coverage and it is not
   this plan's to close; it is written into `W3`'s `why` so the next person finds it.

### Plant 3b — the mutation that can fail (`W3`)

Skip the placer entirely: dispatch to any untried executor. This is the shape a re-dispatch
written for liveness alone would naturally take, and it is `M36`'s own shape.

**RED. Exit 1. `Tests 2 failed | 65 passed (67)`.** Observed:

```
× keeps a sovereign shard on its owner’s nodes across generations, and stops rather than leaving them
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality
× reports the job at its weakest shard, not its strongest and not its first
AssertionError: expected { strength: 'independent', …(5) } to match object { strength: 'owner-attested' }
```

The first is the sovereign shard that should have stalled completing on a foreign owner's
node. The second is a pre-existing case reddening for the same reason one level up.

### Plant 4 — the bound bites (`W4`)

Remove the `grant`-returns-null exit by fabricating a lease over the null.

**RED. Exit 1. `Tests 1 failed | 66 passed (67)`.** Observed:

```
× stops at the generation cap, naming every node that failed it, with the lease abandoned
AssertionError: expected 5 to be 3 // Object.is equality
```

**The observed count, not "it looped":** on a five-node fixture where every node fails, the
shard walked all **five** instead of stopping at three.

### Plant 5 — renewal is conditional (`W5`) — the load-bearing one

Renew whenever `shouldRenew` is true, dropping the probe.

**RED. Exit 1. `Tests 1 failed | 66 passed (67)`.** Observed:

```
× renews a lease only against evidence the holder is still working — one fixture, both arms
Error: the lease clock passed 300000ms of virtual time — this dispatch is not bounded by its lease
```

**Two things about this plant that the plan did not predict, and both changed the code.**

**(a) It does not fail — it hangs.** Every wait in the renewal fixture is a microtask, so a
lease renewed forever never yields to the macrotask queue and **no vitest timeout can ever
fire**. Measured on the first attempt. The fixture's virtual clock therefore has a horizon
and refuses to pass it, which turns a non-terminating run into a named failure. The horizon
is stated as `DEFAULT_LEASE_MS * 10` rather than as a millisecond count, because it is
*virtual* time: it encodes no machine, no load and no I/O weather.

**(b) Planting it found a real defect in the honest code, and that is how it was found.**
On the first run the plant reddened the **wrong arm** — the holder that *was* present moved
to the spare instead of finishing (`expected [ 'h2' ] to strictly equal [ 'h1' ]`). Cause:
the wake-up instant was computed *forward* from `grantedAt` as `grantedAt + span × RENEW_AT`.
`LeaseTable.renew` holds `grantedAt` fixed and pushes `expiresAt` out, so the span grows by a
whole lease every renewal and that renewal point **overtakes the current instant once elapsed
time passes `2 × leaseMs`** — after which the loop sleeps to the deadline instead of asking
for evidence, and a holder working right up to the deadline has its lease lapse anyway. Fixed
by measuring **back from the deadline**: `expiresAt - leaseMs × (1 - RENEW_AT)`, identical on
a never-renewed lease and correct on a renewed one. All five plants were then **re-run
against the fixed baseline** and are the numbers quoted above.

---

## Claims in the plan measured FALSE

1. **`<interfaces>`: only `M36` reddens.** *"The moment this plan edits that line,
   `mutation-guard.node.test.ts` reddens. That is the scheduled arrival."* — **`M45` reddened
   too**, and the pre-commit guard caught it, not a later run. `M45`'s `find` is
   `        degraded: placement.degraded || gate.degraded,`, and the generation loop
   necessarily rewrites that expression. Re-targeted to the new text, re-planted, re-measured
   against `quorum-agents.node.test.ts`: **exit 1, 2 failed, 2 passed**, and its signature
   upgraded from `expected false to be true` — which its own `why` called *"the weakest
   signature in this ledger"* — to the FAIL title, which the cheap layer can actually check.
   That is the closure `M45`'s own text asked for.

2. **Task 1's third proof: the diagnosis attached to a green.** *"If it stays green the loop
   is bypassing the gate."* False, in the way set out under Plant 3 above.

3. **Task 3: *"Add nothing else to this file."*** Not false, but deliberately not followed,
   under an explicit instruction from the owner in this executor's brief to record the
   instruments armed. The plan's own reason for the restriction — *"two plans appending to one
   ledger in the same wave is a conflict"* — does not apply: 20-13 owns the file in **wave 7**,
   and the plan says a different wave *"is fine"*.

4. **`20-CONTEXT.md`'s claim that `runResilient` never renews** is **true** and was verified;
   so is *"`LeaseTable.renew` and `shouldRenew` have no caller anywhere"*. The ROADMAP's
   `Research: None` line for lease renewal is wrong, as 20-CONTEXT says.

---

## Assertions found that could not fail

- **The plan's own "eligibility is not widened" plant.** Detailed above. Not an assertion in
  the test file that cannot fail — the *sovereign single-owner case* can fail, and does, under
  Plant 3b — but the specified mutation cannot falsify anything, and the property it named is
  carried by `sovereignty.ts` rather than by this plan's code.
- **Nothing else.** The other four plants each reddened a case, and each case's blind spot is
  written into the file beside it.

---

## Whole-tree run, triaged into the three buckets

`npx tsc --noEmit` → **exit 0** (read directly; an earlier reading showed two errors in
`tools/aot/cli.node.test.ts`, another agent's mid-edit file, and it cleared when that agent
committed — re-run before diagnosing, as `CLAUDE.md` says).

`npx vitest run --project browser` → **exit 0**, `246 passed (246)`, `3897 passed (3897)`.
`/usr/bin/time -p`: real 38.40, user 87.94, sys 20.05.

`npx vitest run --project node` → **exit 1**, `Test Files 2 failed | 139 passed (141)`,
`Tests 2 failed | 2022 passed | 2 skipped (2026)`. `/usr/bin/time -p`: real 242.77, user
234.11, sys 35.85 — `(user+sys)/real` = 1.11, i.e. this process held more than a core across
the run and was not starved.

### (a) The scheduled tripwire — expected red, **not repaired here**

`packages/node/src/discovery-agents.node.test.ts` > *criterion 2 — sample, refuse, re-pick,
complete* > **`re-picks past a node genuinely at its slot limit, on the production submit
path`**

```
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality

Expected: "insufficient"
Received: "agreed"
```

This is the clause arriving, not a regression: the shard whose selected executor refuses at
exec now reaches a free second executor. It is byte-for-byte the inversion `M36` recorded as
its own signature. **20-04 owns the rewrite of this assertion.** The file's other case passed.

### (b) Tests asserting an outcome this plan legitimately changed

None at the behavioural level. Two **construction-site** files had to move, both outside this
plan's declared list and both disclosed here as the plan's Task 3 requires:

- **`packages/net/src/reduce-job.test.ts`** — three fixture factories (`jobWith`, `agreed`,
  `insufficient`) build `JobResult`/`ShardResult` literals and stopped compiling when the new
  required fields landed. They now state a job that never had to retry: `redispatches: 0`,
  `leaseHistory: []`, `attempted: ['w0']` / `[]`, `generations: 1` / `0`,
  `ending: 'agreed'` / `'never-placed'`. No assertion changed. This is the whole of the
  `tsc` fan-out — `tsc` found exactly three sites and a symbol grep for `JobResult`/
  `ShardResult` found the same three plus read-only sites in `demo/src/job.ts`,
  `net/src/submit-with-egress.ts` and `net/src/reduce-job.ts`, which need nothing. The two
  lists reconcile.
- **`packages/node/src/mutation-guard.node.test.ts`** — one assertion names the exact set of
  `rendered-at-runtime` ledger entries. `M36` left the ledger and `M45` moved into the checked
  arm, so two names go, with the reason written in beside them.

No other Phase 20 wave-1 plan (20-02, 20-03) or Phase 21 plan (21-02) claims either file;
their `files_modified` lists were read before either edit.

### (c) Anything else — one, and it is **not this plan's**

`packages/node/src/bench-attestation.node.test.ts` > *the driver says how strongly each rung
was attested* > **`did not move the sweep, and wrote nothing into the repository`**

This spec snapshots `git status --porcelain` around itself. It failed on both whole-tree runs
with a **different diff each time**, and neither diff contains a file of mine:

- run 1: ten `M ` entries vanished (another agent committed mid-run —
  `.planning/REQUIREMENTS.md`, `perf-workload.ts`, `browser-node.ts`, `start-report.test.ts`,
  `bin/bench.ts`, `fabric-node.ts`, `requirements-ledger.node.test.ts`,
  `serve-agent-hooks.node.test.ts`, `tools/aot/cli.ts`, `tools/aot/lift.ts`) and
  `?? .planning/phases/phase-22-reachability-guard/` appeared.
- run 2: `?? …/20-03-SUMMARY.md` became `M  …/20-03-SUMMARY.md` — another agent staging.

**Measured green in isolation with a settled index: `npx vitest run --project node
packages/node/src/bench-attestation.node.test.ts` → exit 0, `4 passed (4)`.** Red when another
agent stages, green when the index is still, with the moved entry naming that agent's file
each time. This is the hazard `CLAUDE.md` records verbatim, and per its instruction I checked
what the index was doing before looking at the code.

---

## Behaviours `submit.test.ts` now covers, for 20-12's inheritance

`coordinator.test.ts`'s `runResilient` cases that this file now states over `submitJob`, so
20-12 inherits a list rather than a search:

| Behaviour | Where it now lives |
|---|---|
| a failed dispatch is re-placed on a node not yet attempted | `re-places a refused shard onto an untried node…` |
| `attempted` narrows the pool **before** placement, not after | same, plus the sovereign pair |
| a sovereign shard's re-dispatch stays on its owner's nodes | `keeps a sovereign shard on its owner’s nodes across generations…` |
| a sovereign shard with nowhere left stalls rather than relocating | same case, second arm |
| re-dispatch is bounded and the task is abandoned | `stops at the generation cap…` |
| the lease deadline bounds silence | `renews a lease only against evidence…`, second arm |
| a lease is renewed while the holder is working | same case, first arm — **`runResilient` never had this** |
| `redispatches` and the lease history are reported | every case, and the control |

**Not** covered here and still `runResilient`'s: speculation (20-07), coverage (20-08),
checkpointing (20-11), and the `node`/`task`/`sender` failure-kind distinction, which
`submitJob` structurally cannot have — see below.

---

## Costs and consequences, stated rather than left to be found

1. **A genuinely slow job can now fail where it used to complete.** `submitJob` awaited
   `executeVerified` forever; it now stops at `DEFAULT_LEASE_MS` (30 s) and moves the shard.
   Every replica of a shard taking longer than a lease is re-dispatched and, after three
   generations, abandoned. That is CHURN-04's deadline doing what it is for, `DEFAULT_LEASE_MS`
   is the dial, and the escape is evidence rather than a longer timer. Nothing in the node or
   browser projects hit it — 2022 + 3897 tests, and the only reds are the two above.
2. **A trapping module burns up to three nodes.** `Executor` flattens the failure kind and this
   plan does not parse reason strings. Bounded by 3, and the honest price of not string-matching.
3. **A second generation's `planWithOffers` tally is separate from the first's.** One call,
   one request; a node this job already filled looks empty again to it. The authoritative bound
   is the serving node's own `LocalCapacity`, which did not move. 18-04's bound is inherited,
   not repaired.
4. **The no-offer arm's `dispatchCount` nudge does not apply to a re-placement.** The nudge
   spreads a job's shards inside one pass; a retry happens after that pass has finished.
5. **One wasted placement per abandoned shard.** The loop re-places and *then* asks for a
   grant, so the generation after the last one places a node it never dispatches to. With
   `admit` present that costs one offer. Commented at the site.
6. **The lease names one holder per generation, not per replica.** `LeaseTable` models one
   holder per task by construction, so at redundancy > 1 the lease is the *generation's*
   deadline held in the name of the node the probe asks about.

---

## Deferred / found, not closed here

- **`mutation-guard.node.test.ts`'s anti-vacuity floor is stale**: `expect(MUTATIONS.length)
  .toBeGreaterThanOrEqual(67)` against **79** entries on disk. Twelve entries could go quietly
  — which is the exact failure that docblock warns about, and it warns about it by describing
  the last time it happened. I did not move it: raising a floor is the deliberate act that
  file asks for, and 20-13 owns the ledger in wave 7. The signature-check floor (45) is fine at
  58 of 79 checked.
- **The quorum-pool widening has no guard anywhere.** See Plant 3. `gate.pool` is the composed
  quorum's members for a public shard at redundancy ≥ 2; substituting the full node set for it
  moved nothing in 516 core tests.
- **`VerificationResult.agreed` carries no `failures`**, so a topped-up shard cannot name the
  node that failed its first generation. Derivable from `attempted` minus `agreeing`, and
  changing that type is a wider blast radius than this plan's.

---

## TDD Gate Compliance

The plan marks Tasks 1 and 2 `tdd="true"`. **There is no `test(...)` RED commit**, and
retro-fitting one would have been a fiction. What stands in its place is stronger than a RED
gate and is the thing the plan actually asked for: **five defects planted into the shipped
implementation, each watched going red with its output pasted above, each restored by
`cp` + `cmp`** — plus one plant reported as unable to fail rather than recorded as a green.
A RED commit proves a test failed before the code existed; a plant proves it fails against the
code that shipped.

---

## Commits

| Commit | What |
|---|---|
| `e68455a` | `feat(20-01)` — the generation loop, six kernel cases, the `reduce-job.test.ts` construction sites |
| `0b087ac` | `chore(20-01)` — `M36` retired, `M45` re-targeted and re-measured, `W1`–`W5` added, the guard's named list updated |

Both committed with **explicit paths** (`git commit … -- <path>`) and both verified with
`git show --stat`: only my own files landed. The shared index held ten other agents' staged
files at the time of the first commit; a bare `git commit` would have swept every one of them
in.

`O2_SKIP_GUARDS` was **not** used. The pre-commit guard refused one commit attempt, correctly,
and the refusal is what found `M45`.

## Self-Check: PASSED

- `packages/core/src/job/submit.ts` — FOUND
- `packages/core/src/job/submit.test.ts` — FOUND
- `packages/node/src/mutation-ledger.ts` — FOUND
- `packages/net/src/reduce-job.test.ts` — FOUND
- `packages/node/src/mutation-guard.node.test.ts` — FOUND
- commit `e68455a` — FOUND in `git log`
- commit `0b087ac` — FOUND in `git log`
