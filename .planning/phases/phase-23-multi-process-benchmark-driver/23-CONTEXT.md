# Phase 23: Multi-Process Benchmark Driver - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Mode:** Autonomous — every grey area below is resolved here, with the reasoning. Four
of the resolutions rest on measurements taken while gathering this context (a live
`FabricNode`'s real inbound limits, and the per-shard cost of the colouring kernel at
three problem sizes); those are marked **measured** and the numbers are given. Two
findings contradict what the published report and the roadmap currently say, and are
flagged in "Risks" rather than quietly folded in.

<domain>
## Phase Boundary

`packages/node/src/bin/bench.ts` builds every "node" in both published curves inside the
driver's own process. `memoryFabric` (`:128-199`) is in-process by definition —
`MemoryNetwork`. `realFabric` (`:202-237`) constructs N real `FabricNode`s by calling
`FabricNode.start(...)` in a loop (`:206-210`) and dials them over loopback, so N libp2p
nodes share one V8 isolate and one event loop. `WasmExecutor.execute` is synchronous CPU
work inside that loop, so N shards dispatched concurrently through `Promise.all`
(`submit.ts:205`) are serialised by the runtime no matter what N is. That is why
`BENCHMARK-RESULTS.md`'s makespan column is flat across `1, 2, 4, 8, 16` and why its own
opening section says no parallel speedup is measurable there "by construction".

The remedy already exists in this repository, built for an unrelated reason: three tests
spawn real `bin/agent.ts` child processes and drive a job across the boundary —
`two-process.node.test.ts:47-80`, `sovereignty-placement.node.test.ts:57-90`,
`egress-refusal.node.test.ts:62`. All three share one `spawnAgent` shape:
`spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {stdio:
['ignore','pipe','pipe']})`, then wait for one JSON line on stdout
(`agent.ts:58`). Phase 23 moves the benchmark's real-transport node construction onto
that shape and publishes the resulting curve.

**In scope:** BENCH-07 — a third driver that spawns N operating-system processes, a
fixture that does enough work for a speedup to exist, a re-measurement of the two rungs
Phase 8 excluded, and provenance on every published figure.

**Out of scope:** anything that needs a second machine. BENCH-06's distinct-machine half
is **descoped and unmeasured — not met**, it is not transferred here, and nothing this
phase produces may be published as a cross-machine result. One host has one CPU, one V8
and one libc. Also out of scope: the browser tier (no hosted relay exists), the
user-count axis of the methodology's §1.1 (this phase sweeps the node-count axis only),
and `runResilient`/`executeReduce` wiring (Phases 16 and 20).

## Requirement text, verbatim

**BENCH-07** (`REQUIREMENTS.md:481-489`, minted 2026-07-28):

> The benchmark harness spawns N operating-system processes rather than N nodes on one
> event loop, and a makespan difference between N=1 and N=8 is measurable on a fixture
> that saturates a core. Needs only separate processes on one host, which Phase 8's own
> summary named as the cheaper remedy and Phase 12 has since built the spawn pattern
> for. **This is the driver work; BENCH-06 is the reporting discipline it runs under** —
> machine inventory recorded, same-machine label derived and retained — **and BENCH-06's
> distinct-machine half is descoped and unmeasured, not met.** Spawning N processes on
> one host does not close it and must not be published as though it had: one host has
> one CPU, one V8 and one libc

**BENCH-06** (`REQUIREMENTS.md:280-295`) is the discipline this phase runs under and
stays open against Phase 8; it is quoted here because criterion 4 is a statement about
its report:

> Benchmarks run across N independent operating-system processes on one host; every
> published run records its machine inventory; and the same-machine label stays
> **required and derived from that inventory**, never declared — sixteen nodes on one
> laptop are reported as sixteen processes on one machine, not as sixteen nodes. **The
> distinct-machine claim is descoped, not satisfied.** It is unmeasured, and unmeasured
> is not met. A same-host run **cannot** detect divergence between machines, because it
> has one CPU, one V8 and one libc: every process shares an instruction set, an engine
> build and a system library, so the very variables a cross-machine benchmark exists to
> expose are held constant by construction. The original cross-machine risk stands
> exactly where Phase 8 left it, unmeasured and now unscheduled. What this rewrite *does*
> buy is real and is tracked separately as **BENCH-07** (Phase 23, the multi-process
> benchmark driver): moving off one event loop makes a parallel speedup measurable at
> all, which the single-process harness could not do at any N. That is the honest
> one-machine win. It is not a distributed measurement and must never be published as one

## Success criteria, verbatim (`ROADMAP.md:555-559`)

1. A benchmark run at N nodes spawns N operating-system processes, verified by reading
   the child PIDs, and the published run records them — a run that silently falls back to
   in-process nodes fails the harness rather than reporting a curve
2. Makespan at N=1 and N=8 differ on a fixture with enough work to saturate a core, and
   the ratio is published; a flat curve is a finding, but it must be a finding about the
   fabric rather than about the harness
3. The two real-transport rungs Phase 8 published as excluded (8 and 16 nodes, dying on
   `INBOUND_CONNECTION_THRESHOLD = 5` per host) either run, or are re-excluded with a
   measurement showing the per-host inbound cap is still the cause under separate
   processes
4. `BENCHMARK-RESULTS.md` states, for every published figure, whether it came from the
   single-process or the multi-process driver — no figure is silently replaced

## Every node is the same node

