# Phase 12: Sovereignty-Pinned Placement - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Mode:** Autonomous — decisions below resolved from recorded project principles and the
existing type shapes. Two open risks are flagged rather than resolved; see "Risks".

<domain>
## Phase Boundary

The sovereignty gate moves onto the path a job actually runs through.

Today `submitJob` (`packages/core/src/job/submit.ts:100`) picks executors with
`executorsFor` — unconditional round-robin, modulo the executor count. It never builds a
`PlacementRequest` and never calls `eligibleNodes`. Meanwhile `sovereignty.ts` contains a
complete, total, well-tested gate that nothing on a runnable path calls.

**In scope:** DATA-03, DATA-04, DATA-07, DATA-09 — a sovereignty label that travels with
a shard, `submitJob` consulting `eligibleNodes` before placing, and a serving node
refusing a sovereign task it is not cleared to execute.

**Out of scope:** the egress *manifest* (Phase 13 — `EgressGuard`), the reduce *tree*
(Phase 16), quorum composition and owner-domain attestation receipts (Phase 19), and
discovery of who the owner's nodes even are (Phase 18). Phase 12 takes the node set as
given by its caller.
</domain>

<decisions>
## Implementation Decisions

### The `Executor` port does not change — correlate by `nodeId`

`submitJob` deals in `Executor`, which is deliberately opaque: `{nodeId, execute()}`. It
cannot tell where an executor runs, and **that is a recorded project decision**, from
Phase 2:

> *A remote executor is just an `Executor`. `submitJob` takes `Executor[]` and cannot tell
> where one runs, so the network arrived without a kernel change. Any future "distributed"
> feature should first be checked against this: if it can be an adapter behind an existing
> port, it must be.*

Sovereignty is exactly such a feature. `eligibleNodes` works on `NodeDescriptor`
(`{nodeId, ownerId, canExecuteSovereign, load}`), and `Executor` already carries `nodeId`.

**So `JobSpec` gains a `nodes: readonly NodeDescriptor[]` alongside `executors`,
correlated by `nodeId`.** Placement is decided over descriptors; the chosen `nodeId`s
select executors. Do **not** add `ownerId` to the `Executor` interface — that pushes a
scheduling concern into an execution port and breaks every adapter.

An executor with no matching descriptor is an error, not an unowned node. Silence there
would let a node slip past the gate by omission, which is the shape of defect this whole
milestone exists to remove.

### The label belongs to the shard, not the job

DATA-03 says the label *travels with the data*. Shards are the data, and one job may mix
public and sovereign shards — a cross-owner aggregate is the motivating case in
`PROJECT.md`. A single job-level label would make that unexpressible.

`coordinator.ts:85-90` already models exactly this shape (`readonly label: 'public' |
'sovereign'` per shard). **Follow it.** Whether `JobSpec.shards` becomes an array of
`{value, label, ownerId?}` or gains a parallel labels array is the planner's call, but a
public shard must stay cheap to express — the demo submits public work and should not have
to say so six times.

### `Task` carries the label, because the refusal happens at the far end

DATA-09's criterion is that a node holding only an *encrypted* replica refuses a sovereign
task **before instantiation**. That refusal is made by the serving node, which sees only a
`Task` — today `{moduleCid, inputCid, partitionIndex, partitionCount}`, entirely
addressed by CID and carrying no owner.

So `Task` gains the label and owner. This is the second half of the gate and it is not
redundant with the placer: the placer stops a *correct* requestor from sending sovereign
work to the wrong node; the serving check stops an *incorrect or hostile* one. Both, or
the guarantee is a client-side convention.

### A sovereign shard that cannot reach its redundancy degrades — it does not error

`submitJob` currently rejects the whole job with `not-enough-executors` when
`executors.length < redundancy`. That rule cannot survive contact with sovereignty: an
owner with one live node is the *expected* case, and `Placement` already models it as
`degraded: true` with the count actually achieved.

Recorded decision (Phase 4): **a sovereign shard with nowhere to run stalls** — it is
never relocated to satisfy redundancy. So:

- fewer eligible nodes than requested redundancy → place at what is available, mark
  `degraded`, and surface it on the result
- zero eligible nodes → that shard is unplaceable and is reported as such

Degradation must reach `JobResult`. A job that quietly ran a shard once when two were
asked for has reported verified agreement it did not achieve — `submitJob`'s existing
comment on `executors` says precisely this, and it is the reason the current check exists.
Keep the intent, change the mechanism.

**This phase does not decide what a degraded sovereign result is *called*.** Owner-attested
vs. verified is VER-08/VER-09, in Phase 19. Phase 12 must make the fact visible and
must not label it "verified".

### Load can never widen the candidate set

`planPlacement` consults load only to order nodes already returned by `eligibleNodes`.
Phase 4 verified this by adding the forbidden relax-under-pressure branch and watching
four tests fail. **Do not add a fallback, a retry-wider, or a "best effort" path.** If the
new code has any branch that can place a sovereign shard on a non-owner node, the phase
has failed regardless of what the tests say.

### Claude's Discretion

The exact shape of the labelled shard (wrapper object vs. parallel array), how
`SubmitError` grows, how degradation is represented on `JobResult`, and whether the
descriptor correlation is a `Map` built once or a lookup per shard.
</decisions>

