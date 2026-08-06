---
phase: phase-23-multi-process-benchmark-driver
verified: 2026-08-06T17:20:00Z
status: human_needed
score: 5/5 success criteria MET
overrides_applied: 0
verdict: >
  Phase 23 achieved its goal. All five ROADMAP success criteria are MET against the
  codebase and the published artifacts, verified by reading source, by re-deriving the
  published arithmetic from `.planning/bench/raw.json`, and by executing the phase's
  guards and its one behavioural spawn spec in this process. Two of the phase's own
  headline hypotheses came back FALSE and were recorded as such rather than softened,
  which is the phase working rather than failing. Nothing found here blocks Phase 24.
human_verification:
  - test: "Apply the recommended ledger edits (see 'Recommended ledger edit list')"
    expected: "BENCH-07 ticked; ROADMAP Progress gains a Phase 23 row; criterion 3 gains a dated correction note; AUTH-03's coverage prose corrected WITHOUT ticking its box"
    why_human: "The verifier is forbidden by this task's constraints to edit STATE.md, ROADMAP.md, REQUIREMENTS.md or any source file. Ticking BENCH-07 also requires a coupled edit to a guard assertion (below), which is a source change."
  - test: "Owner ruling on the criterion-3 wording correction"
    expected: "ROADMAP criterion 3 carries a dated note recording that its second disjunct's premise — 'the per-host inbound cap is still the cause' — was refuted by measurement, and that the criterion passes on its first disjunct"
    why_human: "Changing the text of a success criterion after the fact is an owner ruling, not a verifier's edit. The precedent is the existing 'Corrected 2026-08-05' note in the same criterion."
  - test: "Correct two stale claims that live in production source and will mislead Phase 22"
    expected: "`packages/net/src/remote-executor.ts`'s class comment (lines beginning 'AUTH-03: the *minting* side of this is still entry-point-unreachable') and `packages/bench/src/index.ts`'s 'Exported here with no production caller yet. Plan 23-03 supplies it' are corrected"
    why_human: "Source edits. Both are now measurably false, and the first asserts precedence over the roadmap while carrying a decision the owner overruled on 2026-07-31."
deferred:
  - truth: "AUTH-03's checkbox ticks"
    addressed_in: "Phase 22"
    evidence: "Phase 22 criterion 1 — 'every capability exported from a package barrel has a traced call path from one of the five runnable entry points'. Whether a twice-flag-gated path counts as traced is what that guard decides. ROADMAP order is 23 -> 24 -> 22."
  - truth: "BENCH-06's distinct-machine half"
    addressed_in: "Not scheduled in v1.1"
    evidence: "REQUIREMENTS.md 'Explicitly not in v1.1' table — 'The distinct-machine half is descoped and unmeasured — not met'. Confirmed untouched by this phase."
---

# Phase 23: Multi-Process Benchmark Driver — Verification Report

**Phase Goal:** The benchmark harness spawns N real operating-system processes instead of
N `FabricNode`s on one event loop, so a parallel speedup is measurable at all — and the
project's central scaling claim stops being unmeasured.

**Verified:** 2026-08-06T17:20:00Z
**Status:** 5/5 criteria MET — `human_needed` only for the ledger edits the verifier may not apply
**Re-verification:** No — initial verification. No prior `23-VERIFICATION.md` existed.

**Why this file exists.** All six plans deferred the ledger edits to verification on the
stated ground that *"a phase is done when a verifier says so, not when its plans are."*
Confirmed on disk: `git diff --name-only afef35e~1..1b2c0e0 -- .planning/REQUIREMENTS.md
.planning/ROADMAP.md .planning/STATE.md` returns **empty**. The phase touched none of the
three. This report is the verdict they were waiting for.

---

## Verification stance

Every claim below was checked against the codebase or against the published artifact. No
SUMMARY.md assertion is carried forward on trust. Where a summary and the tree disagreed,
the tree won — and two such disagreements are recorded in the findings.

**What was executed, not read** (exit codes taken with `EXIT=$?` on the next line, no pipes):

| check | result |
|---|---|
| `npx tsc --noEmit` (whole tree) | **exit 0**, zero output — 23-01's four deferred `RunConfig` errors are all closed, including `perf-workload.ts`'s `gateConfig`, which no Phase 23 plan owned |
| `npx vitest run --project node packages/bench/src/integrity.test.ts packages/bench/src/exclusion.test.ts` | exit 0, 36 tests |
| `… packages/node/src/bench-driver.node.test.ts packages/node/src/bench-results.node.test.ts` | exit 0, 25 tests |
| `… packages/node/src/acceptance-traceability.node.test.ts` | exit 0, 41 tests |
| `… packages/node/src/bench-fabric.node.test.ts` | exit 0, 2 tests, `real 3.38 user 5.52 sys 1.09` |
| `… packages/node/src/sovereign-arm.node.test.ts` | exit 0, 2 tests, `real 4.02 user 4.15 sys 0.72` |
| `… agent-handshake / checkpoint-optout-scope / serve-agent-hooks` | exit 0, 21 tests |
| `… packages/node/src/requirements-ledger.node.test.ts` | exit 0, 20 tests |
| `… packages/node/src/purity.node.test.ts packages/node/src/vocabulary.node.test.ts` | exit 0, 47 tests |