Nothing in this phase keys on a kind of node. `bin/agent.ts` produces one and only one
construction (`agent.ts:44-55`), and its own comment on the sovereignty flags
(`agent.ts:26-31`) states the rule this phase inherits: *"this is a per-node clearance
flag, not a node kind: every agent process built by this binary has identical capability
regardless of whether it is passed."* The driver process holds a `FabricNode` too
(`bench.ts:214` today); calling it "the requestor" names a **role in this rig**, exactly
as `Machine.roles` already models roles as data (`report.ts:32`, and `bench.ts:70` already
declares `roles: ['worker', 'requestor']` for the single host). The only asymmetry the
driver introduces is which process holds the module first and who dials whom — both are
positions, not capabilities, and decision 4 below turns the second one into a measured
variable rather than an assumption.
</domain>

<decisions>
## Implementation Decisions

### 1. The saturating fixture is `@o2/demo`'s colouring kernel at `n = 700`, `budget = DEFAULT_BUDGET`, 8 partitions — **measured**, not chosen

Criterion 2 needs "a fixture with enough work to saturate a core", and the roadmap's own
trap note says the COST crossover at ~570× measures the guest ABI on a trivial fixture
rather than the fabric. The current fixture is `MODULE_WRITES_PARTITION`
(`core/src/executor/fixtures.ts:113-125`) — four `i32.store8`s, one shift, one
`output_write`. It cannot produce a speedup at any N because there is nothing to
parallelise.

A new hand-assembled spinner was considered and rejected: the repository already ships a
real, committed, integer-only, budget-bounded search kernel whose per-shard cost is a
declared input — `packages/demo/src/kernel.wat` (346 lines), `kernelBytes`
(`demo/src/kernel.ts:23`, 1,200 bytes), driven by `buildInput(n, budget)`
(`demo/src/job.ts:111-172`). Its budget exists precisely so a shard's cost is bounded and
identical on every node (`job.ts:38-53`), which is what makes shard cost a *controlled*
quantity rather than a property of the host.

Parameters were measured on this machine rather than reasoned about (8 partitions,
`DEFAULT_BUDGET = 5_000_000`, `WasmExecutor` in one process):

| n | per-shard statuses | per-shard ms | serial total | input payload |
|---|---|---|---|---|
| 500 | 7 × `budget`, **1 × `found` at 58 ms** | 58–169 | 712 ms | 7,868 B |
| **700** | **8 × `budget`** | **80–118** | **740 ms** | **11,184 B** |
| 1000 | 8 × `budget` | 83–126 | 829 ms | 16,596 B |

`n = 500` is disqualified: a cube that finds a colouring returns early, so shard cost is
not uniform and the N=1↔N=8 ratio would be measuring the search, not the fabric.
`n = 1000` exceeds `WIRE_CHUNK_BYTES = 16_384` (`libp2p/src/constants.ts:89`) and would
split the input across two frames, changing the transport regime between fixtures for no
gain. **`n = 700`**: every shard spends its whole budget, per-shard cost is 80–118 ms
(spread 1.5×, max/mean ≈ 1.3), the serial job is 740 ms, and the input is one wire chunk.
Against the published trivial-fixture real-transport p50 of 15.8 ms at 4 nodes, compute
now dominates coordination by roughly 50×.

Cost is linear in `budget` (`job.ts:41-45`, and the three rows above agree), so the knob
exists if a longer run is wanted. **Keep `DEFAULT_BUDGET`** — it is the shipped
configuration, and measuring the shipped configuration is worth more than a rounder
number.

The shard-value shape is copied from `demo/src/kernel.test.ts:393`: every shard carries
the *identical* input value, so all eight resolve to one CID and one block
(`kernel.test.ts:421-423` asserts `inputCids.size === 1`); only `partitionIndex` differs.
`partition()` packs `(index << 16) | count` and the guest derives `k = log2(count)`
(`kernel.wat:219-229`), so **`partitionCount` must be a power of two**.

### 2. `SHARDS` stays 8

Two independent reasons, and they agree. First, decision 1's kernel requires a power of
two. Second — and this is the one that would bite — `ROADMAP.md:383` records a measured
cliff: *"`bin/bench.ts` … ships `const SHARDS = 8`, one below a measured cliff at 12"*,
with Phase 13.1 criterion 4 (`ROADMAP.md:365`) recording `N=8 completes and N=12 fails
entirely with MaxEarlyStreamsError: Too many early streams - 11/10`, which aborts the
whole muxer. Raising `SHARDS` to 16 to make the ladder rounder would walk the new driver
straight into an unfixed sender-side stream bound, and the resulting failure is
attributed to the wrong node. `SHARDS = 8` (`bench.ts:64`) is unchanged.

### 3. The process fabric spawns `bin/agent.ts` with the existing `spawnAgent` shape; the driver keeps one in-process `FabricNode` as the submitting node

`spawnAgent` is written three times already, identically
(`two-process.node.test.ts:47-80`, `sovereignty-placement.node.test.ts:57-90`,
`egress-refusal.node.test.ts:62`). The driver's copy is the fourth; it is not shared
code, because all three existing copies live in test files and `bin/bench.ts` cannot
import from a `*.node.test.ts`. Lifting it into `@o2/node`'s barrel is possible but adds
an export whose only production caller would be the driver — take that decision in
Phase 22's reachability work if it is wanted, not here.

The submitting node stays a `FabricNode.start(...)` inside the driver process, as
`realFabric` does today (`bench.ts:212-215`). Reasons: it must hold `.store` to `put` the
module and be handed to `submitJobWithEgress` as the blockstore (`bench.ts:275`); it must
expose `.egress` for the manifest leg (`bench.ts:231`, guarded by
`bench-egress.node.test.ts:82`); and `RemoteExecutor` needs its `.rpc`
(`net/src/remote-executor.ts:31`). Putting it in a child process would require an RPC to
retrieve the manifest, which 13-CONTEXT.md already deferred as unneeded.