<code_context>
## Existing Code Insights

### The mechanism that exists and is unreached
`packages/core/src/sovereignty.ts`:
- `Sovereignty = 'public' | 'sovereign'` — a two-value union rather than a boolean, so the
  sovereign case must be named at every site. The file says why: `if (!shard.public)`
  reads as an oversight waiting to happen.
- `NodeDescriptor {nodeId, ownerId, canExecuteSovereign, load}` — **`canExecuteSovereign`
  is where DATA-09 already lives.** A backbone node holding an encrypted replica is
  `false` here: useless for execution, still a perfectly good block source.
- `eligibleNodes(request, nodes)` — **the only place eligibility is decided**, and
  deliberately total. A sovereign request with `ownerId === undefined` returns `[]`,
  because "a sovereign shard with no owner is not a wide-open shard; it is a broken one."
- `planPlacement(requests, nodes)` → `PlacementPlan {placements, complete}`; `Placement`
  is `placed` (with `nodeIds`, `replicas`, `degraded`) or `unplaceable` (with `reason`).

### The path that needs it
`packages/core/src/job/submit.ts`:
- `JobSpec {moduleCid, shards, executors, redundancy}` — no label, no owner, no descriptors
- `executorsFor(all, shardIndex, redundancy)` at :82-92 — the round-robin the audit named
- `submitJob` validates `executors.length >= redundancy` and errors otherwise
- `SubmitError` is a closed union — adding a variant is a compile error at every consumer,
  which is the good kind of change

`packages/core/src/ports.ts`:
- `Task {moduleCid, inputCid, partitionIndex, partitionCount}` — gains the label
- `Executor {nodeId, execute(task)}` — **do not change**

### The one existing consumer of the gate
`packages/core/src/coordinator.ts` calls `placeWithOffers` (:339) and already carries
per-shard labels (:85-90). It is reachable only via `runResilient`, which has no caller —
Phase 20 resolves that. **Read it as a reference for shape, and check your work against
it**: if Phase 12 invents a second way to express a labelled shard, Phase 20 inherits a
merge conflict between two spellings of the same idea.

### Established patterns
- **Conformance vectors are hardcoded literals, never computed.** A computed expectation
  only proves an implementation agrees with itself.
- **Mutation-test every new guard.** Phase 4 proved its own sovereignty claim by adding
  the forbidden branch and watching tests fail. Do that again here — it is the only
  evidence that distinguishes "the gate is wired" from "the gate exists".
- **Every exclusion is named** (Phase 6). Silent filtering leaves a requestor unable to
  tell a dead network from a wrong clock from a node that is simply not cleared.
- `serveAgent`'s `authorize` hook is now **required** (Phase 11) and every production call
  site passes `'serves-unauthenticated'`. The sovereign serving-side refusal is a natural
  fit for it — but note Phase 15 owns AUTH-03 capability chains. Do not conflate: the
  DATA-09 refusal is about *what this node may decrypt*, not about *who authorised the
  caller*.
</code_context>

<specifics>
## Specific Ideas

**The criterion that discriminates is the load-pressure one.** ROADMAP criterion 1 asks for
a test that *applies artificial load pressure specifically to force relocation onto a
non-owner node, and fails to move it*. A test that merely places a sovereign shard
correctly under no pressure proves nothing about the gate — it would pass against
round-robin if the owner happened to be picked. Make the pressure real: load the owner's
node to 1.0 and every non-owner node to 0.0.

**DATA-09 needs a node that is genuinely a replica holder.** The interesting case is a
node with `canExecuteSovereign: false` that *does* answer block requests for the same
data. If the test's replica node holds nothing, the refusal is trivially satisfied by the
node not having the data, and the criterion is untested.
</specifics>

<deferred>
## Deferred Ideas

- **Egress accounting** — Phase 13. Phase 12 must not build a second, weaker byte-counter.
- **Where the `NodeDescriptor[]` comes from in production** — Phase 18 (discovery). Phase 12
  takes it as a parameter; the callers assemble it from what they already know.
- **Naming a degraded sovereign result "owner-attested"** — Phase 19 (VER-08/09/10).
- **Tree-reduce** — Phase 16.
</deferred>

<risks>
## Risks — flagged, not resolved

**1. DATA-07's criterion may not be measurable in this phase.** ROADMAP criterion 3 wants
pushdown observed by "comparing egress size to the raw input size" — but the egress
manifest is Phase 13 and the reduce tree is Phase 16. Phase 12 depends only on Phase 11.

Suggested resolution for the planner: prove pushdown *without* the manifest, by asserting
that a sovereign shard's emitted partial is smaller than its input **and** that no
non-owner node ever requests the raw input CID. Both are observable at the task and
blockstore level today. If the planner concludes the criterion genuinely needs Phase 13,
say so and propose resequencing — do not quietly weaken the criterion to something that
can be ticked. A criterion that can only be reported as met is not a measurement.

**2. `submitJob`'s error model changes shape.** Replacing `not-enough-executors` with
per-shard degradation touches every existing caller and test of `submitJob`. Expect the
blast radius to exceed the four requirement IDs, and check `bin/bench.ts` in particular —
Phase 8's benchmark harness reports incomplete runs deliberately and must keep doing so.
</risks>