No run's duration approached its budget, so no green here is a timeout in disguise.

`bench-attestation.node.test.ts` and `discover-arm.node.test.ts` were **deliberately not
run**: both snapshot whole-tree `git status --porcelain` around themselves, and this is a
shared checkout. Their omission is named rather than absorbed.

**Probe execution:** none. `find scripts -path '*tests/probe-*'` returns nothing; this
project has no probe convention. Skipped with reason.

---

## Goal achievement — the five success criteria

| # | Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | N nodes spawns N OS processes, verified by reading child PIDs, published, and a silent in-process fallback fails the harness | **MET** | Source + published pids + a planted input I ran myself |
| 2 | Makespan at N=1 and N=8 differ on a core-saturating fixture, ratio published, finding about the fabric not the harness | **MET** | 1591.1ms → 590.0ms, **2.70×**, re-derived from `raw.json`; confounds published |
| 3 | The excluded real-transport rung either runs, or is re-excluded with a measurement showing the per-host inbound cap is still the cause | **MET** on the first disjunct — see the wording ruling | Eight-cell factorial in `raw.json`; the second disjunct's premise is **refuted** |
| 4 | Every published figure states single-process or multi-process; no figure silently replaced | **MET** | Independent section scan (12/12) + byte-identical frozen artifact |
| 5 | `bin/bench.ts` gains an opt-in sovereign leg giving `delegate`/`CapabilitySupplier` a traced call path; default curve unmoved | **MET** | A real spawned run, executed here, printing a chain-rooted line with a real peer-id audience |

**Score: 5/5.**

---

### Criterion 1 — N nodes spawns N OS processes — **MET**

**What must be true, and what carries it.**

- **N processes are actually spawned.** `packages/node/src/bench-fabric.ts` →
  `processFabric` → `spawnAll` → `spawnAgent(AGENT_PATH, dir, …)` where
  `AGENT_PATH = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))`, run through
  `spawn(process.execPath, …)`. Not a stub: 629 lines, `Promise.allSettled` so partial
  failures still register every child for `undo`, and a documented `stdio[0] = 'pipe'`
  orphan-leash requirement.

- **The PIDs are two independent readings, not one.** `AgentHandle.pid` is `child.pid`
  from `spawn`; `AgentHandle.announcedPid` is `handshake.pid`, parsed off the child's own
  stdout line. The source states the rule and the reason at the assignment:
  *"Read off the handshake, never from `child.pid`. Filling this from the parent's own
  reading would make `announcedPid === pid` true by construction and turn every caller's
  integrity check into a tautology."* Confirmed at the far end:
  `packages/node/src/bin/agent.ts` writes `pid: process.pid` with the comment
  *"`process.pid` and never a value passed in"*.

- **A fallback fails the harness rather than reporting a curve.** One consumer:
  `gateRung(…)` in `bin/bench.ts`, called once per process rung at
  `gateRung(\`process-per-node, ${nodes} nodes\`, {identity: {…}, cpu: {…}, statuses, declared, moduleCid})`,
  which concatenates four readings into `assertIntegrity` → `HarnessIntegrityError`. Every
  `catch` in the driver re-throws it (`if (cause instanceof HarnessIntegrityError) throw cause`),
  and `bench-driver.node.test.ts` holds that as a **count equality** —
  `expect(occurrences(stripped, 'instanceof HarnessIntegrityError')).toBe(catches)` with both
  counts asserted above zero — rather than a presence pattern.

**The falsification I ran rather than read.** I fed planted observations straight into
`processIdentityViolations` in a temp cwd (no tree edit):

| planted input | violations returned |
|---|---|
| a rung declaring 8 nodes with `agents: []` and an executor addressing the submitter — i.e. the exact in-process fallback | **3**, including *"no agent process was observed at all, against a rung declaring 8"* and *"the submitting node … appears among its own executors"* |
| one agent whose `announcedPid` (4242) is the driver's pid while `childPid` is 5001 | **1** — *"the process that published the address is not the process that was spawned"* |
| a clean two-agent rung | **0** |

The gate is not vacuous and it detects the named failure mode.

**The published run records them.** `.planning/BENCHMARK-RESULTS.md` §*Processes —
process-per-node driver, saturating fixture*, and the same values in `.planning/bench/raw.json`:

```
{"nodes":1,"pids":[32497],"observed":2}
{"nodes":2,"pids":[33942,33943],"observed":3}
{"nodes":4,"pids":[34928,34929,34931,34930],"observed":5}
{"nodes":8,"pids":[35534,35535,35536,35537,35538,35539,35540,35541],"observed":9}
```

Distinct within every rung, monotonically increasing across rungs. `observed = nodes + 1`
is published with its reason (the submitting node stays in the driver's process because it
holds the store, the guard and the endpoint), and the oversubscription column against 8
logical cores is published per rung rather than argued.

---

### Criterion 2 — a measurable N=1 → N=8 difference on a saturating fixture — **MET**

**The criterion asks for three things, and gets all three.**

1. *Makespan at N=1 and N=8 differ.* `1591.1ms → 590.0ms` on the process driver.
2. *On a fixture with enough work to saturate a core.* `SATURATING_N = 600`, the demo's
   colouring kernel, every one of 16 shards ending on `budget` — enforced, not remembered,
   by `fixtureUniformityViolations` inside the same gate as criterion 1, and additionally
   pinned by `fixtureProvenanceViolations`, which compares the declared fixture name against
   the **module CID the rung actually dispatched**.