This means N=8 runs **9** node processes on this 8-logical-core host, plus the driver's
own work. Named in decision 9's confound list rather than hidden.

### 4. The dial direction flips, and that flip is a controlled variable — not a free win

`realFabric` today has every worker dial the submitting node:
`await node.libp2p.dial(requestor.libp2p.getMultiaddrs())` in a loop (`bench.ts:218-220`).
So one node receives N inbound connections, all from `127.0.0.1`, and
`inboundConnectionThreshold` — a **per-host rate**, `libp2p/src/constants.ts:45-65` — is
exactly the limit that binds.

The spawn pattern the three existing tests use dials the other way: the submitter dials
each agent (`two-process.node.test.ts:131`), so each agent receives exactly **one**
inbound connection and the per-host cap never binds at all. Adopting the spawn pattern
therefore changes *two* things at once — the process split and the dial direction — and
only one of them is what BENCH-07 is about.

**Decision:** the process driver dials outward from the submitting node (matching the
existing tests), **and** criterion 3's measurement holds the driver fixed while varying
the direction, so the two effects are separated. Concretely, three configurations at the
8- and 16-node rungs: (a) in-process, workers dial in — the Phase 8 arrangement; (b)
in-process, submitter dials out; (c) multi-process, submitter dials out. If (b) already
succeeds where (a) failed, the exclusion was about the dial direction and the process
split gets no share of that finding. Publishing "processes fixed it" when the direction
fixed it would be exactly the "finding about the harness" criterion 2 forbids, one
criterion over.

### 5. `bin/agent.ts` announces its own `process.pid` in the handshake line it already prints

Criterion 1 says "verified by reading the child PIDs". `child.pid` alone proves a process
was spawned, not that the process that announced the address is that process. One extra
key on the existing single JSON line (`agent.ts:58`) closes it, and the parent asserts
`handshake.pid === child.pid`.

Backwards-compatible by construction: all three existing readers do
`JSON.parse(...) as {peerId, multiaddrs}` and read only those two fields
(`two-process.node.test.ts:66`, `sovereignty-placement.node.test.ts:76`,
`egress-refusal.node.test.ts`), so an added key changes nothing for them.

### 6. Harness-integrity failures abort the run; only measurement failures become excluded rows, and an excluded row's reason is derived from the error

`bench.ts:408-431` wraps `measure(...)` in a `try`/`catch` and converts **any** thrown
error into an excluded row whose reason is a hardcoded paragraph asserting the inbound
cap (`:425-429`). That paragraph is attached without inspecting the error beyond
interpolating its message.

Two consequences, both fatal to this phase's criteria if left alone. Criterion 1 requires
that a run which silently falls back to in-process nodes **fails the harness rather than
reporting a curve** — but under the current shape, a failed pid check would be caught and
published as an excluded rung blamed on a libp2p limit. Criterion 3 requires a
*measurement* showing the cap is the cause — but the current code asserts that cause for
every failure mode there is.

**Decision:** two error classes. A `HarnessIntegrityError` (pid check, executor-count
check, driver-CPU check) propagates out of `main()` and the run produces no report at
all. Everything else becomes an excluded row whose `reason` is built from the observed
error — its class, its message, and the configuration in force
(`inboundConnectionThreshold`, `maxIncomingPendingConnections`, dial direction, stagger)
— with any interpretation stated as interpretation.

### 7. `RunConfig` gains two declared dimensions, `driver` and `fixture`

Criterion 4 wants provenance on **every published figure**. A heading is not enough: the
raw observations go to `.planning/bench/raw.json` (`bench.ts:512`) where a heading does
not exist, and `SweepResult` carries its `RunConfig` into that file
(`harness.ts:94-105`). `transport` and `skew` are already exactly this kind of declared
dimension (`harness.ts:45-56`), rendered nowhere but carried everywhere.

Add `driver: 'in-process' | 'process-per-node'` and `fixture: 'trivial' | 'saturating'`
to `RunConfig`, both required, and render both as columns in `sweepTable`
(`report.ts:117-129`) alongside the label already in every heading (`report.ts:163-167`).
Required rather than optional, for the same reason `Inventory.machines` is required
(`report.ts:9-17`): a figure that *can* be published without its provenance eventually
is.

Cost: the literals in `harness.test.ts:17-23` and its `point()` helper need the two new
fields. That is a mechanical edit to a test whose subject is unaffected.

Cheaper alternative, rejected: run the saturating fixture only under the new driver, so
`driver` alone identifies the fixture. Rejected because decision 9 deliberately runs the
saturating fixture under *both* drivers as criterion 2's control, which collapses that
correspondence immediately.

### 8. The multi-process curve is a new `Report` section; `connectivityTax` is fed only the in-process real curve

`Report` has exactly `memoryTransport` and `realTransport` (`report.ts:84-85`). The
tempting move — appending the multi-process rungs to `realTransport` and letting the
`driver` column tell them apart — has a silent failure: `connectivityTax` builds
`new Map(real.map(point => [point.config.nodes, point]))` (`harness.ts:253`), so two
entries at the same node count collapse to whichever was appended last, with no error.
The tax would then be computed against an arbitrary one of the two drivers.

