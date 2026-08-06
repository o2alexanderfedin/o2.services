# Phase 23: Multi-Process Benchmark Driver — Context

> **Numbers in this document are configuration choices or measurements, not derived claims.
> Any quantity describing runtime behaviour must be measured before it is written down
> anywhere, including in a source comment.**

**Gathered:** 2026-08-05, read-only pass, no tests run
**Status:** Ready for planning — **replaces** the 2026-07-28 gathering entirely
**Supersedes:** the previous `23-CONTEXT.md`, in which an independent audit measured **21 false
claims** and 3 unverifiable ones. That document was gathered against `bin/bench.ts` at 518 lines
and a `submit.ts` that placed each shard once. Neither is true now.

**Tree state this was measured against.** `HEAD` is `eb3e096` on
`feature/phase-18-discovery-capacity-placement`, and the working tree carries staged
modifications by a concurrent agent. Every reading below is taken against the **working tree**,
which is what a planner plans against and what an executor edits. Line *counts* quoted here are
approximate by a few lines and are given only as magnitude; **no claim here rests on a line
number** — see the next section.

**Retained for the reasoning, not the verdict.** Where a decision of the 2026-07-28 gathering
died, this document says what replaced it and why, with the date, rather than dropping it. A
decision deleted without a replacement is indistinguishable from one nobody thought about.

---

<citation_discipline>
## Cite by grep-able symbol. Never by line number. This is not a style note.

Six of the previous context's citations into `packages/bench` had rotted by the time the audit
read them — the symbols existed, every cited site was wrong. That is the same class as the
**41-of-46** citation rot this repository has already measured elsewhere, and it is why the old
23-03's whole "Task 2 read block" was wrong by 300–1100 lines.

`bin/bench.ts` says the same thing about itself, at `DECLARED_ADMISSION_LIMIT`'s docblock:

> *"**Cited by symbol and not by line, because both line citations here had rotted**: the first
> named `submit.ts:206` for a call that is now near 1468, the second `verify.ts:149` for one now
> at 188. A symbol a reader can grep survives the next edit; a line number silently starts
> pointing at something else."*

**A line-citing replan produces the seventh generation of this defect.** Every factual claim
below names a symbol. Every plan in this phase carries the same rule and repeats it, because a
rule stated once in a context document is a rule the executor of plan five never read. Where a
claim could not be verified by reading, it says **unverified** and says what would settle it.
</citation_discipline>

---

<domain>
## Success criteria, verbatim — all **five**

From `.planning/ROADMAP.md`, section `### Phase 23: Multi-Process Benchmark Driver`. **The
previous context transcribed four and missed criterion 5 entirely**, and no plan in the phase
directory carried `AUTH-03` in its front-matter. That is chronological rather than an oversight
in review: the plans were committed 2026-07-29 and criterion 5 was minted by owner ruling
2026-07-31. **Nothing in the previous plan set was ever written against this phase's actual
scope.**

> 1. A benchmark run at N nodes spawns N operating-system processes, verified by reading the
>    child PIDs, and the published run records them — a run that silently falls back to
>    in-process nodes fails the harness rather than reporting a curve
> 2. Makespan at N=1 and N=8 differ on a fixture with enough work to saturate a core, and the
>    ratio is published; a flat curve is a finding, but it must be a finding about the fabric
>    rather than about the harness
> 3. The two real-transport rungs Phase 8 published as excluded (8 and 16 nodes, dying on
>    `INBOUND_CONNECTION_THRESHOLD = 5` per host) either run, or are re-excluded with a
>    measurement showing the per-host inbound cap is still the cause under separate processes
> 4. `BENCHMARK-RESULTS.md` states, for every published figure, whether it came from the
>    single-process or the multi-process driver — no figure is silently replaced
> 5. **`bin/bench.ts` gains an opt-in sovereign leg, off by default, that mints a real
>    capability chain and dispatches an owner-labelled shard through it** — giving `delegate`
>    and `CapabilitySupplier` a traced call path from a runnable entry point, so Phase 22's
>    guard finds them reachable. The default public curve must be **byte-identical in shape** to
>    a run with the flag absent; if the leg moves the default measurement, it has been built
>    wrong

### The roadmap's own prose on criterion 5, verbatim

> **Criterion 5 exists because of an owner ruling, and the alternative was cheaper to write down
> than to take.** Phase 15 wired AUTH-03's *serving* end and verified it end to end, but left
> `delegate`, `CapabilitySupplier` and `RemoteExecutor.execute`'s supplier branch as a
> production adapter with **zero production callers** — every one of the five production
> dispatch sites labels its shards `'public'`, which have no owner and therefore no root key to
> mint a chain at. That is the exact "built, not wired" shape this milestone exists to remove,
> so shipping it as *accepted unreachable* was declined on 2026-07-31.
>
> It lands **here** rather than in Phase 15 for one reason: this phase already rewrites
> `bin/bench.ts`'s node construction, and `bin/bench.ts` is the most contended file in the
> repository — six phases modify it. Doing the sovereign leg in Phase 15 would have meant
> fighting that file twice. The costs Phase 15 measured still apply and are the work of
> criterion 5: `realFabric`'s worker nodes start with no `sovereignty` configuration at all, so
> each needs an owner id, an owner key and clearance; the requestor needs a per-node chain
> minted against each worker's peer id; and `memoryFabric`'s nodes are raw `serveAgent` calls on
> `authorize: 'serves-unauthenticated'`, so the leg proves nothing there — which is precisely
> why it must stay opt-in and why the two published curves must keep measuring the same thing.

### And the trap, verbatim

> **Trap to avoid.** The COST crossover published at ~570× measures the guest ABI on a trivial
> fixture, not the fabric. Criterion 2 requires a fixture that does non-trivial work, or the new
> curve reproduces the old one's real problem with more processes.

**The roadmap's `~570×` is itself stale.** `.planning/BENCHMARK-RESULTS.md`, run at
`2026-08-01T06:09:01.272Z`, publishes *"a factor of **7086.14×**"* at 1 node against a baseline
p50 of 0.0032 ms. The trap's *argument* is unaffected — a trivial fixture measures the guest ABI
— but its number must not be quoted forward. Cite the published figure or re-measure.

## Phase boundary

**In scope:** BENCH-07 — a third driver that spawns N operating-system processes; a fixture that
does enough work for a speedup to exist; a re-measurement of the excluded real-transport rung(s);
provenance on every published figure. **Plus AUTH-03's requestor half** (criterion 5), routed
here by owner ruling 2026-07-31.

**Out of scope, and it must stay out:** anything needing a second machine. BENCH-06's
distinct-machine half is **descoped and unmeasured — not met**. One host has one CPU, one V8 and
one libc, so a same-host run cannot detect divergence between machines whatever the process
count. Nothing this phase produces may be published as a cross-machine result. Also out of scope:
the browser tier, and the user-count axis of the methodology's §1.1.

## Every node is the same node

Nothing here keys on a kind of node, and three separate source files say so about themselves.
`bin/agent.ts` on `--owner-id`: *"this is a per-node clearance flag, not a node kind: every agent
process built by this binary has identical capability regardless of whether it is passed."* On
`--port`, about a node that binds nothing: *"**Not a node kind.** A node that binds nothing has
identical capability to one that binds a port … It is reachable by a different route, which is a
fact about routes."* `FabricNodeOptions.sovereignty`: *"a per-node clearance, not a node class."*

`Machine.roles` already models role as data, and `inventory()` in `bench.ts` now declares
`roles: ['worker', 'requestor', 'aggregator']` — three entries, with `aggregator` newly true
rather than declared-and-never-true, *"because the same processes now run combines as well as
`exec`."*
</domain>

---

<findings_driver>
## The driver as it actually is — `packages/node/src/bin/bench.ts`

**~1713 lines** (518 when the previous context was written). Every symbol below is a top-level
declaration in that file, grep-able by name.

### Flags and declared constants

| symbol | what it is |
|---|---|
| `DISCOVER` | `process.argv.includes('--discover')`. **The structural precedent criterion 5 must copy** — see below. |
| `QUICK` | `process.argv.includes('--quick')` |
| `RUNS` | `QUICK ? 6 : 20` |
| `LADDER` | `QUICK ? [1, 2, 4] : NODE_LADDER` |
| `REAL_LADDER` | `QUICK ? [1, 2] : NODE_LADDER` |
| `SHARDS` | **`16`** — see its docblock below |
| `DECLARED_ADMISSION_LIMIT` | `64`. Stated at *every* node-construction site in the file from this one constant, and printed in the report. |
| `BENCH_SIGNING_SEED` | `new Uint8Array(32).fill(0x2b)` — the driver's own build authority (DET-03/DATA-08) |
| `BENCH_MODULE_NAME` | `'o2-bench-fixture-module'` |
| `FIXTURE_MODULE_CID` | top-level `await new MemoryBlockstore().put(MODULE_WRITES_PARTITION)` |
| `FIXTURE_RECORD` | `signName(BENCH_SIGNING_SEED, {...})`, one hour expiry, covers **all three rigs** |
| `BENCH_TRUST_ANCHOR` | `FIXTURE_RECORD.signer` — read off the record, not re-derived |
| `BENCH_USER_SEED` | `new Uint8Array(32).fill(7)` — the user key every `--discover` worker enrols under. **Declared between `memoryFabric` and `realFabric`, not at the top.** This is the pattern criterion 5's owner key follows. |
| `partitionOf` | reads the 4-byte LE partition index out of a fixture output |
| `project` | the agreed-output → `{counts, rows}` projection the reduce leg walks |

