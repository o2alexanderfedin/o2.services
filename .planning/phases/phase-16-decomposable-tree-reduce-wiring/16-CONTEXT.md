# Phase 16: Decomposable Tree-Reduce Wiring - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Mode:** Autonomous — decisions below resolved from the existing `reduce.ts` API, the
wire protocol's own extension precedent, and the `@o2/node` → `@o2/demo` dependency
direction (which forecloses one obvious design). Three gaps are flagged rather than
resolved; see `<risks>`. One of the four success criteria has a measurement problem that
is stated in the criterion's own wording; see `<specifics>`, criterion 4.

<domain>
## Phase Boundary

`deriveReduceTree` (`packages/core/src/reduce.ts:98`), `rendezvousRank` (`:147`),
`executeReduce` (`:219`) and `localDispatch` (`:343`) are complete and unit-verified from
Phase 5. **Every single call site outside their own definition is either the barrel or a
test.** The classification, done by grepping each symbol and sorting the hits:

| Symbol | Definition | Barrel re-export | Test callers | Production callers |
|---|---|---|---|---|
| `deriveReduceTree` | `reduce.ts:98` | `core/src/index.ts:209` | `reduce.test.ts` ×12 | **none** |
| `executeReduce` | `reduce.ts:219` | `core/src/index.ts:210` | `reduce.test.ts` ×9 | **none** |
| `localDispatch` | `reduce.ts:343` | `core/src/index.ts:211` | `reduce.test.ts` ×9 | **none** |
| `rendezvousRank` | `reduce.ts:147` | `core/src/index.ts:212` | `reduce.test.ts` ×5 | `placement.ts:124` — **transitively dead**, see below |
| `Combiner` (type) | `reduce.ts:331` | `core/src/index.ts:217` | `reduce.test.ts:22,437,472` | **none** |
| `CombineDispatch` (type) | `reduce.ts:167` | `core/src/index.ts:215` | — | **none** |

`rendezvousRank` is the one that looks alive and is not. `placement.ts:124`
(`sampleCandidates`) calls it; `sampleCandidates` is called by `placeWithOffers`
(`placement.ts:143`); `placeWithOffers` is called by `planWithOffers`
(`placement.ts:227`), `coordinator.ts:339`, and `placement.test.ts` — and
`runResilient` (`coordinator.ts:267`) has no caller outside `churn.test.ts:10`. So the
chain terminates in a test in every direction. This is exactly the distinction the v1.1
milestone exists over: a barrel export is not a wire, and one production-looking import
edge is not a call path.

The only aggregation any runnable entry point performs today is `answerOf`
(`packages/demo/src/job.ts:231-238`) — a `for` loop over `JobResult['shards']` returning
the first `'found'` colouring. Its sole production caller is
`packages/browser/demo/main.ts:331`.

**In scope:** MR-02 … MR-07 — a combine that executes on a *remote* node chosen by
rendezvous ranking, over inputs named only by CID, driven by `executeReduce`, reachable
from a job dispatched across ≥8 `bin/agent.ts` processes and from `bin/bench.ts`.

**Out of scope:** replacing `answerOf` in the browser demo (decision 11 — the
`@o2/node` → `@o2/demo` edge does not exist and must not be created); job-supplied
combine code (decision 3, deferred); capability chains on the combine request (Phase 15);
per-request capacity refusal (SCHED-06, Phase 13.1); quorum composition over combines
(Phase 19); `runResilient` becoming the job path (Phase 20).
</domain>

<decisions>
## Implementation Decisions

### 1. A new `combine` wire kind — not an overloaded `exec`

`AgentRequest`'s `exec` variant (`packages/net/src/protocol.ts:56-61`) carries a `Task`,
and `Task` has exactly one `inputCid` (`packages/core/src/ports.ts:25-48`). A combine has
*k* inputs. Three ways to close that, and the first is the one to take:

- **(a) An eighth request kind, `combine`.** `{kind: 'combine', combineId: string,
  inputCids: readonly CID[], level: number}` → `{kind: 'combine', resultCid: CID | null,
  reason: string}`. `protocol.ts`'s own docstring (`:1-36`) narrates each kind's arrival
  by phase, so adding one is an established, documented act rather than an invention.
  Encoding follows the `providers`/`records` shape exactly (`encodeRequest:255-281`,
  `parseRequest:338-388`, `encodeResponse:436-479`, `parseResponse:481-545`); CIDs
  round-trip through the wire codec already and `distributed.test.ts:502` proves it.