**Decision:** `Report` gains `multiProcess?: readonly SweepResult[]`, rendered by
`renderMarkdown` as its own `## Makespan` section with the same derived machine label,
and `connectivityTax(memoryResults, realResults)` (`bench.ts:460`) keeps receiving only
the in-process real curve — the tax is defined in the methodology (§2.3) as the same job
over two transports with everything else held constant, and the driver is not held
constant otherwise.

### 9. The speedup ladder holds redundancy fixed at 1; the existing `min(2, nodes)` ladders are left exactly as they are

Every existing rung uses `redundancy: Math.min(2, nodes)` (`bench.ts:392`, `:412`), so
N=1 runs at R=1 and every other rung at R=2. A ratio taken between an R=1 rung and an R=2
rung is not a parallelism measurement: at N=8/R=2, `planPlacement` gives each of 8 nodes
exactly 2 of the 16 dispatches (least-loaded-first with the `dispatchCount` nudge,
`sovereignty.ts:183-185` and `submit.ts:187-203`), so the ideal ratio against N=1/R=1 is
4×, not 8×, before anything real happens.

**Decision:** a dedicated speedup sweep across the full ladder at **R = 1**, declared as
its own configuration, and the published ratio is `p50(N=1) / p50(N=8)` from that sweep.
The verification tax is reported as the identity `1.00×` exactly as the 1-node rung
already is in the published report — BENCH-04 is satisfied by the figure appearing, not by
it being greater than one. The existing memory and real ladders keep `min(2, nodes)` and
their numbers, which is half of criterion 4's "no figure is silently replaced".

Confounds to publish beside the ratio, all measured on this host: **8 logical cores**
(`os.cpus().length`), Apple M1 Pro — a heterogeneous design whose efficiency cores are
slower, so per-process throughput is not uniform and that non-uniformity is a property of
the host; **9 node processes at the N=8 rung** (decision 3); and **N=16 is oversubscribed
by construction** on an 8-core host, so a knee there is contention, not coordination.

### 10. Each rung's fabric is disposed before the next rung is built

`runnerFor` caches one `Fabric` per node count in a `Map` and disposes them all at the
end (`bench.ts:251`, `:314-317`). Under the process driver that leaves
`1+2+4+8+16 = 31` agent processes resident by the last rung, all idle but all holding a
libp2p node and a heap. Resident idle processes are a contention source that shows up in
the curve being measured — precisely criterion 2's "finding about the harness".

**Decision:** the process driver's runner disposes the previous rung's fabric when
`config.nodes` changes. `runnerFor` itself is left alone for the memory and real legs;
whether that is a second function or an option on the existing one is planner's
discretion.

### 11. The methodology gets a dated amendment; nothing above the Amendments heading is edited

`.planning/BENCHMARK-METHODOLOGY.md` says so in its own preamble and reserves a section
for it (`## Amendments`, currently *"None."*). Three things this phase does are changes
to the pre-registered plan and must appear there, dated, with the reason: a second
fixture (§6.3 declared "the WASM fixtures are tiny" as a known bias — this phase adds one
that is not); a third driver and the `driver`/`fixture` dimensions; and the fixed-R
speedup sweep. Writing them into the plan body instead would defeat the ordering property
BENCH-02 exists for, and that ordering is checkable in `git log`.

### 12. `@o2/node` takes a workspace dependency on `@o2/demo`

`bin/bench.ts` currently reaches the fixture by relative path across a package boundary:
`from '../../../core/src/executor/fixtures.ts'` (`bench.ts:56`). Adding `"@o2/demo": "*"`
to `packages/node/package.json` and importing `@o2/demo` by name matches how the same
file already imports `@o2/core`, `@o2/net` and `@o2/bench` (`bench.ts:30-55`).

Safe against both structural guards: `purity.node.test.ts:28` scans `core, net, bench,
demo, aot` and `packages/node` is in neither list, and the new edge points
adapter → portable, which is the permitted direction (`purity.node.test.ts:154-174`).
`@o2/demo`'s own dependencies are `@o2/core` and `multiformats` only.
</decisions>

<code_context>
## Existing Code Insights

### The driver — `packages/node/src/bin/bench.ts` (518 lines)

| site | what it is |
|---|---|
| `:59-64` | `QUICK`, `RUNS = QUICK ? 6 : 20`, `LADDER`, `REAL_LADDER`, `SHARDS = 8` |
| `:66-83` | `inventory()` — one `Machine` from `os`, `physicalCores: 0` deliberately (not exposed portably) |
| `:86-94` | `shardInputs(skew)` — 8 distinct `{partition, payload}` values, `skewed` inflates partition 0 to 4096 B |
| `:97-111` | `timed()` — wraps an `Executor` and accumulates wall time per node; this is where node-seconds actually come from, since `JobResult` reports fuel |
| `:113-125` | `interface Fabric` — `{executors, blockstore, moduleCid, guard, close}`; the seam a third fabric implements |
| `:128-199` | `memoryFabric` — `MemoryNetwork`, one guarded submitting endpoint (`:142`), N worker endpoints, two `serveAgent` calls total |
| `:202-237` | `realFabric` — N + 1 `FabricNode.start` calls **in this process** (`:209`, `:214`), workers dial the submitter (`:219`), `guard: requestor.egress` (`:231`) |
| `:240-319` | `runnerFor` — caches a fabric per node count, times the job, slices the egress manifest |
| `:267-277` | the measured job path: `submitJobWithEgress(spec, fabric.blockstore, [fabric.guard])` |
| `:403-437` | the real-transport sweep, its `try`/`catch`, and the hardcoded exclusion paragraph (`:425-429`) |
| `:452-489` | report assembly, including the six-item `unmet` list whose first item is the flat-curve admission |
| `:512-513` | writes `.planning/bench/raw.json` and `.planning/BENCHMARK-RESULTS.md`, both relative to `process.cwd()` |