### Functions and types

| symbol | one line |
|---|---|
| `sameFixtureCid(rig, moduleCid)` | throws if a rig's store addressed the fixture differently from the signed record — converts a whole-rig silent zero into one named throw |
| `guarded(inner)` | wraps an `Executor` in `guardModuleProvenance` with a **fresh** `SignedNameResolver([BENCH_TRUST_ANCHOR])` per node |
| `inventory(nodeCount)` | one `Machine` from `node:os`; `physicalCores: 0` deliberately; `roles: ['worker','requestor','aggregator']` |
| `shardInputs(skew)` | `SHARDS` `{partition, payload}` values; `skewed` inflates partition 0 to 4096 B |
| `timed(inner, into)` | wraps an `Executor` and accumulates wall time gross + per node — this is where node-seconds come from, since `JobResult` reports fuel |
| `interface Fabric` | the seam a third fabric implements — **now 10 members**, see its own section |
| `memoryFabric(nodes)` | `MemoryNetwork`; one guarded requestor endpoint + N worker endpoints; **both** `serveAgent(` call sites live here |
| `dialableAddr(node)` | first `/tcp/` non-`/p2p-circuit` multiaddr, or throw |
| `realFabric(nodes)` | N+1 (default) or **N+2** (`--discover`) real `FabricNode.start` calls in *this* process |
| `type NoJobToAttest` | `'no-run-of-this-rung-returned-a-job'` — WIRE-01 named absence |
| `interface RungAttestation` | one rung's receipt **with the population it was read off** |
| `type NoReduceToAttest` | `'no-reduce-ran-on-this-rung'` |
| `attestationReading(held)` | `{population, reading}` — the map half (VER-09/VER-10) |
| `aggregateReading(held)` | the aggregation's own receipt, or `null` |
| `coverageReading(held)` | the owner denominator, or `null`. **Returns `null` on every rung of this driver today**, because every shard is `label: 'public'`. The *silence* is what `coverage-agents.node.test.ts` reads — see the guard section |
| `runnerFor(build)` | caches one `Fabric` per node count in a `Map`; returns `{run, egressTotals, attestationFor, dispose}`; `dispose` closes **all** cached fabrics at the end |
| `baseline(runs)` | single-threaded native, no WASM, no fabric — the COST denominator |
| `wasmInProcess(runs)` | the same work through `guarded(new WasmExecutor(` in-process, no fabric |
| `main()` | the sweeps, the exclusion `try`/`catch`, report assembly, both file writes; `await main()` runs on import |

### `const SHARDS = 16` — and its docblock refutes the old plan's cliff rationale directly

The previous context's **decision 2 ("`SHARDS` stays 8")** and **Risk 2 ("Phase 13.1 is an
undeclared dependency")** are both dead. `SHARDS` is `16`, and the constant says why:

> *"Raised from 8 to 16 by phase 13.1. 8 was one below a measured cliff: dispatching 12 shards
> immediately after dial aborted the whole libp2p connection with `MaxEarlyStreamsError`, so the
> benchmark shipped just under a limit that would have killed it, and a published curve would
> have been measured against an unfixed connection-killing bound. **NET-09's per-peer send gate
> removes the cliff**, and running above it here is what demonstrates that on the production
> benchmark path rather than only in a test. 16 is comfortably past 12 and still a count a
> reader can hold in their head against the node ladder."*

**Consequences the planner must carry:**
- Any fixture requiring a power-of-two partition count is still satisfied (16 is one).
- `PREREGISTERED_IDEAL_SPEEDUP = 6.3` and the "8 shards / 740 ms serial" table in the previous
  23-01/23-03 are keyed to `SHARDS = 8`. A `calibratePerShard` written against them would run 16
  iterations against a 6.3× expectation. **The pre-registration has to be re-taken at 16**, and
  it must be taken *before* the run it constrains or it is not a pre-registration.
- Phase 13.1 shipped. It is no longer an undeclared dependency.

### `const DISCOVER` — the structural precedent criterion 5 must copy

Everything conditional on `DISCOVER` is confined to `realFabric`. Its docblock is the argument
criterion 5 needs, already written and already accepted:

> *"`discoverCandidates` (`@o2/net`) must be reachable from one of the five runnable entry points
> or Phase 22's guard fails on it … **This is that path.**"*
>
> *"**Why it is off by default.** 15-CONTEXT.md decision 2 — a published scaling curve must not
> be reshaped by a change nobody declared. With the flag absent, `realFabric` builds exactly what
> it built before this flag existed, down to the enrollment round trip not happening at all. The
> default run measures what it measured yesterday."*
>
> *"**Read the same way `--quick` is read.** `process.argv.includes`, not `parseArgs`. The plan
> called for `parseArgs`, and this file has none."*

**What the arm actually adds, by symbol** — all of it inside `realFabric`, all of it skipped by a
default run:

1. `let provider: FabricNode | undefined`, started only `if (DISCOVER)`, with
   `issuesCertificates: 'issues-without-an-aggregate-budget'` and
   `trustAnchors: [BENCH_TRUST_ANCHOR]`. **This is why a `--discover` rung has N+2 node processes
   and a default rung has N+1.**
2. `providerAddr = provider === undefined ? undefined : dialableAddr(provider)`.
3. Each worker gets a conditional **spread** of `enrollment: { userPrivateKey: BENCH_USER_SEED,
   operatorId: bench-worker-i, providerAddr }` — spread rather than a conditional field,
   because `exactOptionalPropertyTypes` makes an explicit `undefined` different from an absent
   key, *"and on the default path this key must be absent — a worker that enrolled would publish
   a certificate, which is a change to what the default rig IS and not only to how fast it
   runs."*
4. The requestor gets `...(provider?.issuerKey == null ? {} : { trustedIssuers: [provider.issuerKey] })`.
5. `if (DISCOVER)` the **requestor dials each worker** (the default path only has workers
   dialling the requestor), each worker is handed the module block explicitly, and
   `await discoverCandidates({inputCid: moduleCid}, {...})` replaces `executors`/`descriptors`.
6. A stdout line: `--discover: N of M workers qualified from P providers[, K excluded]`, and a
   throw if zero qualified — *"refusing to report a curve measured on nothing."*
7. `...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {})` on the returned `Fabric` —
   **absent, not `undefined`**, because `submitJob` branches on `spec.admit === undefined`.
8. `combineIssuers` becomes `new Set([provider.issuerKey])` instead of
   `'checks-no-combine-signatures'`.

**Copy all eight properties of that shape, not just the flag.** In particular: opt-in via
`process.argv.includes`; every new construction confined behind the branch; conditional
**spreads** rather than conditional fields; a printed line that says the arm ran; a throw rather
than a silent zero; and a report line stating the two runs are not comparable.

### The hardcoded excluded-rung paragraph — the real defect the `exclusion.ts` idea was meant to fix

Inside `main()`'s real-transport loop, the `catch (cause)` converts **any** thrown error into an
excluded row whose `reason` is a fixed paragraph asserting that libp2p caps inbound connections
at `INBOUND_CONNECTION_THRESHOLD = 5` per host, that beyond ~5 concurrent dials to the requestor
the noise handshake is killed, and that this is *"a same-machine artifact of a documented
default, not a property of the fabric."*

The only thing read off the error is `detail` — its message, interpolated. The cause is
**asserted for every failure mode there is**.

This is fatal to two criteria if left alone, and the reasoning survives verbatim from the
previous context:

- Criterion 1 requires that a run which silently falls back to in-process nodes **fails the
  harness rather than reporting a curve**. Under this shape a failed PID check would be caught
  here and published as a rung blamed on a libp2p limit.
- Criterion 3 requires a *measurement* showing the cap is the cause. This code asserts that cause
  unconditionally.

**Carry the `exclusion.ts` idea forward verbatim** — derive an excluded row's reason from the
observed error (its class, its message, and the configuration in force) rather than hardcode it,
with any interpretation stated as interpretation. The paragraph is still there and is still the
defect.

### There is still no `bench` npm script

Root `package.json` exposes 12 scripts today; none of them runs this driver. It is run by hand:
`node --experimental-strip-types packages/node/src/bin/bench.ts [--quick] [--discover]`, as the
file's own header says. **"12 scripts, not 4" corrects the old context; "no bench script" was and
remains TRUE.**
</findings_driver>

---

<findings_guards>
## Four guards constrain every edit to `bin/bench.ts`. The previous context named two.

### 1. `bench-egress.node.test.ts` (~273 lines) — seven named call-site requirements

It strips comments, then requires **seven** named requirements to be satisfied by the remaining
text, and proves it can report each one absent by planting. The seven, by their own declared
names:

1. `realFabric` hands the submitting node's own tap to the job path
2. `memoryFabric` builds a tap for the submitting endpoint and supplies that same one
3. the measured job path calls `submitJobWithEgress` with a guard array
4. the returned manifest is read, not merely requested
5. the run declares one admission limit to both rigs and prints it in the report
6. the benchmark holds its own signing key and signs a record per rig
7. every rig wraps its executor and every rig's spec carries the record