3. *The ratio is published.* **2.70×** in the `speedup vs its own 1-node rung` column, beside
   a derived ideal bound of **9.78×**.

**Both figures re-derived by me from `raw.json`, not read off the report:**

- `1591.116750000001 / 590.0462919999991 = 2.70` ✓
- `calibrationPerShardMs` holds **16** entries; `sum = 1656.34ms`, `max = 169.43ms`,
  `sum / max = 9.78` ✓

**The core-saturation claim, taken comparatively rather than absolutely.** The serial sum
of the rung's own sixteen per-shard calibrations is 1656 ms; its measured 1-node makespan is
1591 ms. Serial total ≈ measured 1-node wall time, so one node's core is busy essentially the
whole rung. That is a within-run ratio, which cancels the host, the load and the I/O weather
— the reading this project's conventions ask for. Against it, the trivial fixture's 1-node
real-transport rung is 49.4 ms; the saturating fixture is ~32× more work.

**"A finding about the fabric rather than about the harness."** The methodology amendment of
2026-08-05 pre-registered the confounds *before* the data existed, and all four are published
per rung: `generations` (1 everywhere — no shard re-placed), `churn/task` (0.00),
`spec. tax` (1.00–1.06×), `speculated`, and the driver's own CPU share (0.005–0.009 on the
process rungs against 0.107–0.324 on the control). The declared ceiling of `MAX_DRIVER_CPU_SHARE
= 0.5` was fixed in the same pre-registered amendment, so it cannot have been tuned to the data.

**On the contested "half the speed" headline.** It is not in criterion 2 and never was. It
was 23-05's *hypothesis*, and 23-05 records it as **NOT REPRODUCED** across three full runs
(proc N1→N8 of 3.68× / 3.83× / 2.70× against control 3.77× / 3.76× / 3.47×; the curves
crossed twice). That does not block criterion 2, and the reason is worth stating precisely:

> **Criterion 2's ratio is a within-driver ratio. The unsettled comparison is a
> between-driver one.** The N=1→N=8 speedup on the process driver is 3.68×, 3.83× and 2.70×
> across the three runs — same sign, same order of magnitude, never near 1. It is the
> *coordination ratio* (process ÷ control, per rung) whose sign flips between runs. Criterion
> 2 asks for the first and says nothing about the second.

So criterion 2 passes on what it actually asks. See **W-1** below for the reporting-discipline
warning this leaves behind.

---

### Criterion 3 — the excluded real-transport rung — **MET, on the first disjunct**

This is the criterion the phase's own findings most obviously outran, so the ruling is
stated as a wording, not as a tick.

**The scope sub-clause is satisfied verbatim.** The criterion demanded that the two-rungs→
one-rung correction *"be stated in the published section, not absorbed."* It is, in
`BENCHMARK-RESULTS.md` §*The excluded rungs, re-measured*:

> *"Criterion 3 names two rungs, and the committed run of 2026-08-01 excluded one. … The
> scope of the criterion is therefore **one** rung, stated here rather than absorbed — a rung
> that quietly appears between the plan and the results is as unreadable as one that quietly
> vanishes."*

I verified the premise independently rather than accepting it: the frozen
`BENCHMARK-RESULTS-2026-08-01.md` carries `| 8 | 69.5ms | 122.3ms | 122.3ms | 19 | 0 | …` on
its real-transport ladder and exactly one excluded row, `real transport, 16 nodes`.

**The main disjunction, read against `raw.json`'s `criterionThree` array — the outcomes, not the prose:**

| attempt | driver | dial | cap | nodes | completed |
|---|---|---|---|---|---|
| A8 | in-process | workers→submitter | derived | 8 | **yes** (control) |
| A | in-process | workers→submitter | derived | 16 | no |
| B | in-process | workers→submitter | **pinned 5 on the receiver** | 16 | no |
| C | in-process | **submitter→workers** | derived | 16 | **yes** |
| D | process-per-node | **submitter→workers** | derived | 16 | **yes** |
| E | process-per-node | **submitter→workers** | pinned 5 on every agent | 16 | **yes** |
| F | process-per-node | workers→submitter | derived | 16 | no |
| G | process-per-node | workers→submitter | pinned 5 on the receiver | 16 | no |

- **Dial direction partitions the outcomes cleanly.** Every failure is
  `workers-to-submitter`; every success is `submitter-to-workers`.
- **Driver does not separate them.** In-process appears on both sides (A/B fail, C succeeds);
  process-per-node appears on both sides (F/G fail, D/E succeed).
- **Cap placement does not separate them.** `derived-on-every-node` appears on both sides
  (A, F fail; C, D succeed). A lever whose value appears on both sides cannot be what
  separated them.

**The published cause is dead, and I confirmed it a second way.** The 2026-08-01 exclusion
blamed `INBOUND_CONNECTION_THRESHOLD = 5` **per host**. Two independent readings retire it:
attempt D's `agentThresholds` in `raw.json` is `[15,15,…]` sixteen times, and the
`serve-agent-hooks.node.test.ts` run I executed printed
`OBSERVED default agent limits: inboundConnectionThreshold=15 maxIncomingPendingConnections=15`.
**The nodes were never running at 5.** The blamed constant was not merely non-causal; it was
not the value in force.