`bin/bench.ts` has **no npm script** — root `package.json` exposes `test`, `typecheck`,
`build:demo`, `aot:lift` only. It is run by hand:
`node --experimental-strip-types packages/node/src/bin/bench.ts [--quick]` (`bench.ts:9`).
Adding a `bench` script is safe against DEMO-04's guard — `disclosure-gate.node.test.ts`
forbids script *names* matching `/^deploy(?::|$)/` and a list of publishing commands, not
build or measurement scripts.

### Two source-shape guards constrain how `bin/bench.ts` may be edited

Both read the file off disk and count literal text. Neither runs the benchmark.

- **`bench-egress.node.test.ts`** (197 lines) requires four call-site shapes to survive
  any rewrite: `guard: requestor.egress` (`:82`), `const requestorGuard = new EgressGuard(`
  **and** `guard: requestorGuard` (`:92`), `submitJobWithEgress(` **and**
  `[fabric.guard]` (`:106`), and `result.manifests[` + `.entries.length` + `.totalBytes`
  (`:115`). It also asserts the source is >5,000 chars and still contains
  `async function memoryFabric` and `async function realFabric` (`:161-163`). **Renaming
  either function, or replacing `realFabric` with a process fabric rather than adding
  one, fails this test.**
- **`serve-agent-hooks.node.test.ts:47-55`** asserts `bin/bench.ts` contains each of the
  six hook sentinels **exactly twice** — two `serveAgent` call sites, no more, no fewer.
  A process fabric adds no `serveAgent` call (the spawned agents reach it through
  `FabricNode.start`, `fabric-node.ts:411-425`), so the count stays 2 provided
  `memoryFabric` keeps both of its own.

### `packages/bench` — what is reached and what is not

Classified by grepping every export and sorting each hit into definition / barrel
re-export / test / production call:

| symbol | definition | production caller |
|---|---|---|
| `measure` | `harness.ts:137` | **yes** — `bench.ts:390`, `:410`, `:441` |
| `connectivityTax` | `harness.ts:249` | **yes** — `bench.ts:460` |
| `costCrossover` | `harness.ts:203` | **yes** — `bench.ts:461` |
| `renderMarkdown` | `report.ts:137` | **yes** — `bench.ts:492` |
| `machineLabel` / `isSameMachine` / `hostCount` | `report.ts:69` / `:64` / `:53` | **transitively** — `renderMarkdown` calls `machineLabel` (`report.ts:138`), which calls the other two (`:70`, `:72`); no direct call from an entry point |
| `summarise` / `describe` / `percentile` / `MIN_RELIABLE_SAMPLES` | `stats.ts:63` / `:109` / `:55` / `:29` | **yes**, `summarise` at `bench.ts:449-450`; the rest transitively |
| `NODE_LADDER` | `harness.ts:40` | **yes** — `bench.ts:61`, `:63` |
| `RUNS_PER_CONFIG` | `harness.ts:43` | **no direct caller** — `bench.ts:60` hardcodes `20` instead of importing it; reached only as `measure`'s default (`harness.ts:142`) |
| `sweepNodeCount` | `harness.ts:171` | **none.** Barrel export at `index.ts:23`; the only call is `harness.test.ts:55`. `bin/bench.ts` writes its own `for` loops over `LADDER` (`:387`, `:406`). This is a built-not-wired export in the exact class Phase 22's guard exists to catch |

Any new `@o2/bench` export this phase adds needs a real call from `bin/bench.ts`, or it
joins `sweepNodeCount` on that list.

### The spawn pattern, three times over

`two-process.node.test.ts` is the closest template — it is the one whose job actually
completes across the boundary:

- `:30` `const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))`
- `:49-51` `spawn(process.execPath, [AGENT, '--dir', dir], {stdio: ['ignore','pipe','pipe']})`
- `:53-75` handshake: 30 s timer, accumulate stdout to the first `\n`, `JSON.parse`,
  reject on early `exit` with the accumulated stderr
- `:99-112` `stopAgent` — SIGTERM, wait for `exit`, SIGKILL at 10 s
- `:127-136` submitter started in-process, dials each agent, `put`s the module — *only*
  the submitter has it, so every worker must pull it over the wire
- `:138-151` `new RemoteExecutor(peerId, submitter.rpc)` per agent, then `submitJob`
- `:168` the test's own timeout is `120_000`

`sovereignty-placement.node.test.ts:57-90` is the same function with an `extraArgs`
parameter; `egress-refusal.node.test.ts:62` is the same again. `bin/agent.ts`'s flags are
`--dir`, `--port` (default `0`, so the OS assigns and parallel runs cannot collide),
`--owner-id`, `--can-execute-sovereign` (`agent.ts:22-35`).

### `FabricNode`'s inbound limits are already configurable — and are no longer 5

`FabricNodeOptions` has carried `maxIncomingPendingConnections` and
`inboundConnectionThreshold` since before this phase (`fabric-node.ts:156-173`), and
`start` derives both from the reservation limit (`fabric-node.ts:294-301`):

```
limit            = canRelay ? (options.maxReservations ?? RELAY_MAX_RESERVATIONS) : 0   // 15
pending          = options.maxIncomingPendingConnections ?? max(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS, limit)
inboundPerSecond = options.inboundConnectionThreshold   ?? max(LIBP2P_INBOUND_CONNECTION_THRESHOLD, limit)
```

