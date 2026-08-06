---
phase: phase-23-multi-process-benchmark-driver
plan: 02
subsystem: benchmark-driver, agent-handshake, process-fabric
tags: [BENCH-07, criterion-1, process-boundary, pid-correspondence, orphan-leash, ten-member-seam]
requires:
  - "packages/node/src/bin/agent.ts — the one-line stdout handshake, the sixteen-flag parseArgs block and the three-row listen table (MODIFIED here, by one key)"
  - "packages/node/src/two-process.node.test.ts — spawnAgent, stopAgent and the submitter-dials-outward job path (copied, never imported, UNCHANGED)"
  - "packages/node/src/orphan-leash.ts + orphan-leash.node.test.ts — why stdio[0] is 'pipe' (UNCHANGED)"
  - "packages/node/src/bin/bench.ts — the ten-member Fabric interface, realFabric's guard/rpc idiom and dialableAddr (READ ONLY; NOT edited by this plan)"
  - "packages/node/src/fabric-node.ts — FabricNode.start, .store, .egress, .rpc, .dial, .peerId, .stop (UNCHANGED)"
  - "packages/net/src/remote-executor.ts — the three-argument constructor whose third argument is required (UNCHANGED)"
provides:
  - "criterion 1's mechanism — an agent process states its own pid on the line it already prints, and the parent can check the correspondence"
  - "packages/node/src/bench-fabric.ts — the ten-member Fabric seam, AgentHandle, ProcessFabric, spawnAgent, stopAgent, processFabric"
  - "a real 4-shard job at redundancy 1 completing across two spawned bin/agent.ts processes, with the module held only by the submitting process beforehand"
  - "a Fabric.blockstore widened to Blockstore, which deletes realFabric's `as unknown as MemoryBlockstore` cast at the point 23-03 imports this type"
affects:
  - "23-03 — can import Fabric/processFabric and hand a ProcessFabric to runnerFor without a cast and without a missing field; bin/bench.ts is untouched here so all four source-shape guards over it are undisturbed"
  - "23-01 — consumes ProcessFabric.agents (pid, announcedPid, peerId) as the input to processIdentityViolations"
  - "23-04 — inherits processFabric's signature and will grow inboundThreshold / submitterInboundThreshold / dial; the submitter construction and the agent spawn are deliberately two steps so the inverse dial order stays possible"
  - "whoever retakes MEASURED_NODE_SPANS — two new node files, both BELOW the 1000 ms cut, so neither is an exclusion; node project 150 -> 153, drift 3 against tolerance 5"
tech-stack:
  added: []
  patterns:
    - "two readings of one number kept apart on purpose — child.pid from spawn, announcedPid off the handshake — so a fallback cannot satisfy both"
    - "a plant that leaves the file GREEN reported as a finding rather than skipped, with the file that does carry the claim named"
    - "an isolated tsc taken in a detached worktree at a pre-widening commit, with node_modules/@o2 relinked INTO the worktree, and the reading itself probed with a planted type error"
    - "disposal read off the process table with kill(pid, 0) rather than off exitCode"
    - "a rule written into a doc for a caller who does not exist yet — state --port 0 whenever --relay-addr is stated"
decisions:
  - "the pid key is additive, not a protocol change: proved by renaming an existing key and watching all three pre-existing readers redden"
  - "processFabric carries submitterPeerId, because the plan's own stated proof needs it and nothing else on the rig supplies it"
  - "processFabric throws when the put CID disagrees with moduleRecord.cid, converting a whole-rig silent zero into one named throw"
  - "feat-then-test commit order, both green, rather than a deliberately red commit on a branch a second agent is committing to"
  - "STATE.md, ROADMAP.md and REQUIREMENTS.md deliberately NOT touched — BENCH-07 is not closed by this plan and 23-01 took the same position"
metrics:
  duration: ~55m
  completed: 2026-08-05
---