It additionally asserts `BENCH_SOURCE.length > 5_000` and that the source still contains
`async function memoryFabric` and `async function realFabric`. **Renaming either function, or
*replacing* `realFabric` with a process fabric rather than *adding* one, fails this test.**

### 2. `serve-agent-hooks.node.test.ts` — sixteen pinned counts over this file

| pattern in `bin/bench.ts` | pinned to |
|---|---|
| `'serves-unauthenticated'` | 2 |
| `'serves-no-records'` | 2 |
| `'accepts-every-offer'` | 0 |
| `new LocalCapacity(` | 2 |
| `'keeps-no-ledger'` | 2 |
| `'relays-for-nobody'` | 2 |
| `'reports-no-dispatch'` | 2 |
| `'issues-no-certificates'` | 2 |
| `'signs-nothing'` | 2 |
| `attest:` | 2 |
| `'holds-no-registrations'` | 2 |
| `guardModuleProvenance(` | 1 |
| `guarded(new WasmExecutor(` | 3 |
| **`'dispatches-unauthenticated'`** | **3** |
| **`new RemoteExecutor(`** | **2** |
| **`await discoverCandidates(`** | **1** |

The last three matter to criterion 5. The `'dispatches-unauthenticated'` count is **3**, not 2:
two `RemoteExecutor` constructions plus `discoverCandidates`' required `dispatch` option. The
guard's own comment records why that number moved and warns against the obvious repair:

> *"The plan for 18-06 said this count must stay at 2. It could only have stayed at 2 by hoisting
> the literal into a constant, which would have taken it to 1 and made the floor this file exists
> to hold unreadable — a worse outcome than a number that moved for a stated reason."*

The same file classifies each expected number as **"which choice this call site wrote down"**,
and says of the bench sites that they are a *"floor that is also the ceiling"* on the ground that
*"every one of these five dispatch sites submits `label: 'public'` shards"*. **Criterion 5
falsifies that specific ground** for whichever site it changes. The plan must therefore update
the row *and its comment together*, and say that the floor is now conditional on the leg rather
than permanent. Leaving the number to be "fixed" by a later reader is exactly the decoration this
file exists to prevent.

### 3. `discover-arm.node.test.ts` (~240 lines) — the verification shape criterion 5 copies

It `spawn`s `bin/bench.ts --discover` with `cwd` in a temporary directory, reads the `--discover:`
line off stdout, and kills the driver once the arm has spoken — roughly 4 s, because the arm
speaks while the first real rig is being built. Its own header states the two constraints that
make this work: `main()` writes under `process.cwd()`, so a repo-cwd spawn would overwrite the
committed measurements; and *"**This is not a benchmark and must not become one** … It reads a
count, which is contention-independent, and never a duration."* It also compares
`git status --porcelain` across the run. Its sibling `bench-attestation.node.test.ts` (~505
lines) carries the slow readings for the same reason, with measured spans (t+62 s, t+153 s,
t+213 s).

### 4. `coverage-agents.node.test.ts` — **named by neither input document, and it is the tightest of the four**

Corrected 2026-08-05. Under `describe('CHURN-05 — the benchmark driver renders coverage only
where a job defines owners')` it does all of this to `bin/bench.ts`:

- **Spawns `bin/bench.ts --quick`** in a temporary `cwd`, with `stdio: ['pipe','pipe','pipe']`
  (its comment cites `orphan-leash.node.test.ts` for the fd-0 rule), a 180 s budget, and asserts
  `code === 0`.
- **Anti-vacuity, and it is an equality over stdout headings**:
  `[...stdout.matchAll(/^ {2}(memory|real) transport, (\d+) node\(s\)…$/gm)]` must be
  **exactly** `['memory/1','memory/2','memory/4','real/1','real/2']`, and stdout must contain
  `map attestation (`.
- **The silence**: stdout must *not* match `/covered: \d+\/\d+ owners/`, must not contain
  `PARTIAL`, must not contain `owner coverage (`.
- **Source pins**: `coverageReading(` occurs exactly **2** times, and the source contains the
  literal `if (coverage === 'defines-no-owners') return null`.
- **Output discipline**: `join(cwd, '.planning', 'bench')` must be a directory after the run,
  the repository's `.planning/BENCHMARK-RESULTS.md` must be byte-identical across the run, and
  `git status --porcelain -- .planning/BENCHMARK-RESULTS.md` must be empty. It reads that one
  path deliberately rather than the whole tree, *"because `discover-arm.node.test.ts` and
  `bench-attestation.node.test.ts` both snapshot the whole tree's status and both went red during
  Plan 20-09's runs because another agent staged a file mid-run."*

**Three consequences no previous plan carried:**

- **A `--quick` run must keep writing under its own `process.cwd()`.** The previous 23-03
  proposed redirecting quick output to `join(tmpdir(), 'o2-bench-quick')`. That is now
  **refuted by a committed test** — `stat(join(cwd, '.planning', 'bench'))` would fail. The
  existing mechanism already gives the property that plan wanted: `main()` writes under
  `process.cwd()`, and every spec that runs the driver spawns it with a temporary `cwd`.
- **Any new per-rung stdout heading must not match `/^ {2}(memory|real) transport, (\d+) node\(s\)…$/`.**
  A process-per-node sweep that printed `  real transport, 8 node(s)…` would break an equality
  assertion in a file that has nothing to do with this phase.
- **The default `--quick` run must print no coverage line.** That is the existing, already-green
  proof that criterion 5's leg is off by default, and it is free.

### Cross-cutting

- **Three of these four specs compare `git status --porcelain` across their own runs** (two
  whole-tree, one narrowed to a single path). With concurrent agents in one tree, `git add`
  mid-run reddens them for reasons unrelated to any code.
- **`vocabulary.node.test.ts`** scans every git-tracked file with a small set of path exemptions,
  none of which covers `.planning/BENCHMARK-RESULTS.md`, `.planning/bench/`,
  `.planning/BENCHMARK-METHODOLOGY.md`, or this phase directory. **Generated report prose and
  every plan in this phase are in scope.** Read its `BANNED` array before writing any new report
  string, and do not restate the prohibited words anywhere — a document quoting them violates it.
</findings_guards>

---

<findings_job_path>
## The job path after Phase 20 — and what it does to the measurement

`packages/core/src/job/submit.ts` is **~3205 lines**. The previous context described *"plans
placement sequentially with a `dispatchCount` nudge, then runs every shard concurrently through
one `Promise.all`"*. **That model is gone**, and the whole makespan argument rested on it.

**Phase 20's blast radius is lexically clean and semantically severe.** `runResilient` and
`coordinator.ts` are deleted, and the previous Phase 23 plans contained **zero** direct hits on
deleted symbols. A name-based scan of those plans therefore came back clean and was misleading:
every plan reasoned about a job path that no longer exists.

### What a shard actually goes through now, by symbol

| symbol | where | what it does |
|---|---|---|
| `submitJob` | `job/submit.ts` | encodes and stores every shard input; recovers any checkpoint; plans the **first** generation for the whole job; then runs an independent generation loop per shard |
| `resumeState` → `recoverCheckpoint` | `job/submit.ts` → `checkpoint.ts` | resumes carried shards. `bin/bench.ts` passes `checkpoints: 'checkpoints-nothing'`, so nothing is recovered on this path — stated at the call site, deliberately, because *"a checkpoint that let a later run skip shards would corrupt the makespan it exists to measure"* |
| `carriedResult` | `job/submit.ts` | builds a `ShardResult` for a shard carried in from a checkpoint |
| `planPlacement` / `planWithOffers` | `sovereignty.ts` / `placement.ts` | the first generation's placer. Which one runs is decided by `spec.admit === undefined` — **`planPlacement` on the default bench arm, `planWithOffers` on `--discover`** |
| `LeaseTable` | `lease.ts` | **one table per job.** `new LeaseTable({ maxGenerations: DEFAULT_MAX_GENERATIONS })`. It is the bound *and* the record of why a shard stopped |
| `DEFAULT_MAX_GENERATIONS` | `lease.ts` | **`3`** |
| the `for (;;)` generation loop | inside `submitJob` | per shard: `leases.grant` → `dispatchUnderLease` → decide → `placeAgain`. Three exits, all named on `ShardEnding`: agreed/disagreed, `no-untried-node`, `generations-spent`. **No `redundancy === 1` guard anywhere in it** |
| `dispatchUnderLease` | `job/submit.ts` | runs one generation under its lease; renews **only against evidence** from `probeHolder`; may start a speculative duplicate |
| `dispatchCopy` | `job/submit.ts` | converts one dispatch into a `Copy` whose `raced` promise is built **once** and re-raced |
| `probeHolder` | `job/submit.ts` | asks the holder, through `spec.admit`, whether the task is still in flight. **`null` when `spec.admit` is absent — which is the default bench arm — so on that arm a lease can only lapse, never renew** |
| `placeAgain` | `job/submit.ts` | places a shard again on an untried node. Uses `planPlacement` when `admit` is undefined, `planWithOffers` otherwise |
| `mergeVerifications` | `job/submit.ts` | folds two generations of one shard into the single result that shard actually got |
| `compareOutstanding` | `job/submit.ts` | after every shard settles, gives losing copies a bounded grace to answer |
| `jobAttestationOf` | `job/submit.ts` | takes the **weakest** shard's receipt as the job's |
| `speculativeCandidates` | `speculation.ts` | nodes a duplicate may run on. **Does not read redundancy at all** |
| `SpeculationLedger` | `speculation.ts` | job-wide budget, `allowance = floor(tasks × fraction)` |