with `RELAY_MAX_RESERVATIONS = 15`, `LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS = 10`,
`LIBP2P_INBOUND_CONNECTION_THRESHOLD = 5` (`libp2p/src/constants.ts:28`, `:43`, `:65`).

**Measured, not inferred.** Starting `FabricNode.start({})` on this machine and reading
the getters (`fabric-node.ts:465-473`) returns
`{inboundConnectionThreshold: 15, maxIncomingPendingConnections: 15, capacityLimit: 15}`.
The effective per-host inbound rate for a default node today is **15, not 5** — the
number the published exclusion names. `git log -S inboundConnectionThreshold --
packages/node/src/fabric-node.ts` puts that coupling in `f879b9d` (2026-07-27), and the
benchmark harness in `677a6d2` (2026-07-26), with `677a6d2` an ancestor of `f879b9d`:
the coupling landed **after** the run that produced the exclusion. `realFabric` passes
neither option (`bench.ts:209`, `:214`), so it takes the derived default.

`inboundConnectionThreshold` is a **rate per second**, per host
(`libp2p/src/constants.ts:45-65`), which is why the constant's own doc records that
staggering the joins fixed it while raising the reservation and pending limits did not.
Three independent levers therefore exist for criterion 3 — raise the option, stagger the
dials, or change which side receives them (decision 4) — and only a measurement can say
which one the rung was actually dying on.

### Everything the process fabric needs off `FabricNode`

`peerId` (`:430`), `multiaddrs` (`:435`), `dial(address) → peerId` (`:513-517`), `store`,
`rpc`, `egress` (assigned `:260-263`), `stop()` (`:519-523`). `FabricNode.start` builds
the `EgressGuard` and constructs `rpc` over it (`:344-355`), which is why `realFabric`
only has to surface `requestor.egress` (`bench.ts:231`) rather than construct one.

`Libp2pTransport.send` dials by peer id (`libp2p-transport.ts:122-126`) and reuses an
existing connection whichever side opened it — so flipping the dial direction (decision
4) does not change how the RPC reaches a peer. The o2 protocol handler is registered with
`maxInboundStreams`/`maxOutboundStreams` of 256 (`libp2p-transport.ts:108-109`), which is
*not* the bound Phase 13.1 measured; that one is yamux's early-stream limit, 10.

### The job path and the placement it produces

`submitJobWithEgress(spec, blockstore, guards)` (`net/src/submit-with-egress.ts:79-92`)
delta-slices each guard's manifest around `submitJob` and returns
`{ok, job, manifests}`. `submitJob` (`core/src/job/submit.ts:135-`) encodes and stores
every shard input (`:163-179`), plans placement sequentially with a `dispatchCount` nudge
(`:186-203`), then runs every shard concurrently through `Promise.all` (`:205`).
`planPlacement` sorts eligible nodes least-loaded-first, tie-broken by id
(`core/src/sovereignty.ts:183-185`), so 8 shards at R=1 over 8 nodes is exactly one each,
deterministically. `publicNodes(executors)` (`sovereignty.ts:73-82`) builds the
descriptors with `load: 0`.

### The report shape criterion 4 has to change

`Report` (`report.ts:77-98`) — `{title, at, inventory, baseline, memoryTransport,
realTransport, connectivity, crossover, unmet, excluded?}`. `renderMarkdown`
(`:137-204`) puts the derived label in the top matter and in **both** makespan headings
(`:163`, `:166`) so copy-paste cannot strip it; `harness.test.ts:256-257` asserts the
label appears at least three times. `sweepTable` (`:117-129`) is the 12-column row
renderer where a `driver`/`fixture` column would go. `isSameMachine` returns false at
`nodeCount <= 1` (`:65`), so the N=1 rung is labelled "single node on 1 host" rather than
same-machine — correct, and unchanged by this phase.

### Machine inventory of the host this phase will run on

`node v23.11.0` (recorded in the methodology's §6.4 as outside the declared support range
and reported rather than ignored), Apple M1 Pro, **8 logical cores**, physical count not
exposed portably so reported as `0` (`bench.ts:72-75`), 32 GiB, `darwin 25.5.0`.

### The vocabulary guard scans the file this phase writes

`vocabulary.node.test.ts` scans every git-tracked file (`:353-393`) with only four path
exemptions, none of which covers `.planning/BENCHMARK-RESULTS.md`, `.planning/bench/`,
`.planning/BENCHMARK-METHODOLOGY.md`, or this phase directory. Generated report prose is
in scope. Read the `BANNED` array (`vocabulary.node.test.ts:47-73`) before writing any
new report string.
</code_context>

<specifics>
## Specific Ideas — how each criterion gets measured

### Criterion 1 — N processes, verified by PID

**Measured, three independent checks, all cheap:**

1. **Identity.** For each rung, collect `child.pid` for all N children and the `pid` the
   child announced on stdout (decision 5). Assert: `pids.length === N`; every pid
   distinct; no pid equals `process.pid`; `handshake.pid === child.pid` for each;
   `process.kill(pid, 0)` does not throw immediately before the sweep.
2. **Correspondence.** Every `RemoteExecutor.nodeId` in `Fabric.executors` is a peer id
   that came out of a handshake, the set has size N, and the submitting node's own peer
   id is not among them.