# Phase 23 Plan 02: The agent announces its pid, and the fabric that spawns N of them Summary

A 4-shard job at redundancy 1 now completes across **two spawned `bin/agent.ts` processes**,
with the module held only by the submitting process beforehand, through a rig that satisfies
all ten members of the seam `bin/bench.ts` declares. And the harness can check that the
processes are real:

```
handshake.pid === child.pid          # the announcing process is the spawned process
announcedPid === pid, pid !== process.pid, and the two pids are distinct
executors[].nodeId === agents[].peerId, and submitterPeerId is in neither
```

Every figure here is a count, an identity comparison, or an exit code. Nothing in this plan
is a duration and nothing is a threshold.

---

## What landed

### `packages/node/src/bin/agent.ts` — one key, and the argument for why one key is enough

`pid: process.pid` on the object literal the `process.stdout.write` at the end of the file
already builds. The module comment gains the reason and the sample line gains the key.

**The reason, in the source's own words:** a parent that spawned a child and read an address
has proved neither that the address belongs to that child nor that the child is the process
now holding it. `child.pid` names a process the parent started; the handshake names an
address somebody is serving; nothing joined them. Criterion 1's first check is exactly that
correspondence, and a benchmark that had quietly fallen back to in-process nodes would
satisfy both halves separately.

Nothing else in the file moved. Not the sixteen-flag `parseArgs` block, not the `listen`
expression, not `USAGE`. The handshake went from **nine keys to ten**.

### `packages/node/src/bench-fabric.ts` — new, 443 lines against a `min_lines` of 140

- **`interface Fabric`** — all ten members, doc comments carried across, with two deliberate
  widenings: `blockstore` is `Blockstore` rather than `MemoryBlockstore`, and `moduleCid`
  follows it as `Awaited<ReturnType<Blockstore['put']>>`. The second keeps the existing idiom
  that avoids naming `CID`, so `@o2/node` still needs no direct `multiformats` dependency.
  The first is what deletes `realFabric`'s `as unknown as MemoryBlockstore` cast at the point
  23-03 imports this type.
- **`AgentHandle`** — `pid`, `announcedPid`, `peerId`, `multiaddrs`, `dir`. The first two are
  two readings of what ought to be one number, and keeping them apart is the mechanism.
- **`ProcessFabric extends Fabric`** — `agents`, plus `submitterPeerId` (see Deviations).
- **`spawnAgent(agentPath, dir, extraArgs)`** — the fourth copy of a shape written in roughly
  twenty specs, lifted with no behavioural change: `stdio: ['pipe','pipe','pipe']`, a 30 s
  timer, accumulate stdout to the first newline, `JSON.parse`, reject on an early `exit`
  carrying the accumulated stderr.
- **`stopAgent(child)`** — SIGTERM, wait for `exit`, SIGKILL at 10 s.
- **`processFabric(nodes, moduleBytes, moduleRecord, options?)`** — spawns `nodes` agents in
  parallel, each with its own directory and each passed `--trust-anchor` for every declared
  anchor; starts one `FabricNode` here as the submitting node; `put`s the module bytes into
  its store; **dials outward** to each agent; returns all ten members plus `agents`,
  `submitterPeerId` and `close`.

**Two rules are written into the doc because getting either wrong fails silently.**
`stdio[0]` is `'pipe'` and never `'ignore'` — fd 0 is the orphan leash and `/dev/null` there
opts the caller out of it, which `orphan-leash.node.test.ts` demonstrates and guards. And:
**state `--port 0` the moment a caller also states `--relay-addr`** — with `--relay-addr`
given and `--port` absent the listen list is empty, the agent binds nothing, the submitter
has nothing to dial, and no error is raised anywhere. This fabric passes no `--relay-addr`
today; the rule is written down because a later caller of `agentArgs` will need it.