**Ruling.** Criterion 3 passes on its **first** disjunct — *"the real-transport rungs Phase 8
published as excluded either run"*. The 16-node real-transport rung **runs**, at 16 nodes, on
the process driver (attempt D, this phase's headline configuration), completing a real job
through `runnerOver`'s own path. Its second disjunct is not merely unsatisfied but
**refuted**: the measurement it demanded was taken, and it came back saying the cap is not the
cause. The exclusion reason in the published report is now built from the error that was
observed plus the configuration in force (`describeExclusion`, commit `ffb9c05`) and no longer
asserts a cause at all — which is the correct response to having lost one.

This is the criterion working, not failing: it asked for a measurement rather than for an
outcome, and the measurement answered. What it now needs is a dated correction note so a
future reader does not check criterion 3 against a premise the tree has retired — see **E-2**.

**Residual, recorded rather than absorbed** — see **W-2**: the published ladder still excludes
a rung the same file shows can complete, because `realFabric` still defaults to the failing
direction, and no published sentence says why that direction was retained. Two levers are
named-but-unexercised and the report says so in its own words: staggering (`stagger: none` on
every attempt) and agent-side inbound instrumentation under the inverse direction.

---

### Criterion 4 — every published figure names its driver — **MET**

**I re-ran the section scan myself** rather than trusting `bench-results.node.test.ts`'s green.
Splitting `BENCHMARK-RESULTS.md` on `^## `, classifying by the report's three figure forms, and
holding every figure-bearing section to `\b(?:in-process|process-per-node)\b` **in the heading**:

```
EXEMPT  What these numbers do NOT establish
EXEMPT  Machine inventory
OK      Makespan — memory transport, in-process driver
OK      Makespan — real transport, in-process driver
OK      Makespan — real transport, process-per-node driver
OK      Reduce tree — memory transport … in-process driver, trivial fixture
OK      Reduce tree — real transport … in-process driver, trivial fixture
OK      Configurations excluded, and why — in-process driver, trivial fixture
OK      Connectivity tax — in-process driver, trivial fixture
OK      COST crossover — in-process driver, trivial fixture
OK      Supplementary — where the time goes — in-process driver, trivial fixture
OK      Processes — process-per-node driver, saturating fixture
OK      Speedup — in-process and process-per-node drivers, fixed redundancy 1, saturating fixture
OK      The excluded rungs, re-measured — in-process and process-per-node drivers, trivial fixture
nofig   Earlier run — frozen (in-process driver, trivial fixture)
```

**12 of 12 held sections pass; 2 exemptions, both named in the guard with reasons.** The guard
is *derived* rather than a list of three known headings, so a section added later is covered
without anybody remembering to cover it — and its own anti-vacuity case asserts the population
is at least eight.

**"No figure is silently replaced" — verified by byte comparison, not by claim.**

```
git show 631459b:.planning/BENCHMARK-RESULTS.md > /tmp/old-results.md   # exit 0
diff /tmp/old-results.md .planning/BENCHMARK-RESULTS-2026-08-01.md      # exit 0, zero lines
```

The frozen artifact is **byte-identical** to the report as it stood immediately before this
phase's run overwrote it. `FROZEN_VALUES` in the guard pins five of its figures — including
`7086.14×`, which sits in plain prose with no table row and which an earlier draft of the plan
would have missed.

---

### Criterion 5 — the opt-in sovereign leg — **MET**

**Verified by execution, not by grep.** `sovereign-arm.node.test.ts` spawns the real driver
with `--quick --discover --sovereign` in a temp cwd and parses the leg's own sentence. It
passed here in `real 4.02` seconds, asserting:

- `leg.discovered === true` — the anti-vacuity reading; the sovereign shard is placeable only
  against a descriptor carrying a real owner id, and only the discover arm builds one
- `leg.submitted === 1` and `leg.agreed >= 1` — **parsed**, so `0 of 1` fails here rather than
  passing on the presence of a line
- `leg.root === EXPECTED_ROOT`, where `EXPECTED_ROOT` is re-derived **inside the test** through
  `delegate(new Uint8Array(32).fill(7), …).issuer.slice(0, 8)` rather than transcribed from the
  driver's output. A leg rooted at any other key disagrees.
- `leg.audience` matches `/^12D3Koo\w+$/` and is not the driver's word for nobody — so the
  chain was minted **for a node**, and the shard was dispatched and admitted rather than
  reported unplaceable
- `.planning/BENCHMARK-RESULTS.md` is byte-unchanged across the run, and the run wrote only
  into its temp cwd

Case 2 also passed: `--sovereign` without `--discover` exits non-zero, names **both** flags on
stderr, never prints `--sovereign:`, and creates no output directory — so the flag **refuses**
rather than implies, which is what keeps the default curve safe.

**The call path, traced in source:**

```
bin/bench.ts:  BENCH_OWNER_KEY = delegate(BENCH_USER_SEED, {…})        // @o2/core
               function sovereignSupplierFor(nodeId): CapabilitySupplier   // @o2/net type
               dispatch: SOVEREIGN ? sovereignSupplierFor : 'dispatches-unauthenticated'
  → net/discover-candidates.ts:  new RemoteExecutor(peerId, rpc,
        options.dispatch === 'dispatches-unauthenticated' ? options.dispatch : options.dispatch(peerId))
  → net/remote-executor.ts:  the supplier branch of #capability
```

Both `delegate` and `CapabilitySupplier` now have a production caller in a **runnable entry
point** (`bin/bench.ts` is one of the five Phase 22 enumerates).

**"Off by default" and "the default curve unmoved."** Structurally: every construction the leg
adds is inside `if (DISCOVER)` and inside `if (SOVEREIGN && fixture === 'trivial')`, the
clearance reaches `FabricNode.start` as a **spread rather than a field** so no `sovereignty` key
exists on the default path under `exactOptionalPropertyTypes`, and `SOVEREIGN` requires
`--discover`, which the published run had off (`sovereign=off` in every configuration row).
Empirically: 23-06 diffed masked stdout of `bench --quick` from base `7061828` against this
work, and the four differing lines are the same four that differ between **two runs of the
same binary** — freshly generated libp2p peer ids. One report line was added, and it is prose
in the section whose job is to say what a run does not establish. **No figure, table, column or
configuration row moved.**

**The eight plants that make this a proof rather than a shape.** Four against the leg (recorded
in 23-06-SUMMARY with observed text), of which plant 3 is the one that matters — the chain
minted with a *different private key* produced
`unauthorized: link 0 is issued by 1398f62c…, but the data owner's key is ea4a6c63…`, so the leg
cannot pass by producing something merely shaped like a chain. Two against the spec itself,
including deleting the leg's block, which fails Case 1 on the read.

---

## Requirements coverage

### BENCH-07 — the guard's comment is wrong and the requirement wins

**BENCH-07, quoted verbatim from `.planning/REQUIREMENTS.md`:**

> - [ ] **BENCH-07**: The benchmark harness spawns N operating-system processes rather than
>       N nodes on one event loop, and a makespan difference between N=1 and N=8 is
>       measurable on a fixture that saturates a core. Needs only separate processes on one
>       host, which Phase 8's own summary named as the cheaper remedy and Phase 12 has since
>       built the spawn pattern for. **This is the driver work; BENCH-06 is the reporting
>       discipline it runs under** — machine inventory recorded, same-machine label derived
>       and retained — **and BENCH-06's distinct-machine half is descoped and unmeasured, not
>       met.** Spawning N processes on one host does not close it and must not be published
>       as though it had: one host has one CPU, one V8 and one libc

**The contradicting guard, quoted verbatim from
`packages/node/src/acceptance-traceability.node.test.ts`:**

> ```
> // The role moved to
> // `BENCH-07`, which is late-minted and open for a reason no phase can retire on its
> // own: it needs a second machine.
> expect(locate('BENCH-07')?.satisfied).toBe(false) // v1.1 section, open
> ```

**Ruling: this is exactly the case the project's rule was written for.** *"A comment is not a
specification. When a comment and a requirement disagree, the requirement wins and the comment
gets fixed."* BENCH-07's own fourth sentence is **"Needs only separate processes on one host"**.
It does not need a second machine, it says so in the sentence that scopes it, and it names both
the reason (Phase 8's summary) and the mechanism (Phase 12's spawn pattern). The comment is
false, and it is false in the specific way the roadmap already diagnosed for this whole phase:
*"That has been read ever since as part of the BENCH-06 'needs a second machine' blocker. It is
not. … The blocker moved and nobody noticed."* The comment is the last surviving copy of the
misreading, sitting in a guard.

**Clause-by-clause against evidence:**

| clause | verdict | evidence |
|---|---|---|
| spawns N OS processes rather than N nodes on one event loop | ✓ | `processFabric`; pids published per rung; gate aborts a fallback (criterion 1) |
| a makespan difference between N=1 and N=8 is measurable | ✓ | 1591.1 → 590.0 ms, 2.70×, re-derived; same sign across all three runs |
| on a fixture that saturates a core | ✓ | serial sum 1656 ms ≈ 1-node makespan 1591 ms, a within-run ratio |
| needs only separate processes on one host | ✓ | satisfied on one host; the requirement says this is sufficient |
| BENCH-06's reporting discipline: machine inventory recorded | ✓ | §*Machine inventory* — required field, one host, real CPU/core/RAM/OS/runtime |
| same-machine label **derived**, never declared | ✓ | `isSameMachine(inventory)` / `machineLabel(inventory)` in `bench/src/report.ts`, computed from `hostCount` |
| must not be published as though the distinct-machine half closed | ✓ | stated four separate times in §*What these numbers do NOT establish*, once in words chosen for this phase specifically |

**BENCH-07 is SATISFIED.** Recommended: tick it. The coupled edit is named in **E-1** below —
ticking it turns the guard's own assertion red, which is the mechanism working (the file records
having been re-aimed twice already for exactly this reason, and calls it out: *"An id's state is
not a fixture — it changes when a verifier says so"*).

### AUTH-03 — the row's prose is STALE; the checkbox must WAIT

**The stale sentence, quoted verbatim from `.planning/REQUIREMENTS.md` line 682:**

> **The requestor half is not wired.** … all five production dispatch sites name the sentinel,
> because every one labels its shards `'public'` and a public shard has no owner key to root a
> chain at. So `delegate`, `CapabilitySupplier` and `RemoteExecutor.execute`'s supplier branch
> have a production adapter and **zero production callers**.

**That is now false, measured three ways:**

1. `bin/bench.ts` calls `delegate` twice — once at module scope (`BENCH_OWNER_KEY`) and once
   inside `sovereignSupplierFor`.
2. `bin/bench.ts` supplies a `(nodeId) => CapabilitySupplier` to `discoverCandidates`, which
   constructs `RemoteExecutor`s on it, reaching the supplier branch.
3. Not "every one labels its shards `'public'`" — `shards: [{ value: row, label: 'sovereign',
   ownerId: BENCH_OWNER_KEY }]` is in the file, and a spawned run of it printed
   `--sovereign: 1 of 1 sovereign shards agreed, chain rooted at <the enrolled owner key>,
   audience 12D3Koo…` in a run I executed.

**RULING: the prose is stale and must be rewritten. The checkbox must NOT move.** Whether a
twice-flag-gated path counts as *entry-point reachable* is Phase 22's guard's decision, and
Phase 22 runs **last** by owner ruling (order 23 → 24 → 22). AUTH-03 stays `[ ]` and stays
`Partial`. What changes is the sentence, not the state.

**And a second finding that explains why nobody caught it.** This repository has a guard built
for precisely this failure — `packages/node/src/requirements-ledger.node.test.ts`, whose stated
question is *"when a row says a mechanism has no production caller, does it in fact have
none?"*. It did not catch this. I tested why rather than guessed: I ran the guard's two
`NO_CALLER` patterns against the literal AUTH-03 row and both returned **zero matches**. The
row's phrasing — three items, and *"zero production callers"* rather than *"has no production
caller"* — is outside the shapes the parser reads, so AUTH-03 sits on
`WITHOUT_A_CHECKABLE_CLAIM` with a stated reason (*"a statement about a tier or a
configuration… A row that reports no absence has no absence to name"*) that is **not** the true
reason. The row does name an absence; the parser simply cannot see it. See **W-3**.

### BENCH-06 — the distinct-machine half is UNMOVED, and must stay so

Confirmed by three independent readings:

- `git diff --name-only afef35e~1..1b2c0e0 -- .planning/REQUIREMENTS.md` is **empty**. The
  phase did not touch BENCH-06's row. It still reads `- [ ]`, still says *"The distinct-machine
  claim is descoped, not satisfied. It is unmeasured, and unmeasured is not met."*
- The published report says it in the report's own words, in a paragraph written for this
  phase: *"**Spawning an operating-system process per node does not close this**, and no
  section below should be read as though it did… What would measure it is a second host, and
  one was not available. Recorded in these words because this is the phase whose report is most
  likely to be read as having closed it."*
- The machine inventory is one host, and every table heading carries the derived
  `SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count`.

**Nothing in Phase 23 moved BENCH-06. It stays descoped and unmeasured — not met.**

---

## Anti-patterns and source scan

| scan | files | result |
|---|---|---|
| `TBD` / `FIXME` / `XXX` (blocker gate) | all 11 primary Phase 23 source/test files | **none** |
| `TODO` / `HACK` / `PLACEHOLDER` / "not yet implemented" | the 7 non-test source files | **none** |
| whole-tree `tsc --noEmit` | — | exit 0, zero output |

Two **stale-prose** anti-patterns were found instead, both in files Phase 23 did not touch, and
both consequential for Phase 22. See **W-4** and **W-5**.

---

## Findings

No BLOCKERs. Five WARNINGs and three escalations, none of which falsify a criterion.

### W-1 — the published report carries an unstable figure without its spread

`BENCHMARK-RESULTS.md` §*The coordination ratio, per rung* publishes `0.99 / 1.18 / 1.08 /
0.77` and reads it as *"A ratio near 1 at a rung where the process curve was supposed to fall
is the reading that says coordination ate the gain."* 23-05's own three runs put the N=8 cell
at `0.98`, `1.03` and `0.77` — the sign flips. 23-05 states this plainly in its summary
(*"the spread across them is larger than the difference between the drivers"*, and *"That the
two drivers differ"* is listed under what the phase did **not** establish), but
**that sentence never reached the published artifact**, which is the only file a reader meets.
I grepped `BENCHMARK-RESULTS.md` for run-to-run variance language and found none.

This does not fail criterion 2 (see the within-driver / between-driver distinction above). It
is a reporting-discipline gap against this project's own preference for comparative readings.
**Recommended:** one paragraph in the report's `unmet` prose stating that three runs were taken,
that the coordination ratio's sign is not reproducible across them, and that the between-driver
comparison is therefore unsettled. It costs nothing and it is the phase's own finding.

### W-2 — the published ladder still excludes a rung the same file shows can run

`realFabric` defaults to `workers-to-submitter` — the direction the factorial identifies as the
separating lever — so the published real-transport ladder carries `real transport, 16 nodes` as
excluded while §*The excluded rungs, re-measured* shows attempts C, D and E completing that rung.
The comparability justification exists (*"defaulting to what every published number was taken
under"*) but it lives in a **source comment**, not in the published report. A reader of the
ladder alone meets an exclusion and must reach the bottom of the file to learn it is avoidable.
**Recommended:** state the retention and its reason in the excluded-configurations section, or
re-take the ladder under `submitter-to-workers` and freeze the current one the way 2026-08-01
was frozen.

### W-3 — the staleness guard cannot read the claim it exists to check

`requirements-ledger.node.test.ts` exempts AUTH-03 via `WITHOUT_A_CHECKABLE_CLAIM` on the stated
ground that the row is *"a statement about a tier or a configuration"* and *"a row that reports
no absence has no absence to name."* Measured: the row **does** name an absence; the guard's
`NO_CALLER` patterns return zero matches against it because of its phrasing. The exemption's
stated reason and its real reason differ. **Recommended:** when AUTH-03's prose is corrected,
phrase any remaining absence in the guard-readable shape (``` `X` has no production caller ```)
and either remove AUTH-03 from the exemption list or correct the exemption's stated reason.
This is the same shape as the four guard defects STATE.md already tracks: the population a guard
acts on is not the population that pays for it.

### W-4 — a superseded decision is still standing in production source, and claims precedence

`packages/net/src/remote-executor.ts`, last touched by Phase 15 (`5bbcebd`) and untouched by
Phase 23, opens its class comment with:

> *"AUTH-03: the *minting* side of this is still entry-point-unreachable… `bin/bench.ts` and
> `bench/src/perf-workload.ts` label every shard `'public'`… so `delegate` is called only from
> tests and Phase 22's reachability guard will find it. … So the third was taken: the requestor
> half is accepted as entry-point-unreachable and named here, in source, where Phase 22 will
> read it. The roadmap carries the same finding; **if the two ever disagree, this comment is the
> one a reader hits first and the roadmap is the one an auditor greps.**"*

Three falsehoods and one hazard:

1. `bin/bench.ts` does **not** label every shard `'public'` — `label: 'sovereign'` is in the file.
2. `delegate` is **not** called only from tests — two production call sites in `bin/bench.ts`.
3. *"the third was taken"* names the option the owner **overruled on 2026-07-31**. The ROADMAP
   marks the corresponding paragraph *"**Superseded — do not read the paragraph below as the
   standing decision.**"* This comment is that superseded decision, unmarked.
4. The hazard: it instructs the reader that it outranks the roadmap. Phase 22's author will read
   this file. **This is a comment asserting authority over a requirement, which is the exact
   inversion this project's conventions forbid.**

Not a Phase 23 criterion failure — criterion 5 delivered the call path regardless — but it
should be corrected before Phase 22 is planned. **Recommended:** replace the paragraph with what
is now true, and delete the precedence clause.

### W-5 — a smaller stale claim in the same family

`packages/bench/src/index.ts` reads *"**Exported here with no production caller yet.** Plan
23-03 supplies it."* Plan 23-03 did supply it (`gateRung` calls `assertIntegrity` from
`bin/bench.ts`). One-line correction.

---

## Escalations — decisions the verifier may not take

### E-1 — ticking BENCH-07 requires a coupled source edit

`acceptance-traceability.node.test.ts` asserts `expect(locate('BENCH-07')?.satisfied).toBe(false)`
as its "late-minted and open" spot-check. Ticking BENCH-07 turns it **red**. STATE.md already
carries the standing warning for this: *"`acceptance-traceability.node.test.ts` pins specific ids
in specific states, and 13.1's verification broke it by closing SCHED-06 while that spot-check
still asserted it open — `develop` was red from that commit until it was caught by an unrelated
executor. Run that file after any ledger edit."*

**Re-aim it to `WIRE-02`**, which I verified is the only remaining late-minted-and-open id in the
v1.1 sections (of the ten minted with v1.1, eight are now `[x]`; only `WIRE-02` and `BENCH-07`
are open), and which stays open until Phase 22 lands. **And rewrite the comment above it** — the
"it needs a second machine" sentence is the false claim this report rules on.

### E-2 — criterion 3's wording needs an owner-ruled correction note

Criterion 3's second disjunct presupposes a cause the phase's own measurement retired. A future
reader checking the criterion literally will find a contradiction. Precedent for the fix is in
the same criterion: the existing *"Corrected 2026-08-05: this is ONE rung"* note. **Recommended
addition:** a dated note recording that the eight-cell factorial partitions cleanly on **dial
direction**, that cap placement and driver each appear on both sides, that the default cap was
measured at **15** rather than the blamed **5**, and that the criterion therefore passes on its
**first** disjunct.

### E-3 — the two source-comment corrections (W-4, W-5)

Source edits, outside this verifier's permitted write set.

---

## Recommended ledger edit list

### CHANGE

| # | file | edit | reason |
|---|---|---|---|
| L1 | `.planning/REQUIREMENTS.md` | **`- [ ] **BENCH-07**` → `- [x] **BENCH-07**`**, with an evidence note citing the 2026-08-06 run: N processes with published pids, 2.70× at N=1→N=8 on the saturating fixture, machine inventory recorded, same-machine label derived | Every clause of BENCH-07's own text is satisfied, including the one that says it needs only one host |
| L2 | `packages/node/src/acceptance-traceability.node.test.ts` | Re-aim the late-minted-and-open spot-check from `BENCH-07` to `WIRE-02`, **and delete the "it needs a second machine" sentence** | Coupled to L1 — see E-1. The comment is the false claim, and the requirement wins |
| L3 | `.planning/REQUIREMENTS.md` line 682 (AUTH-03 coverage row) | Rewrite *"The requestor half is not wired… zero production callers"* to record the caller: `bin/bench.ts --discover --sovereign` mints a chain through `delegate`, supplies a `CapabilitySupplier` to `discoverCandidates`, dispatches one `label: 'sovereign'` shard, and a spawned spec reads the chain-rooted line and the peer-id audience. State that the **verdict stays `Partial`** pending Phase 22's guard, and that the browser factory's authorizer is still unproven | The prose is measurably false; the state is not yet decided |
| L4 | `.planning/ROADMAP.md` — Progress table (currently rows 1–22) | **Add a Phase 23 row**: `\| 23. Multi-Process Benchmark Driver \| 6/6 \| Complete — 5 of 5 criteria \| 2026-08-06 \|` | Six plans, six summaries on disk; no row exists |
| L5 | `.planning/ROADMAP.md` — Phase 23 criterion 3 | Append the dated correction note described in **E-2** | The criterion's second disjunct rests on a refuted premise |
| L6 | `.planning/STATE.md` | Replace `stopped_at` (still describing Phases 19/20/21) with Phase 23's outcome; bump `completed_phases` **6 → 7**; **recompute `total_plans` / `completed_plans` on disk** rather than incrementing — the in-file recount note ("23:5 = 56", 2026-08-02) predates the 6-plan replan and the current 76/72 could not be reproduced from the tree | Phase 23 is the seventh v1.1 phase to reach full marks. The count is over **criteria**, never over requirements |
| L7 | `packages/net/src/remote-executor.ts` | Replace the superseded AUTH-03 paragraph (W-4), including the clause claiming precedence over the roadmap | A comment is not a specification, and this one contradicts an owner ruling |
| L8 | `packages/bench/src/index.ts` | *"Exported here with no production caller yet"* → it has one (W-5) | Stale |
| L9 | `.planning/BENCHMARK-RESULTS.md` prose (optional, W-1/W-2) | Add the three-run spread for the coordination ratio, and state why the published ladder retains `workers-to-submitter` | The findings exist in the summaries; the artifact is what a reader meets |

### DO NOT CHANGE

| # | item | why not |
|---|---|---|
| N1 | **AUTH-03's checkbox** — stays `- [ ]`, verdict stays `Partial` | Entry-point reachability is Phase 22's guard's ruling, and Phase 22 runs **last** (23 → 24 → 22). Only the row's **prose** moves (L3) |
| N2 | **BENCH-06's checkbox and its distinct-machine language** | Descoped and unmeasured — not met. Phase 23 touched neither the row nor the claim, and the published report states four times that process isolation does not close it. *Unmeasured is not met* |
| N3 | **`BENCHMARK-RESULTS-2026-08-01.md`** | Frozen, byte-identical, and its immutability is what makes "a figure that changed" distinguishable from "a figure that was replaced" |
| N4 | **The `real transport, 16 nodes` excluded row** | It is a true report of what the published arrangement produced. Remove it only by re-taking the ladder, never by deleting the row |
| N5 | **`WIRE-02`'s checkbox** | Phase 22's requirement. L2 re-aims a guard **at** it; it does not tick it |
| N6 | **REQUIREMENTS.md's `**45 of 72 are [x]**` headline** | Counts the **v1 section only**, and BENCH-07 is in the v1.1 sections. Ticking BENCH-07 moves the whole-file count 53→54 of 82 and leaves the headline correct. A guard checks this headline against the v1 section — do not "fix" it |
| N7 | **`CHECKBOXES_WITHOUT_A_ROW`** in the traceability guard | Only if no BENCH-07 row is added to the ROADMAP coverage table. If one **is** added, `'BENCH-07'` must be removed from that array in the same commit and the row's verdict must begin `Done` — the assertion is a set equality |

---

## What this verification could not establish

Named rather than left for a reader to assume.

- **That the two drivers differ at all.** Three runs, curves crossed twice, spread between runs
  larger than the difference between drivers. Criterion 2 does not need it and does not claim
  it; the published report does not carry the caveat (W-1).
- **That the 16-node rung would run in the published ladder.** It ran in a factorial cell under
  a different dial direction. The ladder was not re-taken.
- **That the phase's guards would catch a driver that built its observation from a constant.**
  `integrity.ts` says so about itself: *"it does not prove the driver builds its observation
  from the live fabric rather than from a constant. That half is held by a source-shape guard
  and by the call-site count… and it is **unmeasured**."* The `sovereign-arm` spawn spec is the
  one place a real execution reads a real number back out, and it covers criterion 5 only.
- **Two levers on criterion 3:** staggering the joins, and the agents' inbound counts under
  `submitter-to-workers`. Both named-and-unexercised in the published report, in its own words.
- **The browser factory's authorizer** (AUTH-03's other open leg) — unchanged by this phase and
  still guarded only by a source-text argument-equality check.

---

_Verified: 2026-08-06T17:20:00Z_
_Verifier: Claude (gsd-verifier) — goal-backward, adversarial stance_
_Wrote exactly one file. No `git add`, `commit`, `stash` or `checkout --` was run. `git status --porcelain` was clean before and after._