3. **CPU attribution — the falsifier that does not depend on the harness telling the
   truth about itself.** Record `process.cpuUsage()` in the driver across each measured
   run. The saturating fixture costs ~740 ms of CPU per job (decision 1). If the work had
   silently run in-process, the driver's own `user` time would rise by approximately that
   amount; on a genuine multi-process run it stays a small fraction of it. Publish the
   ratio `driverCpuMs / totalShardComputeMs` per rung. This is the check that catches a
   fallback that fakes its pids, and it is the one worth having.

Failures of any of the three raise the `HarnessIntegrityError` of decision 6 and the run
produces no report — which is criterion 1's "fails the harness rather than reporting a
curve", literally.

**Testable without running the benchmark:** put the three checks in a pure function over
`{expected, childPids, announcedPids, driverPid, executorNodeIds, agentPeerIds}` returning
a list of violations, and unit-test it with planted inputs — a duplicated pid, the driver's
own pid, a short list, an executor id that no agent announced. That is the idiom
`vocabulary.node.test.ts:518-590` and `bench-egress.node.test.ts:169-196` already use: a
guard is worth nothing until something has watched it fail.

**Publication:** a `## Processes` table in `BENCHMARK-RESULTS.md`, rung → pid list, and
the same data in `raw.json`. Pids are per-rung, not per-run, so the table has one row per
rung.

### Criterion 2 — the N=1 ↔ N=8 ratio, with a control

**The number:** `p50(N=1) / p50(N=8)` from the fixed-R speedup sweep (decision 9), with
p95 and p99 alongside per the methodology's §3.1, and `n` per rung.

**The bound:** the ideal ratio is `serialTotal / maxShard` = 740 / 118 ≈ **6.3×** on
measured per-shard costs, not 8×, because shard cost varies 80–118 ms and makespan at
N=8 is set by the slowest shard. Publish the ideal alongside the observed so the gap is
visible rather than implied.

**The control, which is what makes it a finding about the fabric.** Run the *identical*
saturating fixture, at the identical R, across the identical ladder, under the
**in-process** driver too. The in-process curve must stay flat — it cannot do otherwise,
one event loop — and the multi-process curve is compared against it. The published claim
is then the difference between two measurements that vary in exactly one thing, rather
than a single curve whose shape has to be interpreted. That comparison is also the direct
evidence for BENCH-07's central sentence: *"moving off one event loop makes a parallel
speedup measurable at all, which the single-process harness could not do at any N."*

**If the curve comes out flat anyway:** it is published flat, and the diagnosis is
sharpened by three figures already in hand — the driver-CPU ratio from criterion 1
(is work actually leaving the process?), the connectivity tax at the same rung (is
coordination eating the gain?), and the per-shard status vector (did every shard really
spend its budget?). A flat curve with those three attached is a finding about the fabric.
A flat curve without them is a finding about nothing.

### Criterion 3 — the excluded rungs, re-measured rather than re-asserted

**This criterion cannot be satisfied by the current code shape at all**, and that is
worth stating plainly: `bench.ts:425-429` attaches its inbound-cap paragraph to every
exception it catches without inspecting the error, so today the harness *asserts* the
cause it is being asked to *measure*. Decision 6 is the prerequisite.

**The measurement** is a small factorial at the 8- and 16-node rungs of the real
transport, one variable at a time, each attempt recording success/failure, the error
class and message, and the full configuration in force:

| attempt | driver | dial direction | `inboundConnectionThreshold` | stagger |
|---|---|---|---|---|
| A | in-process | workers → submitter | derived default (**15 today**) | none |
| B | in-process | workers → submitter | explicit `5` | none |
| C | in-process | submitter → workers | derived default | none |
| D | process-per-node | submitter → workers | derived default | none |
| E | process-per-node | submitter → workers | explicit `5` | none |

A reproduces the Phase 8 arrangement against today's code; **A is expected to succeed at
8 nodes and to be marginal at 16**, because the effective threshold is now 15 rather than
the 5 the published exclusion names (measured — see `<code_context>`). B pins the cap
back to 5 and is the control that shows the cap *can* still cause the failure. C isolates
the dial direction from the process split (decision 4). D is the phase's headline
configuration. E is D's cap control.

The published outcome is whichever of these is true, in these words: the rungs **run**
(and the report says at which threshold, in which direction, under which driver), or they
are **re-excluded with the observed error and the configuration that produced it**, and
the stated cause is whatever B and E actually show — not a paragraph carried forward.

Only the submitting node's options are needed for B and E under the in-process driver,
since it is the node receiving the dials there. Under D/E the submitter dials outward, so
each *agent* is the receiver; if a cap needs setting on the agent side, `bin/agent.ts`
gains a flag in the same shape as its existing four (`agent.ts:22-35`). Whether that flag
is needed is itself decided by the measurement, so add it only if C shows the direction
matters.

### Criterion 4 — provenance on every figure

**Structural, not editorial.** With `driver` and `fixture` on `RunConfig` (decision 7),
provenance travels into `raw.json` automatically and into every markdown row as a column.
The checks:

- `renderMarkdown` unit test: every `## Makespan` heading names its driver; every data row
  carries a driver cell and a fixture cell; the derived same-machine label still appears
  at least three times (`harness.test.ts:256-257` already asserts the last of these and
  must keep passing).
- A `*.node.test.ts` that reads the committed `.planning/BENCHMARK-RESULTS.md` and asserts
  every makespan heading contains one of the two driver labels, and that the previously
  published in-process rungs are still present. That second half is what "no figure is
  silently replaced" means operationally — the old numbers must still be findable in the
  file, not overwritten by the new ones.