### The finding, stated as this context's own decision rather than as a footnote

**At redundancy 1 a shard can be placed up to `DEFAULT_MAX_GENERATIONS` (= 3) times on different
nodes, *and* duplicated by straggler speculation.** Neither is gated on redundancy:

- `placeAgain` sits inside the unconditional `for (;;)` loop. There is no `redundancy === 1`
  branch anywhere on that path. `LeaseTable` is the only bound, and it bounds *generations*, not
  replicas.
- `speculationEnabled = ledger.allowance > 0`. `DEFAULT_SPECULATION_FRACTION` is `0.1`, so at
  **`SHARDS = 16` the allowance is `floor(16 × 0.1) = 1`** — speculation is **on** for this
  driver's jobs, with a job-wide budget of exactly one duplicate. (Below ten shards the allowance
  is zero and the watchdog is never started; 16 is above that threshold.)
- `DEFAULT_STRAGGLER_FACTOR = 1.5` and `MIN_SAMPLES = 3`: a shard is duplicated once at least
  three shards have finished and it is slower than 1.5× their median.
- The `speculation` object `submitJob` builds passes `requestFor(shard, shardId, 1)` — one extra
  copy — and the comment at that construction states the reason plainly: *"`eligibleNodes`, which
  is all `speculativeCandidates` consults, **does not read redundancy at all**."*

**Therefore: a `p50(N=1) / p50(N=8)` makespan ratio is NOT a clean parallelism measurement unless
`generations` and `speculated` are published beside it.** The old context's decision 9 held
redundancy fixed at 1 in order to remove a second variable from the ladder; that removal is now
insufficient, because two further mechanisms vary the dispatch count without varying redundancy.
This is D9 below, and it is a decision rather than an observation.

### Half of that confound is already published — and it currently reads as zero

`bin/bench.ts`'s observation assembly reads both figures off the job that just returned —
`speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0` and
`redispatches: result.ok ? result.job.redispatches : 0` — with a comment recording that both were
literals until 20-09 and are measurements now: *"**A run in which nothing straggled still prints
1.00, and that is now a measurement rather than the identity.**"*

**Measured, from the committed `.planning/BENCHMARK-RESULTS.md` (run 2026-08-01):** every rung of
both published curves reports `spec. tax 1.00×` and `churn/task 0.00`. So on the *trivial*
fixture, at `SHARDS = 16` and `redundancy = min(2, nodes)`, in-process, **nothing was speculated
and nothing was re-dispatched**.

**What that does and does not establish.** It establishes the mechanism is instrumented and was
quiet. It does **not** establish it will stay quiet under a saturating fixture, under separate
processes, at redundancy 1, or on an oversubscribed host — every one of which changes the timing
the straggler test reads. **Unverified**, and what would settle it is a run of the new driver with
those two columns and a per-shard `generations` vector read off the result. **Plan for publishing
them beside the ratio, not for adding them: they already ship.** Assume nothing from the
trivial-fixture zeros.

### One live false citation in the file Phase 23 most depends on

`placeAgain`'s docblock in `submit.ts` cites *"the reason is `coordinator.ts`'s `runShard`, whose
loop this borrows its reasoning from"* — **`coordinator.ts` is deleted**. This is a production
defect outside Phase 23's scope; it is recorded here because a planner reading that docblock for
the job-path model will chase a file that does not exist.
</findings_job_path>

---

<findings_spawn>
## The spawn story, and what it actually blocks

### `bin/agent.ts` has **16** flags, not 4 — and not 14

Counted over the single `parseArgs({ options: { … } })` call, in declaration order: `--dir`
(required), `--port`, `--owner-id`, `--owner-key`, `--can-execute-sovereign`, `--trust-anchor`,
`--provider-addr`, `--user-key`, `--operator-id`, `--trusted-issuer`, `--peer-addr`,
`--max-concurrent-tasks`, `--duty-cycle`, `--issues-certificates`, `--max-issued-per-window`,
`--relay-addr`. The one-line `USAGE` string in that file is the authoritative grammar; read it
rather than this list if they ever disagree.

Two of them carry rules a spawn site must honour: `--provider-addr` requires `--user-key` **and**
`--operator-id` or the process exits 2; `--owner-id` must equal the `--user-key`-derived key when
both are given, or exit 2.

### `--port` has no default. **The audit overstated what that blocks, and the overstatement matters.**

The declaration is `port: { type: 'string' }`, changed 2026-08-04. Its docblock:

> *"It carried `default: '0'` until 2026-08-04, and that default was load-bearing in the wrong
> direction: with it, `values.port` is `'0'` whether an operator typed `--port 0` or typed
> nothing, the listen list below could not be written conditionally, and so **no argv could
> produce a node that binds nothing**."*

The `listen` expression, and the file's own three-row table:

```
const listen =
  values.port !== undefined
    ? [`/ip4/127.0.0.1/tcp/${values.port}`]
    : relayAddrs.length === 0
      ? ['/ip4/127.0.0.1/tcp/0']
      : []
```

| `--port` | `--relay-addr` | binds | `canRelay` | certificate |
|---|---|---|---|---|
| given | either | that port | true | `seed`, `relayIds: []` |
| absent | absent | `tcp/0` | true | `seed`, `relayIds: []` |
| absent | **given** | **nothing** | false | `via-relay`, the relay named |

**So a bare `spawn(process.execPath, [AGENT, '--dir', dir])` still binds `/ip4/127.0.0.1/tcp/0`**
— row two. The docblock says so in as many words: *"Dropping the default costs nothing anywhere
else: `undefined` and no `--relay-addr` reaches the same `/ip4/127.0.0.1/tcp/0` it always did."*
It also names the only existing sites that had to change: *"Every pre-existing spawn site of this
binary that passes `--relay-addr` therefore states `--port 0` — three call sites, all in
`reservation-exhaustion.node.test.ts`."*

**The audit's F1 — "the plans' spawn shape now produces an agent that binds nothing" — is FALSE
as written, and it was never a blocker.** It is recorded here as a correction rather than
propagated, because this repository's documented failure mode is exactly a false claim surviving
because it read like evidence.

**What is nevertheless true, and is the real constraint:**

- **State `--port 0` explicitly the moment a spawn invocation also states `--relay-addr`.** A
  process-backed fabric that later grows relay support — or that copies an argv list from
  `reservation-exhaustion.node.test.ts` — otherwise gets a node that binds nothing and a
  submitter with nothing to dial, with no error anywhere.
- `--port 0` is what every such site writes: the OS assigns, so parallel spawns cannot collide.
- The distinction is **not** a node kind. The same docblock: *"A node that binds nothing has
  identical capability to one that binds a port … It is reachable by a different route, which is
  a fact about routes."*
- **Recommendation for the driver:** pass `--port 0` explicitly at every spawn site, and say at
  the call site that it is stated rather than defaulted. It costs one argument pair and removes a
  whole class of silent failure from a rig whose failure mode is a curve rather than an
  exception.
- The driver will also need `--trust-anchor <BENCH_TRUST_ANCHOR>` on every child, or every shard
  is refused as a `cid-mismatch`/unsigned-record — `sameFixtureCid` and `guarded` are how the
  in-process rigs get this today, and a spawned child gets it only from argv.

### The spawn harnesses that exist, and the pattern to copy

There is **no shared spawn helper**. Roughly twenty node-tier specs each declare their own
`spawnAgent`, and the shape is identical across them. `two-process.node.test.ts` and
`sovereignty-placement.node.test.ts` carry byte-identical copies of the function; the second adds
an `extraArgs` parameter.

**The canonical shape**, from `two-process.node.test.ts`:

- `const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))`
- `spawn(process.execPath, [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
  { stdio: ['pipe', 'pipe', 'pipe'] })`
- **`stdio[0]` must be `'pipe'`, never `'ignore'`.** The child watches fd 0 and exits when it
  closes; `'ignore'` puts `/dev/null` there and silently opts the caller out of the orphan leash.
  `orphan-leash.node.test.ts` demonstrates and guards this. The previous context transcribed
  `['ignore','pipe','pipe']` — **wrong, and it would leak agent processes out of a benchmark
  run.**
- Handshake: a 30 s timer, accumulate stdout to the first `\n`, `JSON.parse`, reject on early
  `exit` with the accumulated stderr.
- `type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>`
- `interface Agent { peerId; multiaddrs; dir; child }`, built as `{ ...handshake, dir, child }`.
- Teardown: SIGTERM, wait for `exit`, SIGKILL after a grace.

**How the child's identity comes back.** `bin/agent.ts` writes **one** JSON line to stdout, and it
now carries nine keys, not two:

```
{ peerId, multiaddrs, trustAnchors, nodeKey, certificate, issuerKey, peers, dutyCycle, relays }
```

Every existing reader parses it as `{peerId: string; multiaddrs: string[]}` and reads only those
two, so **adding a key is backwards-compatible by construction** — which is what makes the
previous context's decision 5 (announce `process.pid` on this line, and assert
`handshake.pid === child.pid`) still correct and still cheap. `relays` is `node.circuitAddrs`,
i.e. relays that actually granted rather than relays that were asked; `[]` is a statement.
**There is no `pid` key today.**