- **(b) A combine as an ordinary `exec` against a WASM combine module,** with the serving
  node assembling `{parts: [...]}` from the resolved inputs. Rejected: the guest would
  have to decode DAG-CBOR. Every fixture in `packages/core/src/executor/fixtures.ts` is
  hand-assembled opcode bytes, and `packages/demo/src/kernel.wat` reads a flat
  little-endian layout precisely because CBOR in the guest is not something this
  repository has ever done. A CBOR-parsing guest is a phase of its own, not a wiring step.
- **(c) The requestor assembles each combine's input block and dispatches `exec`.**
  Rejected on MR-02/MR-06: the combine request would then carry a *payload* block rather
  than addresses, and `reduce.test.ts:210-231` ("does not move map-side data — a combine
  reads only CIDs") is the property the tree exists to have.

Take (a). The serving node resolves each `inputCid` through `options.blockstore`, which at
`fabric-node.ts:359` and `browser-node.ts:224` is a `FetchingBlockstore` over
`RpcBlockSource(rpc, () => transport.peers)` — so an input it has never seen is pulled by
CID from whoever has it, with no change to this phase's code. That is MR-06's "recomputed
elsewhere from its content-addressed inputs" delivered by machinery that already exists.

> **Correction, 2026-07-28, made against the source rather than against the intent.** The
> paragraph above is true of the **leaves** and false of every level above them, and Plan
> 16-02 carries the fix. A combine's result is written only to the executing node's local
> tier (`FetchingBlockstore.put` delegates to local, `block.ts:65-67`); nothing announces it,
> because every production `serveAgent` passes `index: 'serves-no-records'`
> (`fabric-node.ts:420`, `bin/bench.ts:152` and `:177`); and no fabric in this repository
> lets one executor's block source see another executor's store —
> `distributed.test.ts:70` pins each worker to `['origin']` over a plain `MemoryBlockstore`
> (`:52`), `bin/bench.ts:168` pins each to `['requestor']`, and in the eight-process topology
> the submitter dials outward so each agent's `transport.peers` is `[submitter]` alone. At 8
> leaves and fanout 4 the tree is depth 2, so level 2's inputs are reachable from nobody and
> the root lands in `failed`. Leaning on chained fetch through the requestor does not rescue
> it: a non-holding peer answers a block miss by asking the requestor straight back, where
> `#inFlight` (`block.ts:74-76`) returns the promise already blocked on that same peer — a
> circular wait broken only by timeout. **Plan 16-02 Task 2 closes it** by having
> `remoteCombineDispatch` retrieve each combine's result block from the one peer that just
> reported it, by CID, into the requestor's store, before `executeReduce` advances a level.
> The wire stays address-only; the cost is one small block per combine and is stated there.
> "With no change to this phase's code" was intent read as behaviour, and it is the thing
> this correction exists to stop being repeated downstream.

### 2. No new `serveAgent` hook — combining is not a capability a node can lack

Phase 11's rule is "an optional hook with a silent default is a hole", and the corollary
is that a hook exists to record a *decision*. There is no decision here: every node must
be able to run a combine, or `executeReduce`'s rendezvous ranking would be selecting
among nodes that differ in what they can do — which is the one thing this project has
ruled out. So `serveAgent` (`packages/net/src/agent.ts:156`) gains a `combine` branch in
its existing `if/else` chain (`:166-201`) that uses `options.blockstore`, which it already
takes, plus the fixed combiner from decision 3. It gains **no** new `AgentOptions` field.

Consequences worth stating because they are the reason this is the cheap path:
`agent-contract.test.ts`'s seven `@ts-expect-error` cases and its `'AgentOptions requires
all seven hooks'` describe block are untouched; `serve-agent-hooks.node.test.ts`'s
sentinel counts (`:27-54`) are untouched; the four production call sites
(`fabric-node.ts:411`, `browser-node.ts:264`, `bin/bench.ts:144` and `:170`) and the ~19
test call sites in `@o2/net` need no edit at all.

### 3. The combiner is fabric-fixed and lives in `@o2/core`; the *projection* is requestor-side

If two nodes could hold different `Combiner`s, `executeReduce` would report a
`disagreement` (`reduce.ts:305-307`, `:314`) with no way to name the cause — the tree is
*derived, never agreed* (`reduce.ts:8-12`), so there is no negotiation step in which a
mismatch could surface. Fail-loud with no diagnosis is worse than no configuration knob.
So: one exported `Combiner` in `@o2/core`, promoted from the one `reduce.test.ts:22-39`
already exercises (sum the numeric fields, key-wise merge the maps, sort the keys so the
encoding is order-independent) — associative and commutative, and already surrounded by
the falsification tests that prove the reference comparison catches a non-associative
reducer (`reduce.test.ts:467-498`).

Per-job semantics enter as a **projection**, not as travelling code. The map output shape
and the partial shape are not the same thing: `MODULE_WRITES_PARTITION`
(`fixtures.ts:113`) emits `{p: <4 LE bytes>}`, and the combiner's monoid is
`{counts, rows}`. The reduce driver (decision 4) therefore takes a
`project: (output: CanonicalValue, partitionIndex: number) => CanonicalValue` supplied by
the *submitting* side, which already holds every shard's decoded output in-process. The
projection never crosses a wire; the combiner never varies.

Assumption, labelled: the built-in combiner is enough for both entry points this phase
must satisfy (`bin/bench.ts`'s fixture job and the ≥8-agent test job). It is **not**
enough for the demo's colouring answer — see decision 11.

### 4. The reduce driver is `reduceJob` in `@o2/net`, beside `submitJobWithEgress`

`submitJob` lives in `@o2/core` and cannot reach `RpcEndpoint`: `purity.node.test.ts:167`
asserts `packages/core/package.json` declares **zero** `@o2/*` dependencies, and the
executors a combine is ranked over are peer ids on an RPC endpoint. This is the identical
constraint that produced `submitJobWithEgress` (`packages/net/src/submit-with-egress.ts:79`),
and the resolution is the identical one 13-CONTEXT decision 2 recorded: a thin helper in
`@o2/net`, at the layer where both sides are already in scope.

`reduceJob(job, {rpc, executors, blockstore, project, fanout?, redundancy?})` →
`{outcome: ReduceOutcome, tree: ReduceTree, leaves: readonly CID[]}`. Kept **separate**
from `submitJobWithEgress` rather than folded into a single `submitJobWithEgressAndReduce`
— each helper stays one thing, and `bin/bench.ts` calls them in sequence.

### 5. Leaves are the shard outputs, projected, and the driver stores them

`submitJob` already persists each agreed output as a block (`submit.ts:239-242`) and
`VerificationResult` carries `resultCid` on the `'agreed'` arm (`verify.ts:110-121`), so
the unprojected leaf CIDs are free. With decision 3's projection the driver must
`canonicalCid(project(...))` and `blockstore.put` each partial itself — *N* extra small
blocks in the requestor's store, which is where a combine node will fetch them from.

A shard whose verification is not `'agreed'` contributes **no leaf**. `deriveReduceTree`
throws `RangeError` on an empty set (`reduce.ts:102`), so the driver must return a named
failure rather than let that escape — `{ok: false, reason: 'no agreed shard produced a
partial'}`. A job with one agreed shard is the degenerate single-partial case
`reduce.ts:110-116` already handles: zero combines, `rootId` is the leaf.

### 6. Combines dispatch to remote peers only; the submitter is not in the executor set

`RemoteExecutor` and `RpcEndpoint.request` address a *peer*; a libp2p node cannot dial
itself. `executeReduce`'s `executors` list is therefore the connected agent peer ids, and
the submitter is excluded. `remoteCombineDispatch` — the sibling of `remoteDispatch`
(`packages/net/src/churn.ts:45`), same file-level shape, same failure-kind reasoning —
returns `null` on any RPC throw, malformed reply, `error` reply, or `resultCid: null`,
which is exactly the fallthrough signal `executeReduce:273-277` walks the ranking on.

### 7. `inputCids` is bounded at the parser, not at the handler

A `combine` request makes an unauthenticated peer cause *k* block fetches on the receiving
node, each potentially a network round trip. `parseRequest` must refuse a frame whose
`inputCids` exceeds a declared constant — `MAX_COMBINE_INPUTS`, alongside
`MAX_PARTIAL_BYTES` (`reduce.ts:63`) and `MAX_PARTITIONS`
(`packages/core/src/executor/wasm.ts:37`), which is where this repository keeps such
bounds. Refusing at the parser rather than in the handler matches how `parseRequest`
already refuses a partition index outside its own count (`protocol.ts:396-398`) and a
sovereign label with no owner (`:414-416`): the frame does not become a request at all.
NET-08 (Phase 13.1) is the general form of this and does not cover it — that requirement
is about `readMessage`'s byte ceiling, this is about a field's element count.

### 8. A node that authorizes `exec` refuses `combine` — fail-closed until Phase 15

`Authorizer` takes `{task, capability}` (`agent.ts:62-64`) and a combine has no `Task`, so
the existing hook cannot be consulted. The choice is between serving combines
unauthenticated on a node that authenticates everything else, and refusing. Refuse: the
`combine` branch answers `{resultCid: null, reason: 'combine requires a capability chain
this build cannot verify'}` whenever `options.authorize !== 'serves-unauthenticated'`.
Every production call site passes the sentinel today, so this is a no-op now and becomes
a real refusal the moment Phase 15 lands — which is the direction a gap should fail in.

### 9. The ≥8-node harness dials outward from the submitter, with a short RPC budget

Two facts constrain the shape, and both are already recorded in this repository:

- `bin/bench.ts:424-430` publishes the reason its real-transport ladder is excluded above
  ~5 nodes: `INBOUND_CONNECTION_THRESHOLD = 5` **per host**
  (`packages/libp2p/src/constants.ts:65`), and in `realFabric` every node dials the
  *requestor*, so the requestor absorbs N inbound connections from one host. Invert it:
  the submitter dials each agent, exactly as `two-process.node.test.ts:126-132` and
  `sovereignty-placement.node.test.ts:141-145` already do, and each agent sees one inbound
  connection. Eight agents is then eight *outbound* dials, which nothing caps.
- NET-10 (`REQUIREMENTS.md:463-472`) — a refusal reaches the requestor as a timeout, and
  `DEFAULT_RPC_TIMEOUT_MS` is 30 000 (`rpc.ts:23`). A killed combine node's fallthrough
  would otherwise cost 30 s per rank step. The submitter in these tests is constructed
  with a short `rpcTimeoutMs` — the same move `two-process.node.test.ts:86` and
  `sovereignty-placement.node.test.ts:96` already make for the opposite reason — and the
  plan should say in the test's own docstring that the short budget is a NET-10 symptom,
  not a property of the reduce.

`bin/agent.ts` needs **no new flag**. It already produces a node with the full serving
surface (`fabric-node.ts:411`), and decision 2 means combining arrives with it.

### 10. `bin/bench.ts` times the reduce as its own segment, not inside `makespanMs`

`.planning/BENCHMARK-METHODOLOGY.md:60-63` pre-registers makespan as "wall-clock from job
submission to the last shard's result being available to the requestor". A combine happens
*after* the last shard's result, so folding it into `makespanMs` silently redefines the
primary metric across every previously published number. Instead `Observation`
(`packages/bench/src/harness.ts:59-69`) gains a reduce group — `reduceMs`, `treeDepth`,
`combines`, `recomputes`, `combineExecutors` (distinct peer ids in
`ReduceOutcome.executedBy`) — timed inside `runnerFor`'s `run`
(`bin/bench.ts:255-309`) with its own `performance.now()` pair, and `renderMarkdown`
(`packages/bench/src/report.ts:137`) emits a reduce table. `MachineRole` already has an
`'aggregator'` member (`report.ts:32`) that `inventory()` (`bin/bench.ts:66-83`) does not
use; it becomes accurate here.

The methodology's Amendments section (`:266`) must gain a dated entry naming the new
fields. Silent edits are forbidden by that file's own preamble (`:12-14`).

### 11. `answerOf` stays; the demo's linear scan is not replaced in this phase

The ROADMAP goal says "replacing the demo's linear scan", but no success criterion names
the demo — all four name `bin/agent.ts` or `bin/bench.ts`. Two hard facts make replacing
it the wrong call here:

- `packages/node/package.json` has no `@o2/demo` dependency, and adding one would let the
  Node agent import the colouring kernel's host code. `@o2/browser` does depend on
  `@o2/demo`; `@o2/node` deliberately does not.
- `answerOf`'s semantics — first `'found'` colouring wins — is not the built-in combiner
  from decision 3, and making it one would require the per-node combiner to vary by job,
  which decision 3 rules out.

So the goal sentence is read as naming the *class* of gap ("the only aggregation any entry
point performs is a linear scan"), and this phase closes it at the entry points the
criteria name. A cheap, honest partial move is offered in `<specifics>`; full replacement
is in `<deferred>`.
</decisions>

<code_context>
## Existing Code Insights

### `packages/core/src/reduce.ts` — what already works, and what it assumes
- `deriveReduceTree(cids, fanout = 4)` (`:98`) sorts and **dedupes** (`:106`) before
  building, which is the whole basis of agreement-free topology. Throws `RangeError` on
  `fanout < 2` and on an empty set (`:99-102`) — decision 5's failure path.
- A lone child at a layer boundary is *promoted*, not wrapped (`:116-120`), so a
  9-partial tree at fanout 4 has a level-1 node with one leaf carried up. Any assertion
  on `tree.nodes.length` must account for that; at 8 partials and fanout 4 it is exactly
  3 nodes and `depth === 2`.
- `executeReduce` (`:219`) runs levels sequentially and combines within a level under
  `Promise.all` (`:248`). At 8 shards the widest level is 2 concurrent requests — which
  matters for NET-09, below.
- `recomputes` counts *failed attempts*, not combines re-run (`:303`) — so criterion 2's
  assertion is `recomputes > 0`, and the "recomputed elsewhere" claim is carried by
  `executedBy` naming a different peer, not by that counter alone.
- `ok` is false when any combine failed **or** any replica disagreed (`:313-314`) — a
  disagreement is a failed reduce, not a footnote.
- `redundancy` (`:188`) is the C3 split made executable: the map is owner-attested, the
  aggregation over it is verified. `minReplicas` (`:210`, `:321`) reports what was
  actually achieved.
- `localDispatch` (`:343-366`) is the local half of the pair this phase completes. Note
  `:350` — `liveNodes()` gating is what makes an executor "gone"; the remote sibling gets
  that for free from a failed RPC.

### Where the partial CIDs come from
- `ShardResult` (`submit.ts:55-68`) carries `inputCid` and `verification`.
- `VerificationResult`'s `'agreed'` arm carries `resultCid: CID` (`verify.ts:110-121`).
- `submitJob` already `blockstore.put`s the encoded agreed output (`submit.ts:239-242`),
  so the leaf blocks are resident in the requestor's store before the reduce starts.
- `submitJob` returns no output CID on `JobResult` itself (`:70-98`) — it is reachable
  only through `verification.resultCid`. The driver reads it there.

### The wire seam
- `AgentRequest` / `AgentResponse` unions: `protocol.ts:55-84` / `:86-112`.
- `serveAgent`'s handler chain: `agent.ts:159-254`. The non-exec branches are a flat
  `else if` ladder (`:166-201`); the exec branch (`:201-251`) is the only one that
  returns an `RpcReply` with `afterSent` for the egress release. A `combine` branch
  belongs in the ladder and needs no `afterSent`: a combine's inputs are partials, and
  only the *executing* node of a map task registers a sovereign payload
  (`registerSovereignInputs`, wired at `fabric-node.ts:376` / `browser-node.ts:256-262`),
  so no registration is outstanding against a combine reply.
- `remoteDispatch` (`churn.ts:45-94`) is the exact pattern to copy for
  `remoteCombineDispatch`: try/catch the `rpc.request`, `parseResponse`, branch on
  `null` / `'error'` / wrong kind, and map each to the caller's failure vocabulary. Its
  file-level table (`churn.ts:14-26`) is the reasoning worth reusing verbatim.

### The four production `serveAgent` call sites (unchanged by decision 2, listed so the planner can confirm)
`packages/node/src/fabric-node.ts:411`, `packages/browser/src/browser-node.ts:264`,
`packages/node/src/bin/bench.ts:144` (requestor endpoint) and `:170` (per-worker
endpoint). `bin/seed.ts` has none of its own — `SeedServer` composes a `FabricNode`.

### The real-process harness to copy
`packages/node/src/two-process.node.test.ts:45-116` (spawn + one-line stdout handshake +
SIGTERM-then-SIGKILL teardown) and `sovereignty-placement.node.test.ts:56-126` (the same,
plus extra argv). Existing maximum is **three** spawned agents
(`sovereignty-placement.node.test.ts:135-139`); this phase needs eight. `AGENT` is
resolved with `fileURLToPath(new URL('./bin/agent.ts', import.meta.url))` and spawned via
`spawn(process.execPath, [AGENT, '--dir', dir, ...])`.
`two-process.node.test.ts:171-205` is the precedent for reading a *killed* agent's
blockstore directory from the parent process afterwards — criterion 2's "no state
transfer" evidence.

### `bin/bench.ts` as it stands
- `SHARDS = 8` (`:64`) — which is also, per NET-09, exactly one below the early-stream
  cliff. Do not raise it in this phase.
- `runnerFor`'s `run` (`:255-309`) already brackets `submitJobWithEgress` with
  `performance.now()` (`:266`, `:278`) and already threads a per-run accumulator
  (`egressEntries`/`egressBytes`, `:257-258`, `:283-288`) out through a closure — the
  identical shape a reduce accumulator takes.
- `Observation`'s `speculationMultiplier: 1` / `redispatches: 0` are documented at
  `:302-306` as *identities, not measurements*, and `report.unmet` says so again at
  `:484-486`. A reduce field left at zero would have to join that list; a real one must
  not be reported as if it were measured.
- `realFabric` (`:202-237`) surfaces `requestor.egress` (`:231`) with a comment stating
  it is the same field `bin/agent.ts`'s own `FabricNode` exposes — the pattern for
  wiring a new capability into the benchmark without a bench-only construction.

### `@o2/bench` shapes that must change for criterion 4
`Observation` `harness.ts:59-69`; `SweepResult` `:94-105`; `costOf` `:110-127` (means
over observations); `measure` `:137-167`; `MachineRole` / `Machine` / `Inventory`
`report.ts:32-50`; `renderMarkdown` `:137+`. `harness.test.ts` builds `Observation`
literals and will fail to compile on a required new field — intended, but size the diff
for it.

### The demo's linear scan
`packages/demo/src/job.ts:231-238` (`answerOf`), barrel `packages/demo/src/index.ts:63`,
tests `packages/demo/src/kernel.test.ts:424` and `:453`, sole production caller
`packages/browser/demo/main.ts:331`. `partialOf` (`job.ts:193-207`) already parses a
shard output into `{status, bits}` without throwing — the natural basis for a
`colouringCombiner` if `<deferred>`'s item is ever taken up.

### Guard tests that will react to this phase
- `packages/node/src/purity.node.test.ts` — `@o2/net` is in `PORTABLE` (`:28`), so
  `remoteCombineDispatch`/`reduceJob` may import nothing platform-specific.
- `packages/node/src/vocabulary.node.test.ts` — scans every git-tracked file including
  `.planning/`.
- `packages/net/src/agent-contract.test.ts` and
  `packages/node/src/serve-agent-hooks.node.test.ts` — unchanged under decision 2, and
  the plan should say so explicitly so a reviewer does not go looking.
- `packages/node/src/constants.node.test.ts:94-99` — asserts libp2p's own
  `INBOUND_CONNECTION_THRESHOLD` still equals the mirrored constant. Relevant to
  decision 9's dial direction, not changed by it.

### `MemoryNetwork`'s own docstring already names this workload
`packages/core/src/transport/memory.ts:9-11`: "100+ nodes in one process with
deterministic delivery is how the scheduler and reduce-tree logic get exercised without a
network in the way." A same-process `MemoryNetwork` reduce test is the cheap first plan;
it is **not** sufficient evidence for criterion 1, which names `bin/agent.ts`.
</code_context>

<specifics>
## Specific Ideas

**How each success criterion is measured.**

**Criterion 1 — 8+ live nodes, tree walk, bit-for-bit aggregate.** Four independent
measurements, all in one `*.node.test.ts` spawning eight `bin/agent.ts` processes:
1. *Node count:* `agents.length >= 8` and `new Set(executors.map(e => e.nodeId)).size >= 8`,
   with every id a distinct child process's announced `peerId`.
2. *It is a tree, not a scan:* `tree.nodes.length === 3` and `tree.depth === 2` for 8
   leaves at fanout 4 (`reduce.ts:112-136`), `outcome.combines === tree.nodes.length`,
   and `outcome.executedBy.size === tree.nodes.length`. A linear scan produces zero
   combines and an empty `executedBy`, so the two are not confusable.
3. *Rendezvous assignment (MR-05):* for every `node` in `tree.nodes`,
   `outcome.executedBy.get(node.id) === rendezvousRank(node.id, executorIds)[0]` on the
   healthy run. This is the assignment rule checked against the production dispatch, not
   against itself — the test computes the expected winner from the same pure function the
   driver uses, which is weak on its own and is why measurement 4 exists.
4. *Bit-for-bit:* `outcome.rootCid === (await canonicalCid(combiner(projections))).cid.toString()`,
   the reference computed in the test process over the same projected partials —
   `reduce.test.ts:177-183`'s assertion, now over a live tree across eight OS processes.

**Criterion 2 — killing a combine node.** The victim is computed before dispatch:
`rendezvousRank(tree.nodes[0].id, executorIds)[0]`, exactly as `reduce.test.ts:255` does.
Three measurements:
1. *Mid-job:* the kill is performed from inside a wrapping `CombineDispatch` on first
   contact with a level-1 combine, so the process dies while the reduce is in flight
   rather than between phases. `SIGKILL`, not `SIGTERM` — `bin/agent.ts:61-68` has a
   graceful shutdown and criterion 2 is about a node that vanishes.
2. *Recomputed elsewhere:* `outcome.recomputes > 0` **and**
   `outcome.executedBy.get(victimCombineId) !== victimPeerId` **and**
   `outcome.rootCid === healthyRoot`.
3. *No state transfer:* assert on the frame, not on a narrative —
   `encodeRequest({kind:'combine', ...})` yields a record whose `inputCids` are CIDs and
   which contains no partial payload, and the replacement agent's blockstore directory,
   reopened with `FsBlockstore.open(agent.dir)` after the run (the
   `two-process.node.test.ts:190-200` move), contains the input partial blocks under the
   CIDs the submitter computed. Every byte it holds it obtained by asking for a CID.

**Criterion 3 — the late duplicate.** Two measurements, because one of them is honest
about a gap:
1. *Inside the production path:* run the reduce at `redundancy: 2`. Two executors produce
   each combine, `outcome.disagreements` is `[]` and `outcome.minReplicas === 2` — two
   independent results that deduped because they carry the same CID
   (`executeReduce:288`, `:305-307`).
2. *The churn-shaped one:* after the criterion-2 run completes, restart the killed agent,
   dispatch the *same* `CombineTask` to it through the same `remoteCombineDispatch`, and
   assert the returned CID equals `outcome.executedBy`'s original result and that the
   submitter's `store.size` is unchanged across the second dispatch —
   `reduce.test.ts:290-298`'s assertion, live.
   **Stated plainly: `executeReduce` has no late-arrival channel.** It walks the ranking
   and stops at `wanted` replicas (`:271-279`); a result arriving after that is not
   something the production path can receive. So the duplicate in measurement 2 is
   *staged by the test*, and what is measured is the dedupe property (same inputs → same
   bytes → same CID → no second block), not a production code path that handles late
   arrivals. If the phase wants the latter, it is new machinery and belongs in a
   criterion of its own.

**Criterion 4 — this one cannot be fully measured as written, and here is why.** "reports
the reduce-tree combine step … as part of its measured job path, rather than bypassing
`executeReduce` the way the demo currently does" contains two clauses with different
statuses. The first is measurable: after `node --experimental-strip-types
packages/node/src/bin/bench.ts --quick`, `.planning/BENCHMARK-RESULTS.md` contains a
reduce table whose `treeDepth >= 1`, `combines >= 1`, `combineExecutors >= 2` and
`reduceMs > 0`, and a `*.node.test.ts` reads the rendered markdown and asserts exactly
that — the same shape `serve-agent-hooks.node.test.ts` uses to assert against file text.
The second clause ("rather than bypassing … the way the demo currently does") is a
statement about `packages/browser/demo/main.ts`, which decision 11 does not change; it can
only be *reported*, not measured, from anything `bin/bench.ts` does. **What would actually
measure it:** a guard test asserting that no production module reachable from a runnable
entry point aggregates shard results without calling `executeReduce` — which is WIRE-02's
job (Phase 22), not this phase's, and the plan should route it there by name rather than
claim the clause satisfied.

**Falsify the wiring before believing it, per this repository's standing pattern.** Phase
12 and Phase 13 both planted mutations. The three worth planting here: (a) make
`remoteCombineDispatch` resolve the *local* `localDispatch` result instead of the RPC
reply — criterion 1's measurement 3 must fail, because `executedBy` would name the
submitter; (b) replace `deriveReduceTree` with a left fold over the sorted leaves —
measurement 2 must fail on `tree.depth`; (c) make the combine handler return the first
input CID unchanged — the bit-for-bit reference in measurement 4 must fail. If a mutation
passes, the assertion is not measuring what it claims.

**A same-process `MemoryNetwork` plan first, then the process plan.** `distributed.test.ts`
already stands up N `serveAgent` endpoints over `MemoryNetwork` (`:49`, `:72`, `:476`,
`:529`, `:575`) and `memory.ts:9-11` names this exact workload. That plan gets the wire
kind, the handler, `remoteCombineDispatch` and `reduceJob` correct with no process
overhead; the eight-agent plan then proves the boundary. This is the ordering
`two-process.node.test.ts:17-27` argues for in its own docstring.

**A cheap, honest partial move on the demo, if the planner wants it.** `@o2/demo` may add
a `colouringCombiner: Combiner` built on the existing `partialOf` (`job.ts:193-207`) —
`'found'` beats `'exhausted'` beats `'budget'`, ties broken by the lexicographically
smallest `bits`, which is a semilattice join and therefore associative, commutative and
idempotent — plus a `@o2/demo` unit test asserting `executeReduce` over
`localDispatch({combiner: colouringCombiner})` reaches the same answer as
`answerOf(job.shards)`. That is in-process, needs no dependency edge, and retires the
"the demo merges with a linear scan" sentence in `REQUIREMENTS.md:371` at the package
level without pretending a remote combine happened. It satisfies **no** success criterion
and should be planned last or not at all.
</specifics>

<deferred>
## Deferred Ideas

- **Job-supplied combine code.** The general answer to decision 3 is a content-addressed
  combine module fetched by CID like any other artifact, so a job ships its own merge
  function. That needs a guest that can read *k* partials — either a multi-input `Task`
  ABI or a CBOR-capable guest — and it is a phase, not a step. Until then the fabric
  offers exactly one associative merge and jobs project into it.
- **Replacing `answerOf` on the demo path.** Blocked on the item above and on the
  `@o2/node` → `@o2/demo` non-dependency. See decision 11 and the partial move in
  `<specifics>`.
- **A production late-arrival channel for combine results.** See criterion 3's second
  measurement — `executeReduce` cannot receive one today, and building it is new
  machinery no criterion asks for.
- **Capability chains on the `combine` request** — Phase 15 (AUTH-03). Decision 8 makes
  the gap fail closed rather than leaving it open.
- **Per-request capacity refusal on `combine`** — SCHED-06, Phase 13.1. Whatever that
  phase establishes for `exec` is what `combine` should reuse; inventing a second
  admission path here would guarantee they diverge.
- **Quorum composition over combines** — Phase 19. `executeReduce`'s `redundancy` gives
  *k* replicas ranked by rendezvous; it does not give anti-affinity or a
  backbone-anchored replica, and it should not be extended to here.
- **The reduce on the browser tier.** `BrowserNode` inherits the `combine` handler for
  free under decision 2, but no criterion exercises it and `BrowserNode.start()` still has
  no dedicated runtime test anywhere in the repository (Phase 11's `11-VERIFICATION.md`,
  restated in the Phase 19 ROADMAP constraints). Compiled and never executed is the
  honest status; Phase 19's multi-browser standard is where it becomes runnable.
</deferred>

<risks>
## Risks — flagged, not resolved

**1. NET-09's early-stream cliff sits directly under criterion 1's node count.**
`REQUIREMENTS.md:457-462` records the measurement: "N=8 completes and N=12 fails entirely
on `MaxEarlyStreamsError: Too many early streams - 11/10`, a hardcoded libp2p default that
aborts the whole connection", and notes `bin/bench.ts` ships `SHARDS = 8`, one below it.
Criterion 1 needs ≥8 nodes *and* adds combine requests on top of the map dispatch. The
cliff is per-connection, and decision 9's dial direction spreads eight shards over eight
connections rather than concentrating them, and `executeReduce` runs at most two concurrent
combines at this tree size — so the arithmetic says it fits. **It has not been run.** If
Phase 13.1 lands first the cliff is gone; if it does not, the plan must cap per-peer
concurrency explicitly and say so, rather than discovering it as an intermittent
`MaxEarlyStreamsError` that reads like a network fault.

**2. Eight spawned agent processes is nearly triple the existing maximum.** Every prior
real-process test spawns two or three (`two-process.node.test.ts:126`,
`sovereignty-placement.node.test.ts:135-139`, `egress-refusal.node.test.ts:179-180`), each
with a 120 s test timeout and a 30 s handshake timeout. Eight `FabricNode.start()` calls,
each a full libp2p node, plus a submitter, in one test — memory, startup wall-clock, and
teardown flake are all untested at that scale, and a full `npx vitest run` already takes
~5 minutes. Size the timeout deliberately and start the agents with `Promise.all` as the
existing tests do.

**3. Criterion 4 changes what the published benchmark numbers mean, and the methodology is
pre-registered.** Decision 10 keeps `makespanMs` intact by timing the reduce separately,
which is the conservative choice — but `.planning/BENCHMARK-RESULTS.md` will be regenerated
with new columns, and `.planning/BENCHMARK-METHODOLOGY.md:12-14` forbids silent edits and
requires a dated Amendments entry (`:266`). The planner must decide whether the reduce
belongs in the makespan at all (arguably it does — a user waits for the aggregate, not for
the last shard) and, if so, amend the definition explicitly rather than let the number
quietly change meaning. Either answer is defensible; leaving it implicit is not.

**4. The projection (decision 3) is a requestor-side function with no verification.**
`executeReduce` verifies the aggregation over partials; nothing verifies that the
requestor projected each shard output faithfully. For a public job the requestor is the
job's author and has no incentive to corrupt its own answer, so this is not a threat
today. It becomes one the moment a third party submits on someone else's behalf, and the
fix is the deferred content-addressed combine module — where the projection would itself
be guest code with a CID. Worth one sentence in the plan so it is not discovered as a
finding later.

**5. `Observation` gaining required fields breaks every literal that builds one.**
`packages/bench/src/harness.test.ts` constructs `Observation` objects directly. Making the
reduce fields required is the loud choice this repository consistently prefers (the same
reasoning `agent-contract.test.ts:15-19` states for `@ts-expect-error`), but it is a
compile-time break across a file the phase otherwise does not touch. Optional fields with
zero defaults would avoid it and would reproduce exactly the "identities, not
measurements" problem `bin/bench.ts:302-306` already documents. Recommend required;
say which, and why, in the plan.
</risks>