- The `unmet` list (`bench.ts:462-487`) is rewritten, not appended to: its first entry
  currently says no parallel speedup is measurable "by construction", which stops being
  true for the new driver and stays true for the old one. It becomes a per-driver
  statement. The BENCH-06 entry stays, in its "descoped and unmeasured — not met" form.

### What cannot be measured here, said in those words

A same-host run **cannot** measure divergence between machines: one CPU, one V8, one
libc. Cross-machine reproducibility and distinct-machine benchmarking remain
**unmeasured, and unmeasured is not met**. Nothing in this phase changes that, and the
report must not read as though it did.
</specifics>

<deferred>
## Deferred Ideas

- **The user-count axis.** The methodology's §1.1 declares two axes swept separately, and
  says the super-linear claim can only live on the user-count one (N requestors + N
  nodes). This phase sweeps node count only. With the process driver in place the second
  axis becomes buildable for the first time — N driver processes each submitting a job —
  but it is a different measurement with a different falsification condition, and folding
  it in here would make neither one legible. Name it as the next benchmark phase.
- **Reduce-tree cost in the measured path.** `ROADMAP.md:427` (Phase 16, criterion 4)
  already owns this: `bin/bench.ts` should report the combine step rather than bypass
  `executeReduce`. Not this phase.
- **Lifting `spawnAgent` into `@o2/node`'s barrel.** Four copies now (decision 3). A
  shared export needs a production caller to be reachable, and the driver would be the
  only one; that is a Phase 22 conversation.
- **Bounding `EgressGuard.#entries`.** `ROADMAP.md`'s Phase 13.1 entry records this as a
  resource bound deliberately not fixed. The saturating fixture makes each run cost more
  time but not more frames, so this phase does not move the needle on it.
- **Wiring `sweepNodeCount`.** It would replace the two hand-written `for` loops
  (`bench.ts:387`, `:406`), but the loops carry per-rung `try`/`catch` and per-rung
  disposal (decision 10) that the current signature has no room for. Leave it unwired and
  let Phase 22's guard decide whether it is an export worth keeping.
</deferred>

## Risks — flagged, not resolved

**1. The published exclusion reason names a limit that is no longer in force.**
`BENCHMARK-RESULTS.md`'s exclusion table blames `INBOUND_CONNECTION_THRESHOLD = 5` per
host for both the 8- and 16-node real-transport rungs, and criterion 3 restates that
number as established fact. A default `FabricNode` on this machine measures **15** today
(`fabric-node.ts:294-301` with `RELAY_MAX_RESERVATIONS = 15`; confirmed by starting one
and reading `inboundConnectionThreshold`), and the coupling that produced 15 landed in
`f879b9d` **after** the harness commit `677a6d2` that produced the excluded rungs. So the
criterion's parenthetical is describing a version of the code that no longer exists. The
planner should not treat "the cap is still the cause" as the expected answer; attempt A
in the criterion-3 table exists precisely to find out, and if it succeeds the honest
report is that the rung was excluded against a limit that has since been raised.

**2. Phase 13.1 is an undeclared dependency, and its own roadmap entry says so.**
`ROADMAP.md:383`: *"The urgency is `bin/bench.ts`. It ships `const SHARDS = 8`, one below
a measured cliff at 12. The approved multi-process benchmark phase would otherwise publish
a scaling curve measured against an unfixed connection-killing limit, and the failure it
produces blames the wrong node — so a straggler analysis would be reading sender overrun
as receiver death."* Phase 23's declared dependencies are Phases 8 and 12 only
(`ROADMAP.md:553`). Decision 2 keeps `SHARDS = 8` and stays below the cliff, which is
enough to *run* — but any straggler or churn analysis layered on this curve is reading a
metric whose failure attribution is known to be wrong, and the 16-node rung dispatches
into a fabric where a sender-side stream bound can tear down a whole connection. The
planner should either sequence Phase 13.1 first or state in the report that the curve was
taken with the sender-attribution defect open.

**3. Nothing runs `bin/bench.ts` in CI, and this phase does not change that.**
The only tests that touch it read its source text (`bench-egress.node.test.ts:20-27`
explains why: `main()` executes on import, so exercising it means running the whole
benchmark). Every guard proposed above is either a pure-function unit test or a read of
the committed output file. That is the right trade, and it means **criterion 1's checks
protect a run nobody re-runs automatically** — they fire when a human runs the benchmark,
not when a change breaks it. Worth stating in the phase's own notes rather than
discovering later.

**4. The `--quick` path will diverge from the full path.** `QUICK` currently shortens the
runs and both ladders (`bench.ts:59-63`). A process driver at the full ladder spawns 31
agents across 5 rungs; at `--quick` it would spawn 7 across 3. Criterion 2's ratio is
defined at N=1 and N=8, and `--quick`'s ladder stops at 4 — so **the headline number
cannot be produced by a quick run**, and a quick run must not write a report that looks
like one. Either `--quick` writes to a distinct path, or the ratio section states which
ladder produced it. Planner's call; it needs to be an explicit one.

**5. Fixture cost was measured in isolation, not through the fabric.** The 80–118 ms
per-shard figures come from `WasmExecutor` driven directly in one process. Through the
real transport each shard additionally pays block fetch, canonical encode/decode and RPC
framing. Those costs are small relative to 90 ms on the published evidence (15.8 ms total
makespan for the whole trivial job at 4 nodes) but they are not zero, and the first
process-driver run should re-measure per-shard cost end to end before the ratio is
published. If a shard's observed status vector is anything other than eight `budget`
results, the fixture parameters are wrong for this host and `n` moves up.
</content>
</invoke>