**Dial direction.** The spawn harnesses have the **submitter dial each agent**. `realFabric`
today has it the other way — every worker dials the requestor
(`for (const node of started) await node.libp2p.dial(requestor.libp2p.getMultiaddrs())`) — except
on the `--discover` arm, where the requestor additionally dials each worker so it has peers of
its own to query. Adopting the spawn pattern therefore changes **two** things at once: the
process split and the dial direction. Only one of them is what BENCH-07 is about. The previous
context's **decision 4 survives and is re-derived** — see D4.
</findings_spawn>

---

<findings_fabric>
## The `Fabric` seam — **10 members now, not 5 and not 8**

The previous context recorded five (`executors, blockstore, moduleCid, guard, close`). The audit
found eight. **It is ten today**, and the two the audit missed are the two that most constrain a
third implementation. Verbatim, comments abridged:

```ts
interface Fabric {
  readonly executors: readonly Executor[]
  readonly nodes: readonly NodeDescriptor[]
  readonly blockstore: MemoryBlockstore
  readonly moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly moduleRecord: NameRecord
  readonly guard: EgressGuard
  readonly rpc: RpcEndpoint
  readonly admit?: AdmissionControl
  readonly combineIssuers: CombineTrustAnchors
  close(): Promise<void>
}
```

**What a third, process-backed implementation must supply, member by member:**

| member | what a process fabric owes it |
|---|---|
| `executors` | one `RemoteExecutor(childPeerId, requestor.rpc, <chain or sentinel>)` per spawned agent. This is where criterion 5's supplier goes on the real leg |
| `nodes` | **new since the old context.** *"Carried on the rig rather than derived in `runnerFor`, because the two arms derive it differently and only the rig knows which arm it is."* Default arm: `publicNodes(executors)`, which synthesises `ownerId: 'public'`, `canExecuteSovereign: true`, `load: 0`, `certificate: 'carries-no-certificate'`. Discover arm: the descriptors `discoverCandidates` returned, carrying a real `ownerId` and `canExecuteSovereign` off each node's signed capability record |
| `blockstore` | the submitting node's store. `realFabric` supplies `requestor.store as unknown as MemoryBlockstore` — the cast is the existing escape hatch and a process fabric inherits it |
| `moduleCid` | must pass `sameFixtureCid('<rigName>', …)` or the rig throws at construction |
| `moduleRecord` | **new since the old context.** `FIXTURE_RECORD`. `runnerFor` attaches it to the `JobSpec`, so `submitJob` copies it onto every `Task`. Without it every rig refuses every shard |
| `guard` | the submitting node's `EgressGuard`. `realFabric` surfaces `requestor.egress`; a process fabric does the same, because the requestor stays in-process |
| `rpc` | **new since the old context.** `requestor.rpc`. Every `RemoteExecutor` is built over it, and combine nodes fetch their leaves back through *this* endpoint's `serveAgent`. *"A second endpoint would be a second peer as far as the workers are concerned"* |
| `admit?` | **absent, not `undefined`**, on any arm that must place with `planPlacement`. `submitJob` branches on `spec.admit === undefined` |
| `combineIssuers` | VER-08/09/10. `'checks-no-combine-signatures'` on a rig that pins nothing; `new Set([provider.issuerKey])` on a rig that does. **The same set the rig already pins, resolved once** |
| `close()` | stop every child (SIGTERM → wait → SIGKILL), stop the in-process requestor, `rm` the temp root |

**The submitting node stays in-process.** It must hold `.store` to `put` the module and be handed
to `submitJobWithEgress` as the blockstore; it must expose `.egress` for the manifest leg (pinned
by `bench-egress.node.test.ts`); and `RemoteExecutor` needs its `.rpc`. Moving it into a child
would require an RPC to retrieve the manifest, which 13-CONTEXT.md already deferred as unneeded.
**So each rung runs one node process per node *plus* the driver's own node** — and, if the leg
needs a provider, one more again. The observed process count at a rung is therefore N+1 or N+2,
not N.

**Consequence for the old plans:** the old 23-02's `bench-fabric.ts` contract and 23-03's
`processFabric` were written against a five-field seam and would not type-check. Re-derive both
against the ten members above.
</findings_fabric>

---

<findings_criterion5>
## Criterion 5's real cost — cheaper than the roadmap estimated, and the socket is already open

### The premise is TRUE and was re-checked today

`delegate` and `CapabilitySupplier` have **zero production callers**.
`'dispatches-unauthenticated'` appears at all five production dispatch sites. `bin/bench.ts`
contains **zero** occurrences of the identifier `sovereignty`. Every shard the driver submits is
built at one site: `shards: shards.map((value) => ({ value, label: 'public' as const }))`. There
is no `task.ownerId` anywhere to root a chain at.

The driver's own comment states the current position as permanent, and criterion 5 is the ruling
that changes it:

> *"AUTH-03. The sentinel is the permanent, correct value at both of this driver's dispatch
> sites, not a placeholder. Every shard this benchmark submits is `label: 'public'`, so there is
> no owner and no root key a chain could be rooted at; giving the benchmark a sovereign leg would
> change what it measures and break comparability with the published curves."*

**The comment is not wrong about the risk — it is the reason the leg must be opt-in.** The plan
must rewrite it rather than leave it standing beside code that contradicts it.

### The supplier half is one argument

`discoverCandidates`' options type already reads:

```ts
readonly dispatch: ((nodeId: string) => CapabilitySupplier) | 'dispatches-unauthenticated'
```

and it is consumed as
`options.dispatch === 'dispatches-unauthenticated' ? options.dispatch : options.dispatch(peerId)`.
`bin/bench.ts` passes the sentinel today. **Swapping it for a per-node supplier function is one
argument swap on an existing call site** — every `RemoteExecutor` that helper builds inherits it.
`RemoteExecutor`'s third constructor argument is required
(`remote-executor-contract.test.ts` holds the compile-failure proof), so the same swap is
available at the two direct constructions.

### The identity chain, end to end — measured 2026-08-05, and it decides the flag question

Four call sites have to agree on one hex key, and each reads it from a different place:

1. **`ownRecords` in `fabric-node.ts` publishes `sovereignFor: canExecuteSovereign ? [certificate.userKey] : []`.**
   Its docblock is explicit: *"**`sovereignFor` carries `certificate.userKey`, never
   `sovereignty.ownerId`** … Only `canExecuteSovereign` is read from `sovereignty`."*
2. **`discoverCandidates` builds each descriptor as `ownerId: executor.certificate.userKey`,
   `canExecuteSovereign: executor.capabilities.sovereignFor.includes(executor.certificate.userKey)`.**
3. **`eligibleNodes` (`core/src/sovereignty.ts`) filters
   `node.ownerId === request.ownerId && node.canExecuteSovereign`** for a sovereign shard, and
   returns `[]` for a sovereign shard whose `ownerId` is `undefined`.
4. **`authorizeCapability` (`net/src/capability-authorizer.ts`) refuses in this order**: a combine
   is admitted; a non-sovereign task is never asked for a chain; **a node with no pinned
   `ownerKey` refuses every sovereign task**; a task whose `ownerId` differs from
   `options.ownerId` refuses naming both; then `verifyChain` against `ownerKey`, `ownerId`,
   `audience` and `ability: 'execute'`. `guardSovereignty` separately requires
   `task.ownerId === node.ownerId && node.canExecuteSovereign`.

**So the sovereign shard's `ownerId` must be the enrolment user key — the hex public half of
`BENCH_USER_SEED` — and each worker's `sovereignty.ownerId` must be that same hex string.** This
is the collision `bin/agent.ts`'s `--owner-id` docblock already records: *"a
`PlacementRequest.ownerId` holding an operator label therefore matched no discovery-derived
descriptor, and a sovereign shard came back `unplaceable` **with nothing anywhere obviously
wrong**."*

**Two consequences the draft did not have.**

- **No new key is required.** The chain may be rooted at `BENCH_USER_SEED` itself, so
  `ownerKey === ownerId ===` the hex public half of that one seed, and the chain is minted with
  that same private key. `bin/agent.ts` already treats owner id and user key as the same value
  when both are supplied, and `fabric-node.ts` names the repository's own fixture as dodging the
  two-answers problem *"by making the owner id be a hex key"*. A second keypair would create a
  second answer to a question that has one.
- **The derivation needs no new dependency.** `capability-fixture.ts` derives a public key as
  `delegate(priv, {…}).issuer` precisely because `@noble/curves` is not a declared dependency of
  `@o2/node`, and `requestEnrollment` derives the same value as
  `toHex(ed25519.getPublicKey(userPrivateKey))` from the same 32 bytes. **Copy the `delegate`
  trick**, then cross-check it against the fabric: after the workers start, a started worker's
  `certificate.userKey` must equal the derived key, and a mismatch must throw rather than produce
  an `unplaceable` shard. That equality is the falsifier for this whole mechanism.

### What genuinely remains

1. **A bench-local owner key**, declared beside the arm that uses it in the `BENCH_USER_SEED` /
   `BENCH_SIGNING_SEED` shape, with the existing justification: *"a fixed seed rather than a
   fresh one per run, because the enrolment it produces is setup and not measurement."* Under D13
   it is derived from `BENCH_USER_SEED` rather than being a new seed; if a plan nonetheless needs
   a fresh one, **re-grep before choosing** — the in-use list in `capability-fixture.ts`'s
   `keypair` docblock is dated 2026-07-31 and has since grown (seeds 114, 115, 116, 120, 121, 133
   and 140 are among those now taken; a `grep -rn "\.fill(" packages/` re-take is the check).