**The dial-direction comment says what it is and refuses to say what it costs.** Adopting the
spawn pattern changes the process split **and** the dial direction, and only the first is
what BENCH-07 is about. The comment records that the direction decides which side receives
the inbound connections and that this is a controlled variable — and states no figure for how
many inbound connections either side ends up with, or whether the per-host cap binds. Those
are 23-04's to measure.

**`admit` is an absent key**, with a comment on its absence saying why: `submitJob` branches
on `spec.admit === undefined`, and under `exactOptionalPropertyTypes` an explicit `undefined`
and an absent key are different types reaching the same branch by accident rather than by
statement. Asserted directly — `expect(Object.hasOwn(built, 'admit')).toBe(false)`.

### `packages/node/src/agent-handshake.node.test.ts` — new, 162 lines

One spawned agent, three readings in one `it`: the pid equality, the two keys every existing
parent takes, and that the process is genuinely gone after SIGTERM.

### `packages/node/src/bench-fabric.node.test.ts` — new, 191 lines against a `min_lines` of 80

One job-running test carrying all six declared behaviours, plus the disposal reading.

---

## Every mutation planted, and the exact text observed

Each applied, run and restored **inside one shell invocation**, so an interruption could not
leave one live. `cmp` exit `0` recorded every time. Never `git stash`, never
`git checkout --`.

### The two RED readings, watched before any implementation existed

**Task 1, before `agent.ts` was touched** — exit **1**:

```
AssertionError: expected undefined to be 60311 // Object.is equality
 ❯ packages/node/src/agent-handshake.node.test.ts:149:27
    149|     expect(handshake.pid).toBe(child.pid)
```

**Task 2, before `bench-fabric.ts` existed** — exit **1**:

```
Error: Cannot find module './bench-fabric.ts' imported from …/bench-fabric.node.test.ts
```

### Plant 1 — the pid key deleted from `agent.ts`

**Subject RED, exit 1. Neighbours GREEN, exit 0** — `Test Files 3 passed (3)`,
`Tests 7 passed (7)` for `two-process`, `sovereignty-placement`, `egress-refusal`. Observed:

```
AssertionError: expected undefined to be 62743 // Object.is equality
```

The split is the point: it reddens the one file and nothing else, which makes it a reading of
that one key rather than of the handshake in general.

### Plant 2 — a constant pid announced instead (`pid: 0`)

**RED, exit 1.** Observed:

```
AssertionError: expected +0 to be 63562 // Object.is equality
```

`toBeDefined()` and `toBeGreaterThan(0)` both pass against that. The equality is the whole
claim, and this is the plant that proves it.

### Plant 3 — an existing key renamed (`peerId` -> `peerIdentity`)

**All three pre-existing readers RED, exit 1** — `Test Files 3 failed (3)`,
`Tests 7 failed (7)`; `agent-handshake` red too. Observed, two of the seven:

```
AssertionError: expected [ undefined ] to not include undefined
 ❯ packages/node/src/egress-refusal.node.test.ts:328:78
AssertionError: expected 'insufficient' to be 'agreed' // Object.is equality
```

This is the converse of Plant 1 and it is what makes "additive" a measurement: adding a key
moves nothing, renaming one takes the whole population down.

### Plant 4 — `announcedPid` built from `child.pid` instead of from the handshake

**GREEN, exit 0.** `Test Files 1 passed (1)`, `Tests 1 passed (1)`.

**Reported rather than skipped, because a green under a planted defect is a finding.**
`announcedPid === pid` becomes true by construction and `bench-fabric.node.test.ts` cannot
tell. What carries the claim is `agent-handshake.node.test.ts`, which compares the pid a
**spawned binary printed** against the pid `spawn` returned — Plants 1 and 2 above. That
division is written into `bench-fabric.node.test.ts`'s own module comment so the next reader
does not take the equality there for more than it is.

### Plant 5 — one executor built over the submitter's own peer id

**RED, exit 1.** Observed:

```
AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]
    "12D3KooWCJrxedHTCt5RNFSDkvMURi6BqMQmX7S2eTTigp32rM4m",
-   "12D3KooWR3iRJPR2zHpTW4ezPgsTkzxmk5VQZhWraAsJXSsr6JzB",
+   "12D3KooWHtUoAmbKBT3Dd86KvFbLzaP71Kvb2UagUCmysudYgn7G",
 ❯ packages/node/src/bench-fabric.node.test.ts:121:57
```

### Plant 6 — `nodes: []` returned instead of `publicNodes(executors)`

**RED, exit 1.** Observed:

```
AssertionError: expected [] to deeply equal [ …(2) ]
```

### Plant 6b — the same, with the descriptor assertion relaxed so the job is reachable

**RED, exit 1.** Observed:

```
AssertionError: expected false to be true // Object.is equality
 ❯ packages/node/src/bench-fabric.node.test.ts:159:23
    159|     expect(result.ok).toBe(true)
```

Taken because the plan claims *both* assertions redden and, in one `it`, only the first is
reachable. Now both are measured independently. **The error name was not read**, so
`missing-node-descriptor` remains the plan's word and not a measurement of mine.

### Plant 7 — `--trust-anchor` dropped from the spawn argv

**RED, exit 1.** Observed:

```
AssertionError: expected false to be true // Object.is equality
 ❯ packages/node/src/bench-fabric.node.test.ts:161:33
    161|     expect(result.job.complete).toBe(true)
```

`result.ok` stayed **true** and `complete` went false — every shard refused. That is the
reading proving the anchors reach the children over argv and nowhere else.

### Plant 8 — a freshly constructed `EgressGuard` in place of `submitter.egress`

**RED, exit 1.** Observed:

```
AssertionError: expected 0 to be greater than 0
 ❯ packages/node/src/bench-fabric.node.test.ts:177:49
    177|     expect(result.manifests[0]!.entries.length).toBeGreaterThan(0)
```

### Plant 9 — the `stopAgent` loop removed from `close()`

**RED, exit 1.** Observed:

```
AssertionError: expected [ 77715, 77714 ] to deeply equal []
 ❯ packages/node/src/bench-fabric.node.test.ts:188:48
```

Two live pids, named. Both left with the vitest worker afterwards —
`pgrep -f "agent\.ts --dir"` exit **1** (no match) once the run ended.

### Plant 10 — the isolated `tsc` reading, probed

Not a plant on shipped code: a deliberate type error appended to the worktree copy of
`bench-fabric.ts`, to prove the isolated check actually reads the file rather than passing
because it never saw it.

**RED, exit 1.** Observed:

```
packages/node/src/bench-fabric.ts(445,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

Removed; re-check exit **0**, zero lines of output.

---

## Claims in the plan measured, and how each came out

1. **"A bare `--dir` spawn still binds `/ip4/127.0.0.1/tcp/0`" — the plan's amendment 3, and
   it is now MEASURED rather than inherited.** `agent-handshake.node.test.ts` spawns with
   `--dir` alone and asserts `multiaddrs.some(ma => ma.includes('/tcp/'))`. It passes. The
   retracted audit finding F1 would have made that assertion fail.
2. **"The `Fabric` seam is ten members" — TRUE**, counted verbatim off `bin/bench.ts`'s
   `interface Fabric`: `executors`, `nodes`, `blockstore`, `moduleCid`, `moduleRecord`,
   `guard`, `rpc`, `admit?`, `combineIssuers`, `close`. The five-member version the plan's own
   earlier draft carried would not have compiled.
3. **"The handshake carries nine keys" — TRUE**, counted: `peerId`, `multiaddrs`,
   `trustAnchors`, `nodeKey`, `certificate`, `issuerKey`, `peers`, `dutyCycle`, `relays`. Ten
   now.
4. **"`stdio[0]` must be `'pipe'`" — TRUE and load-bearing.** Not planted directly here
   because `orphan-leash.node.test.ts` already owns both halves and passes; its source-text
   guard over every spawn site is green, and this module is not a `*.test.ts` so that
   particular scan does not reach it. Recorded rather than claimed as covered.
5. **"`purity.node.test.ts` does not scan `@o2/node`" — TRUE**, read off `PORTABLE`
   (`core`, `net`, `bench`, `demo`, `aot`) and `DUAL_TARGET` (`libp2p`, `browser`), and run
   green with the new `node:child_process` import in place.
6. **The `nodes: []` plant's predicted double failure — HALF TRUE.** Both assertions do fail
   independently, but not in one run: they share an `it`, so the descriptor equality
   short-circuits and the job assertion is never reached. Measured both ways (Plants 6, 6b)
   rather than asserted.
7. **`min_lines` — exceeded.** `bench-fabric.ts` 443 against 140; `bench-fabric.node.test.ts`
   191 against 80.

---

## Assertions that could not fail, and what was done about each

- **`announcedPid === pid` in `bench-fabric.node.test.ts` is tautology-shaped**, and Plant 4
  proved it. It is kept — it is the right assertion for *propagation* — and the file's module
  comment now names `agent-handshake.node.test.ts` as what carries the underlying claim, so
  the next reader does not mistake one for the other.
- **The disposal reading was moved off `exitCode`.** The plan specifies
  `exitCode !== null || signalCode !== null`, which is a statement made by a process that
  exited. `AgentHandle` carries `pid`, so the file reads the **process table** with
  `kill(pid, 0)` instead — `orphan-leash.node.test.ts`'s stated rule about the same binary.
  Plant 9 confirms it still reddens, and it reddens with the surviving pids printed.
- **The "job crossed the boundary" case is paired.** `every shard agreed` alone would be
  satisfied by a rig that executed locally, so every agreeing replica's `nodeId` is
  additionally required to be one of the spawned agents' peer ids, and the module is `put`
  only into the submitting process's store.
- **`Object.hasOwn(built, 'admit') === false`** is asserted rather than
  `expect(built.admit).toBeUndefined()`, which an explicit `admit: undefined` would satisfy —
  and that is precisely the value that must not be there.

---

## What this plan cannot redden on, said plainly

- **That the multi-process curve differs from the in-process one.** Nothing here runs a
  sweep. This is criterion 1's *mechanism* only; criterion 2 is 23-03's and later.
- **The per-host inbound cap.** No figure for it is stated anywhere in this plan's source, on
  purpose. 23-04 measures it.
- **`bin/bench.ts`.** Deliberately untouched, so none of its four source-shape guards could be
  disturbed by wave-1 work. `bench-egress`, `serve-agent-hooks` and `coverage-agents` were run
  to confirm it, and `bench-attestation` and `discover-arm` passed in the full-project run.
- **The sovereign leg.** `processFabric` names the unauthenticated sentinel and
  `'checks-no-combine-signatures'`. 23-06 owns criterion 5.
- **N above 2.** The rig takes `nodes` as a parameter and the test drives it at 2. Whether a
  16-agent rung stands up on this host is **unmeasured here**.

---

## Deviations from plan

### `[Rule 3 - Blocking]` `ProcessFabric` carries `submitterPeerId`

The plan's own stated proof is
`expect(fabric.executors.map(e => e.nodeId)).not.toContain(submitterPeerId)`, and the
interface it specifies supplies no such value — `AgentHandle` describes children only. One
`readonly submitterPeerId: string` was added, documented as a position rather than a class.

### `[Rule 2 - Missing correctness check]` a CID-disagreement throw inside `processFabric`

The rig takes the module bytes **and** the record from a caller, so the two can disagree.
They disagree silently: every shard is refused as a `cid-mismatch` and the rig reports an
incomplete run with no clue as to why. `processFabric` now throws by name when the store's
`put` CID differs from `moduleRecord.cid` — `sameFixtureCid`'s idiom, restated where this rig
needs it. Not in the plan.

### `[Rule 3 - Blocking]` an `undo` path on partial construction

If a spawn or the submitter's `FabricNode.start` throws part-way, the caller never receives a
fabric and therefore never gets to call `close()` — which would strand agent processes out of
every failed rig. Construction is wrapped so that already-spawned children are stopped, the
submitter is stopped and the root directory is removed before the error propagates.

### `[Deviation - deliberate]` feat-then-test commit order, both green

The GSD TDD protocol asks for a red `test(...)` commit before the implementation. That was
declined: a second agent is committing to this branch concurrently, and a knowingly-red commit
on a shared branch is the hazard `CLAUDE.md` opens with. Both RED readings were **watched and
their text is transcribed above**, which is what the plan's `<done>` clause actually asks for
("proved by a test that was watched failing first and whose failure text is in the summary").
The repository carries both orders — `af305c7 feat(20-10)` before `e76f969 test(20-10)`,
`ad0f406 test(23-01)` before `4d6c64a feat(23-01)`.

### `[Deviation - deliberate]` STATE.md, ROADMAP.md and REQUIREMENTS.md not touched

BENCH-07 is **not** closed by this plan — 23-03 through 23-06 remain, and ticking it here
would be widening what counts as passing. 23-01's executor took the same position in the same
phase (`7905126` touches only its summary and the shared deferred list). Two concurrent agents
editing `.planning/STATE.md` is also exactly the shared-index hazard the conventions warn
about.

---

## Runs, read directly

Every exit code below was read with `EXIT=$?` on the line immediately after the command, with
no pipe and no trailing filter.

### Type checking

| reading | exit | note |
|---|---|---|
| `npx tsc --noEmit` after Task 1 | **0** | whole repository, clean, before 23-01's `RunConfig` widening landed |
| `npx tsc --noEmit` at HEAD, final | **1** | **4 errors, zero of them naming any of my four files** |
| **isolated**: detached worktree at `3acc37d` + this plan's two new files | **0** | zero lines of output |
| the same, with a type error planted in `bench-fabric.ts` | **1** | `bench-fabric.ts(445,7): error TS2322` — the check can fail |
| the same, restored | **0** | zero lines |

**The whole-tree red is 23-01's and it is attributed by measurement, not by plausibility.**
`4d6c64a feat(23-01): a run says which rig produced it, or it does not compile` made
`RunConfig.driver`, `.fixture` and `.leg` required; four literals in `packages/bench/src/perf-workload.ts`
and `packages/node/src/bin/bench.ts` were not updated, and neither file is in 23-01's declared
list. That agent has recorded the same four errors in this phase's `deferred-items.md`.

The isolation was taken in a **detached worktree** (`git worktree add --detach`), never by
stashing or reverting anything in the shared tree, and `node_modules/@o2/*` was **relinked
into the worktree** — the first attempt symlinked `node_modules` wholesale and resolved
`@o2/bench` back to the main checkout, which is the resolver trap and which produced three
misleading errors before it was corrected.

### Test runs

| run | exit | result | `/usr/bin/time -p` | `(user+sys)/real` | 1-min load |
|---|---|---|---|---|---|
| Task 1 verify — `agent-handshake`, `two-process`, `sovereignty-placement`, `egress-refusal` | **0** | 4 files, 8 tests | `real 15.17 user 28.78 sys 3.35` | 2.12 | 5.02 |
| Task 2 verify + guards — `bench-fabric`, `agent-handshake`, `purity`, `bench-egress`, `serve-agent-hooks`, `orphan-leash`, `slow-specs`, `vocabulary` | **0** | 8 files, 84 tests | `real 14.02 user 6.12 sys 1.34` | 0.53 | 5.08 |
| `coverage-agents` (spawns `bin/bench.ts --quick`) | **0** | 1 file, 2 tests | `real 8.56 user 9.06 sys 1.68` | 1.25 | — |
| **whole `--project node`** | **1** | 3 failed \| 151 passed (154 files); 3 failed \| 2200 passed \| 2 skipped | `real 276.12 user 328.01 sys 49.60` | 1.37 | 4.00 at start, 10.42 at end |

The sub-one ratio on the second row is not starvation: that set includes `orphan-leash`, which
spends most of its span *watching* processes on 10 s and 3 s budgets. The 0.048 ratio on
`bench-attestation` below is the same shape, further out.

**All three whole-run failures are foreign, and each was attributed by re-running it rather
than by reading it.**

| file | failure | attribution | re-run |
|---|---|---|---|
| `speculation-agents.node.test.ts` | `expected 1062.4916… to be greater than 1136.6760…` | a straggler-threshold **comparison of two durations**, taken while eight vitest workers and a second agent's suite were on the host; load reached 10.42 during this run | **exit 0**, 6 tests |
| `enrollment.node.test.ts` | `expected 19 to be 20` on twenty concurrent enrolments | same regime | **exit 0**, 7 tests |
| `bench-attestation.node.test.ts` | `git status --porcelain` moved across its own run | **measured, not guessed**: the status was bracketed on a repeat and read `?? …/23-01-SUMMARY.md, ?? …/deferred-items.md` before and `[empty]` after — 23-01 committed both **mid-run**. `packages/bench/src/index.ts` and `packages/bench/src/integrity.ts` are the files the first failure named, both 23-01's | **exit 0**, 4 tests, `real 154.98 user 6.35 sys 1.18`, with the bracketed status `[]` before and `[]` after |

`speculation-agents` + `enrollment` re-run together: **exit 0**, `Tests 13 passed (13)`,
`real 10.37 user 21.71 sys 3.91` -> 2.47.

**No agent process survives the suite.** `pgrep -f "agent\.ts --dir"` exit **1**, no match.
`pgrep -f "bin/agent.ts"` matches two processes and **neither is an agent**: they are
`orphan-leash.node.test.ts`'s own `agent-leashed.mjs` / `agent-unleashed.mjs` driver scripts
from a session at `01:57:23` and `01:57:25` today, ten hours older than this plan. Logged to
`deferred-items.md`, not touched.

### Spans, for whoever retakes `MEASURED_NODE_SPANS`

`--reporter=json`, both files in one run:

| file | span |
|---|---|
| `packages/node/src/agent-handshake.node.test.ts` | **522 ms** |
| `packages/node/src/bench-fabric.node.test.ts` | **788 ms** |

**Both below `SLOW_CUTOFF_MS` = 1000**, so neither is an exclusion. The caveat that applies
elsewhere does not bite here: `--reporter=json` attributes no hook time, and both files do
their spawning **inside** the `it` rather than in `beforeAll`, so no cost is hidden from the
reporter. Wall clocks agree: `real 1.25` and `real 2.29` for the two files run separately.

**File-count drift did not break the tolerance.** The node project holds **153** files against
the recorded 150 — drift **3** against `FILE_COUNT_TOLERANCE` 5. `slow-specs.node.test.ts`
exit **0**, 9 tests. `vitest.config.ts` was not touched; it is outside this plan's file list.

---

## Costs and consequences, stated rather than left to be found

1. **A fourth copy of `spawnAgent` now exists**, and it is the first one outside a
   `*.test.ts`. That is what makes it importable by `bin/bench.ts`, and it is also what makes
   consolidating the other twenty a Phase 22 reachability conversation rather than a tidy-up.
   Named in the module comment so the duplication is scheduled, not unnoticed.
2. **The observed process count at a rung is `nodes + 1`, not `nodes`.** The submitting node
   stays in this process because it must hold the store, the `EgressGuard` and the
   `RpcEndpoint`. Anything that counts processes against a rung's node count has to know this,
   and 23-01's checker is where it matters.
3. **`Fabric.blockstore` widened to `Blockstore`.** When 23-03 imports this type, `realFabric`'s
   `as unknown as MemoryBlockstore` becomes deletable — but 23-03 has to actually delete it,
   and nothing fails if it does not.
4. **`processFabric`'s signature will grow in wave 3.** 23-04 needs `inboundThreshold`,
   `submitterInboundThreshold` and `dial`. The submitter construction and the agent spawn are
   deliberately two separate steps here so the inverse dial order stays buildable.
5. **The handshake line is now ten keys.** It is still one line, still parsed to the first
   newline by every reader, and still carries nothing secret — a pid is printed by `ps` to
   every account on the host.

---

## Deferred / found, not closed here

- **Two orphaned `orphan-leash` driver processes from 01:57 today**, one of them the *leashed*
  arm, which is the interesting half and is unexplained. Logged to `deferred-items.md`; not
  killed, because they belong to another session.
- **`bin/bench.ts` and `perf-workload.ts` do not type-check at HEAD.** 23-01's, recorded by
  that agent in the same deferred list. `perf-workload.ts` is named by **no** Phase 23 plan and
  is the one that will otherwise stay broken.
- **`placeAgain`'s docblock in `submit.ts` still cites the deleted `coordinator.ts`.**
  Unchanged; recorded again because it was still there in the 2026-08-05 tree.
- **N above 2 is unmeasured** for this rig, as is the per-host inbound cap under it.

## Known Stubs

None. Every value the test reads is produced by a live job over two spawned processes; the one
literal on the rig — `combineIssuers: 'checks-no-combine-signatures'` — is a named absence
that is the truthful answer here, since no provider process exists and no node is enrolled.

## TDD Gate Compliance

Both tasks are marked `tdd="true"`. **There is no red `test(...)` commit**, for the reason in
Deviations, and retro-fitting one would be a fiction. What stands in its place: **both RED
readings watched and transcribed with their assertion text**, and **ten plants, nine watched
going red with their output pasted above and one reported GREEN as a finding**, each restored
inside one shell invocation with `cmp` exit `0` recorded.

Gate sequence in `git log`: `feat(23-02)` `ff5adf4` then `test(23-02)` `3acc37d`;
`feat(23-02)` `8219cb5` then `test(23-02)` `11f503a`. The `test` commits follow their `feat`
commits rather than preceding them.

## Commits

| Commit | What |
|---|---|
| `ff5adf4` | `feat(23-02)` — the agent states which process is holding the addresses it announces |
| `3acc37d` | `test(23-02)` — the process that announced the address is the process that was spawned |
| `8219cb5` | `feat(23-02)` — a benchmark rig whose nodes are operating-system processes |
| `11f503a` | `test(23-02)` — a real job across two spawned agents, with every identity read off the rig |

All four made with **explicit paths** (`git commit -m … -- <path>`) and each verified with
`git show --stat`: **one file each, only my own**, on an index a second agent was staging into
throughout. `git commit -F -` was not used. No backtick appears in any message.
`O2_SKIP_GUARDS` was **not** used — the pre-commit guard set passed on all four
(`Test Files 6 passed (6)`, `Tests 234 passed (234)`).

## Self-Check: PASSED

- `packages/node/src/bin/agent.ts` — FOUND
- `packages/node/src/agent-handshake.node.test.ts` — FOUND
- `packages/node/src/bench-fabric.ts` — FOUND
- `packages/node/src/bench-fabric.node.test.ts` — FOUND
- `.planning/phases/phase-23-multi-process-benchmark-driver/23-02-SUMMARY.md` — FOUND
- commits `ff5adf4`, `3acc37d`, `8219cb5`, `11f503a` — all FOUND in `git log`