2. **`sovereignty:` on each worker's `FabricNode.start`.** There are **zero** such keys in the
   file today. The option is `sovereignty?: NodeSovereignty`, i.e.
   `{ ownerId: OwnerId; canExecuteSovereign: boolean; ownerKey?: PublicKeyHex }`. Its default is
   *"cleared for nobody, pinned to nobody"*, which refuses every sovereign task **twice over** —
   the authorizer for want of a pinned key, `guardSovereignty` for want of clearance — and *"the
   first of those is the one a requestor observes, because `authorize` runs before `execute`."*
   Must be a conditional **spread**, not a conditional field, for `exactOptionalPropertyTypes`,
   exactly as the `enrollment` and `trustedIssuers` spreads already are.
3. **One `label: 'sovereign'` shard**, carrying `ownerId`. `ShardSpec` is a discriminated union —
   `{ value, label: 'sovereign', ownerId }` — so the `ownerId` is not optional on that arm and
   `tsc` says so.
4. **Descriptors whose `ownerId` matches.** `publicNodes` hardcodes `ownerId: 'public'`, so the
   default descriptor derivation cannot place a sovereign shard. Under D13 the leg rides
   `--discover`'s descriptors, which already carry a real `ownerId` read off each certificate.
5. **Move the count pins deliberately.** `'dispatches-unauthenticated'` (3),
   `new RemoteExecutor(` (2) and `await discoverCandidates(` (1) in
   `serve-agent-hooks.node.test.ts` all acquire a condition. Update each number **and the comment
   beside it**, since that file's own thesis is that a count with a stale comment is how a guard
   becomes decoration.

### Hard constraint: **do not import `capability-fixture.ts` from `bin/`**

`packages/node/src/capability-fixture.ts`'s own header forbids exactly this, and says why:

> *"**This module is test-only.** It is imported by relative path from the node-tier specs and is
> deliberately **not** re-exported from `packages/node/src/index.ts`, so it exposes no capability
> that Phase 22's reachability guard could trace to an entry point. **A barrel-exported fixture
> would hand that guard a real finding this phase invented.** The precedent is
> `packages/core/src/executor/fixtures.ts`, which lives beside production source and is reached
> the same way."*

Importing it from a runnable entry point would manufacture the very Phase 22 reachability finding
criterion 5 exists to remove. It is reusable as a **shape**, never as a dependency.
`chainSupplierFor`'s body is three lines:

```ts
return (task: Task): readonly Delegation[] =>
  task.label === 'sovereign' && task.ownerId !== undefined
    ? directChainFor(nodeId, task.ownerId)
    : []
```

and `directChainFor` is one `delegate(ownerPriv, { ownerId, expiresAt,
audience: audienceKeyOf(nodeId), abilities: ['execute'] })`. `audienceKeyOf` comes from
`@o2/libp2p`, which `bin/bench.ts` already imports (for `peerIdForNodeKey`). Copy the shape;
state at the copy that it is a copy and why the import was refused, so the next reader does not
"de-duplicate" it back.

`packages/browser/src/capability-harness.ts` is the browser-side equivalent — also test-only, and
a **serving**-side rig rather than a dispatching one, so it is not what criterion 5 needs. It is
the structural precedent for *"an opt-in leg that configures sovereignty a production entry point
does not expose."*

### Verification shape

Copy `discover-arm.node.test.ts` exactly: spawn `bin/bench.ts <flags>` with `cwd` in a temp
directory, assert the cwd really is temporary, read one printed line off stdout, kill the driver,
compare `git status --porcelain` across the run. Print a line the spec can read — the
`--discover:` line's analogue — and throw rather than report a zero if the leg placed nothing.
**Do not fold it into a spec that waits for the run to finish**; that file's header records why
(4 s versus 3 minutes) and the split into `discover-arm` / `bench-attestation` is the precedent.
</findings_criterion5>

---

<decisions>
## Decisions carried forward, re-derived today

### D1 — The saturating fixture is `@o2/demo`'s colouring kernel, `budget = DEFAULT_BUDGET`
`packages/demo/src/kernel.wat` is 346 lines; `DEFAULT_BUDGET = 5_000_000`;
`WIRE_CHUNK_BYTES = 16_384`. The reasoning survives: the repository already ships a committed,
integer-only, budget-bounded search kernel whose per-shard cost is a *declared input*, so shard
cost is controlled rather than a property of the host. The current fixture
`MODULE_WRITES_PARTITION` cannot produce a speedup at any N because there is nothing to
parallelise.
**Changed:** the previous context's parameter table (`n = 700`, 8 partitions, 80–118 ms per
shard, 740 ms serial, 11,184 B) was measured **at 8 partitions**. `SHARDS` is 16. **Every one of
those numbers must be re-measured at 16 before it is quoted**, including the `n = 1000`
disqualification, which rested on the input crossing `WIRE_CHUNK_BYTES`. The kernel's
power-of-two requirement (`partition()` packs `(index << 16) | count`, guest derives
`k = log2(count)`) is satisfied by 16.

### D2 — `SHARDS` is 16 and stays 16 *(replaces old decision 2, which said 8)*
See `SHARDS`' docblock. Phase 13.1 raised it above the measured 12-shard cliff because NET-09's
per-peer send gate removed the cliff, and running above it on the production benchmark path is
what demonstrates that. **Do not lower it to make an old pre-registration fit.**

### D3 — The process fabric is a **fourth** rig, added beside `memoryFabric` and `realFabric`
`bench-egress.node.test.ts` requires both existing function names to survive, so `realFabric` is
added to, never replaced. The spawn helper is a fourth copy of `spawnAgent`; it is not shared
code, because the three existing copies live in `*.node.test.ts` files and `bin/bench.ts` cannot
import from one. Lifting it into `@o2/node`'s barrel would add an export whose only production
caller is the driver — a Phase 22 conversation, not this one.

### D4 — Dial direction is a controlled variable, not a free win *(re-derived)*
Adopting the spawn pattern changes the process split **and** the dial direction. Only one is what
BENCH-07 is about. The driver dials outward (matching the harnesses), **and** criterion 3's
measurement holds the driver fixed while varying the direction so the two effects separate. If
the in-process/submitter-dials-out cell already succeeds where the in-process/workers-dial-in cell
failed, the exclusion was about direction and the process split gets no share of that finding.

### D5 — `bin/agent.ts` announces `process.pid` on the handshake line it already prints
`child.pid` proves a process was spawned, not that the process which announced the address is
that process. One extra key on the existing single JSON line closes it; the parent asserts
`handshake.pid === child.pid`. Backwards-compatible by construction — every existing reader parses
the line as `{peerId, multiaddrs}` and ignores the other seven keys already present.

### D6 — Harness-integrity failures abort the run; only measurement failures become excluded rows
Two error classes. A `HarnessIntegrityError` (PID check, executor-count check, driver-CPU check,
fixture checks) propagates out of `main()` and the run produces **no report at all** — which is
criterion 1's "fails the harness rather than reporting a curve", literally. Everything else
becomes an excluded row whose `reason` is built from the observed error: its class, its message,
and the configuration in force, with any interpretation stated as interpretation. **This is the
prerequisite for criterion 3**, and the hardcoded paragraph is still in the file.

### D7 — `RunConfig` gains `driver` and `fixture`, both required
Verbatim today: `RunConfig { nodes, shards, redundancy, transport, skew }`. `transport` and `skew`
are already exactly this kind of declared dimension — rendered nowhere in the old report, carried
everywhere. Criterion 4 wants provenance on *every published figure*, and the raw observations go
to `.planning/bench/raw.json` where a markdown heading does not exist. **Required rather than
optional**, for the reason `Inventory.machines` is required: a figure that *can* be published
without its provenance eventually is.

### D8 — The multi-process curve is a new `Report` section; `connectivityTax` keeps receiving only the in-process real curve
`Report` today is `{title, at, inventory, baseline, memoryTransport, realTransport, connectivity,
crossover, unmet, excluded?}` — confirmed verbatim. Appending multi-process rungs to
`realTransport` has a **silent** failure: `connectivityTax` builds a `Map` keyed on
`config.nodes`, so two entries at the same node count collapse to whichever was appended last,
with no error. The tax is defined in the methodology as the same job over two transports with
everything else held constant, and the driver is not held constant otherwise.
**Note for the executor:** `renderMarkdown` already emits two `## Reduce tree` sections from data
that rides on `SweepResult` rather than on a `Report` field, and `bin/bench.ts` already builds a
report object carrying an `attested` key that `Report` does not declare, which rides into
`raw.json` unrendered. Whatever new section is added, decide deliberately whether it is a `Report`
field or another rider.

### D9 — The speedup ladder holds redundancy fixed at 1 — **and that is now necessary but not sufficient** *(amends old decision 9)*
The existing ladders use `redundancy: Math.min(2, nodes)`, so N=1 runs at R=1 and every other rung
at R=2; a ratio across that ladder varies two things. Holding R fixed at 1 removes that one.
**What the old decision got wrong:** it asserted *"at R=1 each shard gets one placement, and which
node it lands on is fixed by that ordering rather than by timing."* That is false after Phase 20 —
see `<findings_job_path>`. A shard at R=1 can be placed up to 3 times and duplicated once, and
**speculation is on at `SHARDS = 16` with an allowance of exactly 1**.
**So:** hold R at 1, **and** publish, per rung, `Observation.redispatches` and
`Observation.speculationMultiplier` (both already real on this path and already rendered as
`churn/task` and `spec. tax`) plus a **new** per-rung reading of `ShardResult.generations` and
`ShardResult.speculated`, which exist on the result but are not surfaced by the driver. A ratio
published without those is a finding about the harness, which criterion 2 forbids.
**Confounds to publish beside the ratio**, quoted from measurements rather than worked out here:
the host's logical core count; the **observed** node-process count at each rung, read off the
process table rather than off the rung's node count; and, at any rung where that count exceeds the
logical core count, that the rung is **oversubscribed**, so a knee there is contention rather than
coordination. The verification tax on the R=1 sweep is reported as the identity `1.00×`, exactly
as the 1-node rung already is — BENCH-04 is satisfied by the figure appearing, not by it exceeding
one.

### D10 — Each rung's fabric is disposed before the next is built
`runnerFor` caches one `Fabric` per node count and disposes them all at the end. Under a process
driver that leaves every earlier rung's agents resident while the last rung is measured — idle,
but each holding a libp2p node and a heap. That is a contention source inside the curve being
measured, which is precisely criterion 2's "finding about the harness". The process driver's
runner disposes the previous rung's fabric when `config.nodes` changes; `runnerFor` is left alone
for the memory and real legs.

### D11 — The methodology gets a dated amendment; nothing above the `## Amendments` heading is edited
**Changed:** the old context said that section reads *"None."* It does not — it already carries a
dated entry, `### 2026-07-31 — the reduce leg (Phase 16, MR-03 … MR-07)`, whose own preamble
records that it was *"Committed before the run it describes … a plan amended after seeing the
number it changed is not a plan."* **So the mechanism exists and has been exercised; follow the
existing entry's form.** Three things this phase does are changes to the pre-registered plan and
belong there, dated, with reasons: a second fixture; a third driver plus the `driver`/`fixture`
dimensions; and the fixed-R speedup sweep. The ordering is checkable in `git log` and that is the
point.

### D12 — `@o2/node` takes a workspace dependency on `@o2/demo`
`bin/bench.ts` reaches its current fixture by relative path across a package boundary
(`from '../../../core/src/executor/fixtures.ts'`). Adding `"@o2/demo": "*"` and importing by name
matches how the same file already imports `@o2/core`, `@o2/net`, `@o2/bench` and `@o2/libp2p`.
Safe against `purity.node.test.ts`: `PORTABLE = ['core','net','bench','demo','aot']`,
`DUAL_TARGET = ['libp2p','browser']`, and `packages/node` is in neither, so the new edge points
adapter → portable, the permitted direction. `@o2/demo`'s own dependencies are `@o2/core` and
`multiformats`.

### D13 — Criterion 5's leg gets its own flag, and that flag **requires** `--discover` *(new, resolves the draft's open question 1)*
The draft left this open with a real trade. Resolved on three measured grounds:

1. **Descriptors.** A sovereign shard is placed only against a descriptor whose `ownerId` matches
   it. `publicNodes` hardcodes `'public'`, so an independent leg would have to hand-build a
   second `NodeDescriptor[]` inside the driver — a **second producer of that record disagreeing
   with `discoverCandidates`' with nothing able to catch it**, which is the exact "field with two
   answers" defect `fabric-node.ts`'s `ownRecords` docblock exists to name. Riding the discover
   arm reads `ownerId` and `canExecuteSovereign` off a **signed** capability record, which is what
   makes the leg an AUTH-03 path rather than a rig.
2. **`--discover` already builds everything else the leg needs** — a provider, an enrolment, real
   certificates and a `combineIssuers` set — so the incremental cost is a `sovereignty` spread, a
   supplier function and one shard label.
3. **A separate flag keeps `--discover`'s existing report line covering one change.** Folding a
   second independent opt-in into `--discover` would make that sentence cover two.

**The dependency is declared, not silent.** `--sovereign` without `--discover` **refuses** — a
named message on stderr and a non-zero exit, in the shape `bin/agent.ts` already uses for
`--provider-addr` without `--user-key`. It must not quietly imply `--discover`, because a run
whose topology changed for a reason the operator did not type is the thing this driver's whole
opt-in discipline exists to prevent.

**What the leg must not do:** appear in a default run, in a `--quick` run, or in a `--discover`
run without `--sovereign`. `coverage-agents.node.test.ts` already proves the first two for free —
it spawns `--quick` and asserts no coverage line is printed.

## Decisions that died, and what replaced them

**Retained for the reasoning, not the verdict.**

| dead | replaced by, and when |
|---|---|
| **Old decision 2 — "`SHARDS` stays 8"** | **D2**, 2026-08-05. `SHARDS = 16`; the cliff it hedged against was removed by NET-09's per-peer send gate, and the constant's docblock says so |
| **Old decision 9's "at R=1 each shard gets one placement"** | **D9's amendment**, 2026-08-05. `placeAgain` inside an unguarded generation loop, `DEFAULT_MAX_GENERATIONS = 3`, plus a speculation allowance of 1 at 16 shards |
| **Old Risk 2 — Phase 13.1 as an undeclared dependency** | **Nothing. It shipped**, and the roadmap's cliff sentence is historical |
| **Old context's four-criteria transcription** | **Five criteria, verbatim, above**, 2026-08-05. Plus a sixth plan for criterion 5, front-matter `[BENCH-07, AUTH-03]` |
| **Old decision 3's `stdio: ['ignore','pipe','pipe']`** | `['pipe','pipe','pipe']`, 2026-08-05. `'ignore'` puts `/dev/null` on fd 0 and opts the caller out of the orphan leash |
| **Old context's "`Fabric` is 5 fields"** | **Ten members**, 2026-08-05. See `<findings_fabric>` |
| **Old context's `bench-egress.node.test.ts` "four call-site shapes, 196 lines"** | **Seven named requirements, ~273 lines**, 2026-08-05 |
| **Old context's "`bin/agent.ts`'s flags are `--dir`, `--port` (default `0`), `--owner-id`, `--can-execute-sovereign`"** | **Sixteen flags; `--port` has no default**, 2026-08-05. See `<findings_spawn>` |
| **The audit's F1 — "the plans' spawn shape produces an agent that binds nothing"** | **Retracted 2026-08-05.** A bare `--dir` spawn binds `/ip4/127.0.0.1/tcp/0`. The surviving rule is narrower: state `--port 0` whenever `--relay-addr` is stated |
| **Old 23-05's `.planning/BENCHMARK-RESULTS-2026-07-27.md`** | **That file does not exist**, and no artifact in the tree supports that run date. The frozen artifact is `.planning/BENCHMARK-RESULTS-2026-08-01.md`, named for the run's own stamp — see below |
| **Old 23-03's `QUICK_OUT_ROOT = join(tmpdir(), 'o2-bench-quick')`** | **Refuted 2026-08-05 by `coverage-agents.node.test.ts`**, which asserts `stat(join(cwd, '.planning', 'bench')).isDirectory()` after a `--quick` run. `main()` keeps writing under `process.cwd()`; every spec that runs the driver spawns it with a temporary `cwd`, which is the property that plan wanted |
| **Old 23-04's "seven attempts at 8 **and** 16 nodes"** | **Reshaped 2026-08-05.** The committed run excludes exactly one row — see below |
| **The draft's "criterion 5 needs a bench-local owner keypair"** | **D13 and `<findings_criterion5>`**, 2026-08-05. The chain roots at `BENCH_USER_SEED`, because the descriptor's `ownerId` *is* `certificate.userKey` and a second key would be a second answer |

## Settled facts, measured today

- **`os.cpus().length` is `8`** on this host — Apple M1 Pro, `darwin 25.5.0`, 32.0 GiB. The M1 Pro
  is a heterogeneous design whose efficiency cores are slower, so per-process throughput is **not**
  uniform, and that non-uniformity is a property of the host that belongs beside any speedup
  figure.
- **`NODE_LADDER = [1, 2, 4, 8, 16]`** (`packages/bench/src/harness.ts`), and a test asserts it
  matches the committed plan.
- **`RUNS = QUICK ? 6 : 20`**; `RUNS_PER_CONFIG = 20` exists in `@o2/bench` and `bin/bench.ts`
  hardcodes `20` rather than importing it.
- **`RunConfig { nodes, shards, redundancy, transport, skew }`** and **`Report { …, excluded? }`**
  — both verbatim as the old context had them.
- **`sweepNodeCount` still has no production caller.** Defined in `harness.ts`, barrel-exported,
  called only by `harness.test.ts`; `bin/bench.ts` writes its own `for` loops. Built-not-wired, in
  the exact class Phase 22's guard exists to catch.
- **`DEFAULT_BUDGET = 5_000_000`**, **`WIRE_CHUNK_BYTES = 16_384`**,
  **`RELAY_MAX_RESERVATIONS = 15`**, **`LIBP2P_INBOUND_CONNECTION_THRESHOLD = 5`**, and
  `kernel.wat` at 346 lines.
- **`.planning/BENCHMARK-RESULTS-2026-07-27.md` does not exist.** `.planning/` holds
  `BENCHMARK-METHODOLOGY.md`, `BENCHMARK-RESULTS.md` and `bench/raw.json`. The committed report is
  **105 lines** and its run is stamped `2026-08-01T06:09:01.272Z`. **The frozen artifact must be
  named for the run's own timestamp, not for the date somebody froze it** — the old plan's
  filename asserted a run date no artifact supports.

## What the currently published run actually says — and it reshapes criterion 3

`.planning/BENCHMARK-RESULTS.md`, run `2026-08-01T06:09:01.272Z`, in-process, `SHARDS = 16`:

- Memory transport: rungs **1, 2, 4, 8, 16**, all `n = 19`, `incomplete = 0`; p50 22.4 / 44.6 /
  44.5 / 45.8 / 44.9 ms.
- Real transport: rungs **1, 2, 4, 8**, all `n = 19`, `incomplete = 0`; p50 38.2 / 68.8 / 67.2 /
  69.5 ms.
- **Configurations excluded: exactly one row — `real transport, 16 nodes`**, with the hardcoded
  paragraph, off a `connect ECONNRESET`.
- `spec. tax 1.00×` and `churn/task 0.00` on **every** rung of both curves.
- Connectivity tax 1.70× / 1.54× / 1.51× / 1.52× at 1/2/4/8 nodes.
- COST: no crossover; best distributed p50 22.4 ms at 1 node against a 0.0032 ms baseline —
  **7086.14×**.
- **Ten `## ` sections**, two of which (`## Reduce tree — memory transport` and
  `## Reduce tree — real transport`) postdate the previous plan set entirely. Eight of the ten
  carry a figure and are not exempt from a provenance rule; the previous 23-05 counted six,
  against a 79-line file that no longer exists.

**Criterion 3 names "the two real-transport rungs Phase 8 published as excluded (8 and 16
nodes)". As of the committed run, the 8-node rung already runs in-process.** So the criterion,
read against today's tree, is about **one** rung, and its "either run, or are re-excluded with a
measurement" is already half satisfied by a change nobody attributed to this phase. **This must be
stated in the report rather than quietly absorbed**, and it changes the shape of the factorial:
the 8-node cell becomes a control that is *known* to pass rather than an unknown, and the
interesting cell is 16.

**Do not conclude from this that the cap is no longer the cause at 16.** The old context measured
a default `FabricNode` announcing `inboundConnectionThreshold: 15` — derived from
`RELAY_MAX_RESERVATIONS`, not the `LIBP2P_INBOUND_CONNECTION_THRESHOLD = 5` the exclusion
paragraph names — and that coupling landed **after** the harness commit that produced the original
exclusion. That reading is **unverified in this pass** (it needs a live node) and is recorded as a
hypothesis the criterion-3 factorial tests, not as an established fact. What *is* established is
that the published paragraph names a constant the code does not necessarily run at, and that the
paragraph is attached without inspecting the error.
</decisions>

---

<open_questions>
## Genuinely open — resolved by measurement or by a ruling, not by a plausible answer

1. ~~**Does the criterion-5 leg get its own flag or ride `--discover`?**~~ **Resolved 2026-08-05
   as D13**: its own flag, which requires `--discover` and refuses without it.
2. **Does the 16-node real-transport rung still fail, and on what?** The published exclusion names
   `INBOUND_CONNECTION_THRESHOLD = 5`; a default node's derived threshold measured 15 on
   2026-07-28, and the coupling that produced 15 postdates the excluding run. **"The cap is still
   the cause" is one possible answer, not the expected one.** Only the factorial says. Three
   independent levers exist — raise the option, stagger the dials, change which side receives them
   — and only a measurement can say which the rung was dying on.
3. **What the saturating fixture costs end to end, at 16 partitions.** Any per-shard figure taken
   by driving `WasmExecutor` directly omits block fetch, canonical encode/decode and RPC framing.
   **What those add is unmeasured.** The first process-driver run must re-measure per-shard cost
   end to end before any ratio is published. If a shard's observed status vector is anything other
   than 16 `budget` results, the fixture parameters are wrong for this host.
4. **Whether `generations` or `speculated` move at all under the new driver.** The published
   trivial-fixture run reports zeros. A saturating fixture on an oversubscribed host is exactly
   the regime where a straggler appears and the 1-duplicate allowance gets spent. **Unmeasured.**
5. **What the driver-CPU share comes to under either arrangement.** Criterion 1's third check —
   `process.cpuUsage()` in the driver over the shard compute time it dispatched — is the falsifier
   that does not depend on the harness telling the truth about itself. **Do not write down what
   the ratio "should" be.** Declare `MAX_DRIVER_CPU_SHARE` in the methodology amendment *before*
   any data exists, then measure.
6. **How `--quick` and the full path diverge.** `QUICK` shortens both the runs and both ladders;
   the quick ladder stops at 4 and criterion 2's ratio is defined at N=1 and N=8. **So the
   headline number cannot be produced by a quick run.** Since the separate-quick-output-root
   remedy is refuted by `coverage-agents.node.test.ts`, the property is held instead on the
   *published artifact*: it must contain a 16-node rung, which a quick ladder cannot produce.
7. **Whether the `{inboundConnectionThreshold: 15}` reading still holds.** The derivation is
   present in `fabric-node.ts` and is internally consistent, but reading the getters requires a
   live node. **Unverified in this read-only pass.**
8. **Whether a `Report` field or a rider carries the multi-process curve**, given that `attested`
   already rides into `raw.json` without being declared on `Report`, and that the two reduce
   sections are rendered from data on `SweepResult` rather than from a `Report` field. See D8.
</open_questions>

---

<constraints>
## Hard constraints on how `bin/bench.ts` may be edited

- **`async function memoryFabric` and `async function realFabric` must both survive by name**, and
  the source must stay above 5,000 characters — `bench-egress.node.test.ts`.
- **All seven `bench-egress` call-site requirements must remain satisfiable after comments are
  stripped.** The guard strips comments precisely because the file names all of them in prose.
- **`serve-agent-hooks.node.test.ts`'s sixteen pinned counts** over this file. Any that move must
  move together with their comment and a stated reason.
- **`coverage-agents.node.test.ts`'s five readings** — the exact stdout heading list, the coverage
  silence, `coverageReading(` at 2, the `'defines-no-owners'` literal, and `.planning/bench` under
  the spawn's own `cwd`. See `<findings_guards>`.
- **`vocabulary.node.test.ts`** scans this phase directory and the generated report prose. Read its
  `BANNED` array before writing any new string, and do not restate the prohibited words.
- **`discover-arm.node.test.ts` and `bench-attestation.node.test.ts` compare
  `git status --porcelain` across their own runs.** With concurrent agents in one tree, `git add`
  mid-run reddens them for reasons unrelated to any code.
- **`main()` writes under `process.cwd()`.** Any spec that executes this driver must spawn it with
  a temporary `cwd` and assert that it is temporary, or a test run overwrites the repository's
  committed measurements as a side effect.
- **`await main()` runs on import**, which is why every guard on this file is either a
  pure-function unit test, a source-text read, or a spawn with a temp cwd.
- **Nothing runs the full `bin/bench.ts` in CI, and this phase does not change that.** Criterion
  1's checks therefore protect a run nobody re-runs automatically — they fire when a human runs the
  benchmark, not when a change breaks it. Worth stating in the phase's own notes rather than
  discovering later.
- **Do not import `packages/node/src/capability-fixture.ts` from `bin/`.** See
  `<findings_criterion5>`.
</constraints>

---

<deferred>
## Deferred

- **The user-count axis.** The methodology's §1.1 declares two axes swept separately and says the
  super-linear claim can only live on the user-count one. This phase sweeps node count only. The
  process driver makes the second axis buildable for the first time — N driver processes each
  submitting a job — but it is a different measurement with a different falsification condition.
  Name it as the next benchmark phase.
- **Wiring `sweepNodeCount`.** It would replace the two hand-written `for` loops, but they carry
  per-rung `try`/`catch` and per-rung disposal that the current signature has no room for. Leave it
  unwired and let Phase 22's guard decide whether it is an export worth keeping.
- **Lifting `spawnAgent` into `@o2/node`'s barrel.** Roughly twenty copies exist. A shared export
  needs a production caller to be reachable, and the driver would be the only one. Phase 22.
- **A non-zero exit code when a rig completes no job.** `BENCH_SIGNING_SEED`'s docblock argues for
  it and then declines it in the same breath: *"several later phases modify this driver and some
  rewrite it, and an exit-code rule would change the meaning of every `node bin/bench.ts --quick`
  verification gate in the repository."* **Phase 23 is arguably that owner.** Surface the choice; do
  not take it silently. Note that `coverage-agents.node.test.ts` now asserts `code === 0` on a
  `--quick` run, so a new exit-code rule has a caller to answer to.
- **A real checkpoint sink on the bench path.** `runnerFor`'s call site says a real sink *"is the
  cheapest place to close criterion 7's write half … but wiring one is a separate ruling and is not
  done here."*
- **Fixing `placeAgain`'s docblock**, which cites the deleted `coordinator.ts`. A production defect
  outside this phase, recorded so the next reader does not chase it.
- **The stagger lever on criterion 3.** Named as a lever the factorial does not exercise, recorded
  as such in every attempt rather than left unmentioned.
</deferred>
