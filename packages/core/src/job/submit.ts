/**
 * Job submission — MR-01, DATA-01, VER-06, DATA-03, DATA-04.
 *
 * A job is a module plus N shards. Each shard carries its own sovereignty label
 * and executes independently at the job's redundancy factor, and every shard's
 * inputs and outputs are content-addressed so an intermediate is cacheable,
 * dedupable, and recomputable from its CID alone. That last property is what
 * makes churn repair cheap in a later phase — a lost combine is "call the same
 * pure function somewhere else", with no state to migrate.
 *
 * Placement is decided by `sovereignty.ts`'s `planPlacement`/`eligibleNodes` —
 * the single, unit-verified place eligibility is decided. This module never
 * re-derives "who could run this"; it only narrows the executor pool to the
 * nodes the placement plan actually chose.
 *
 * ## Three rules inherited verbatim from the deleted `coordinator.ts`
 *
 * Plan 20-12 deleted that module — it was a second job implementation nothing called, and
 * WIRE-04's own wording makes a second entry point the failure mode. But it was also the
 * only written statement of three rules that are now **this** module's, and a rule whose
 * only statement lives in a deleted file is a rule about to be re-broken. So they are
 * moved rather than lost, in `coordinator.ts`'s own words:
 *
 * ### Liveness changes who computes a task and when, never what the answer is
 *
 * > A node vanishing costs an attempt. A node being slow costs a duplicate. Neither can
 * > change the bytes, because a result is a pure function of `(module, input, partition)`
 * > and is content-addressed. That is what lets this loop be aggressive: every recovery
 * > action it can take is, at worst, wasted work.
 *
 * ### Failure is a fact, silence is a deadline
 *
 * > The two are handled differently and it matters. A dispatch that reports failure is
 * > *observed* — the node refused, or its connection died — so the lease is surrendered
 * > immediately and the task moves on. Silence gets a deadline instead, because silence
 * > is indistinguishable from slowness and the only safe response to "I cannot tell" is
 * > to wait a bounded time. Conflating them would either waste a full lease on a node
 * > known to be gone, or declare a slow node dead on no evidence.
 *
 * > **The deadline is the lease, and it is enforced here rather than assumed.** An
 * > earlier version of that module stated the rule and then never checked `expiresAt`
 * > anywhere: once speculation became impossible the loop awaited the pending dispatch
 * > with no timer at all, so a peer that simply never answered hung the shard, and
 * > `Promise.all` hung the job. Nothing bounded it, because the transport timeout belongs
 * > to the transport and a caller may not have one.
 *
 * ### Disagreement must survive speculation
 *
 * > When a duplicate wins, the loser is *not* abandoned unexamined. That was the other
 * > thing that module got wrong: breaking out of the race on the first arrival meant a
 * > second copy's answer was never compared, so `disagreed` could not become true on any
 * > input — timing alone picked which of two different CIDs became the job's answer, and
 * > the run reported clean. That is majority-vote-by-race, the thing this project has
 * > explicitly refused.
 *
 * > The fix keeps speculation's whole point intact. Waiting for the loser would undo the
 * > latency saving — the loser is usually the straggler. So the winner returns
 * > immediately and the outstanding copies are compared **after every shard has
 * > settled**, which costs nothing because the job was going to wait for its slowest
 * > shard anyway. A copy that has still not answered by then is reported as uncompared
 * > rather than as agreeing; you cannot compare an answer that never arrived, and saying
 * > "no disagreement" about it would be a claim nobody checked.
 *
 * All three are implemented below — the surrender-on-failure and sleep-to-the-deadline
 * arms in `dispatchUnderLease`, and the post-settle comparison in `compareOutstanding` —
 * and each is planted against in `submit.test.ts`.
 *
 * ## A shard gets more than one generation — WIRE-04, CHURN-01, CHURN-04
 *
 * Until Phase 20 this module called `executeVerified` **exactly once per shard**. A
 * node that answered the offer while free and then refused the dispatch, or died
 * between the two, ended that shard and nothing tried anyone else. It now runs a
 * *generation loop*: place, grant a lease, dispatch, and — where the outcome fell
 * short — place again over the same eligibility gate with every already-attempted
 * node removed.
 *
 * **Two triggers, not one.** `executeVerified` returns `insufficient` only when
 * *every* executor failed. At redundancy 2 with one executor dead it returns `agreed`
 * with `replicas: 1` — a shard that silently got less redundancy than it asked for.
 * Both are re-dispatch triggers, and treating only `insufficient` as one is the
 * version of this that looks finished and leaves the more common case unrepaired.
 *
 * **The bound is distinct nodes, not failure kinds.** `Executor` flattens every
 * failure to `{nodeId, reason}` — `verify.ts`'s header says the flattening is
 * deliberate — so this module has no `node`/`task` distinction to police and does
 * **not** parse reason strings for policy. It counts distinct nodes instead, capped by
 * `DEFAULT_MAX_GENERATIONS`, whose docblock argues exactly this: *"A task that has
 * failed on three independently-chosen nodes is far more likely to be a bad task than
 * three unlucky nodes."* **What that costs**, stated rather than left to be found: a
 * shard whose module traps burns up to three nodes instead of being given up on after
 * the first classified task failure. That is a liveness cost bounded by 3, and it is
 * the honest price of not string-matching. The sharp distinction, if a later phase
 * wants it, is a failure kind on `ExecutionOutcome` — a new decision, not a widening
 * of this one.
 *
 * **The lease is what makes the retry bounded and legible rather than a loop with a
 * counter.** Every grant, renewal, expiry, surrender and abandonment is an event on
 * {@link JobResult.leaseHistory}; `lease.ts`'s own header gives the reason — *"A
 * scheduler that quietly retried would produce correct answers and inexplicable
 * bills."*
 *
 * ## A straggler is duplicated, and the loser is still read — CHURN-02, CHURN-06
 *
 * A job finishes when its *slowest* shard finishes, so one node on a train ruins a
 * thousand-node job. When a shard has been running far longer than its peers, a second
 * copy is dispatched to another eligible node while the first is still running, and the
 * first answer to arrive is the shard's answer. `speculation.ts` carries the pieces —
 * the median, the budget, the eligibility gate — and this is their first production
 * caller.
 *
 * **Three things `coordinator.ts` got wrong before it got them right.** That module is
 * deleted in a later plan, so its reasoning is reproduced here rather than referenced,
 * and quoted where its own sentence is the clearest statement of the rule:
 *
 * 1. **Breaking out of the race on the first arrival made `disagreed` impossible on any
 *    input.** Timing alone picked which of two different CIDs became the answer and the
 *    run reported clean — *"majority-vote-by-race, the thing this project has explicitly
 *    refused"*. So the winner returns immediately and the copies still outstanding are
 *    **registered, never cancelled**, then compared after **every** shard has settled.
 *    That costs nothing, because the job was going to wait for its slowest shard anyway.
 *    A copy that still has not answered by then is reported **uncompared**: you cannot
 *    compare an answer that never arrived, and calling it agreement would be a claim
 *    nobody checked.
 * 2. **A flag that stopped speculating was allowed to stop the timer**, leaving the loop
 *    awaiting a promise that might never settle. The watchdog is therefore
 *    *unconditional*: `watching` decides only whether a tick may **speculate**, never
 *    whether there is a deadline. Termination is the lease deadline's job and only its
 *    job.
 * 3. **Wrapping each dispatch into its raced form inside the loop** allocated a fresh
 *    closure and promise per iteration — an out-of-memory crash rather than a slow test,
 *    and only when a real dispatch is slower than the watchdog, which is exactly when
 *    speculation is working. Each {@link Copy} is therefore built **once**, at dispatch.
 *
 * **Speculation is adaptive, not a fixed timeout.** A shard is a straggler relative to
 * its *peers*, so the threshold is the median of what has already finished. Early in a
 * job nothing has finished and nothing is duplicated — correctly, since there is no tail
 * yet — which is why the loop polls rather than sleeping once for a precomputed instant:
 * the threshold it checks against does not exist when the shard starts. "Too new to
 * judge" is the one reason to do nothing that must **not** stop the watching, because the
 * median moves and elapsed time grows.
 *
 * **Speculation is not redundancy and the two must not be confused.** Redundancy is N
 * executors compared for agreement; speculation is one extra copy of an already-placed
 * shard because it is slow. A job at redundancy 2 whose straggler is duplicated has
 * **three dispatches and two replicas**.
 *
 * **CHURN-06 is a property of construction.** The duplicate's candidates come from
 * `speculativeCandidates`, which routes through the same `eligibleNodes` gate every
 * placer calls, so a sovereign shard's copy lands on its owner's own nodes or the shard
 * is **not duplicated at all** — and where the owner has no spare node, waiting is the
 * correct move rather than a failure.
 *
 * **A dispatch that answers nothing is bounded by its lease, and that is a behaviour
 * change with a cost.** Before this, `submitJob` awaited `executeVerified` forever. It
 * now stops waiting at `DEFAULT_LEASE_MS` and moves the shard, so a *genuinely slow*
 * workload — every replica taking longer than a lease — is now re-dispatched and, after
 * three generations, abandoned, where before it would eventually have completed. That
 * is CHURN-04's deadline doing what it is for (`lease.ts`: *"the only safe response to
 * 'I cannot tell' is to wait a bounded time"*), and `DEFAULT_LEASE_MS` is the dial. The
 * escape from it is evidence, not a longer timer — see {@link JobSpec.admit}.
 *
 * ## The aggregate carries its denominator — CHURN-05
 *
 * A job over ten owners that reached eight of them computed a *different number* from the
 * one it was asked for, and nothing about the number itself says so. `coverage.ts` exists
 * to stop the first being presented as the second, and until Phase 20 it had **zero**
 * production callers. Every job now reports how many of its owners contributed, beside
 * its result rather than instead of it — see {@link JobResult.coverage}.
 *
 * **The owner set is derived from the job's own shards and there is no `JobSpec` field
 * for it.** A shard is defined for an owner whether or not that owner's nodes are up, so
 * an owner whose every node is missing still has a shard, is still *expected*, and lands
 * in `CoverageReport.missing` by name. This is not a contradiction of the standing rule
 * that an optional field with a silent default is a hole — see {@link JobSpec.admit},
 * which is such a field and states its asymmetry. That rule governs *choices the caller
 * must state*; an owner set is a *fact already present in the caller's own input*, and a
 * required field for it would be a five-site fan-out buying nothing derivation does not.
 *
 * **What that derivation costs, measured rather than assumed.** It ties one direction of
 * coverage to completeness: an owner can only be expected by having a shard, and that
 * shard is inside {@link JobResult.complete}'s conjunction, so a `complete` job is always
 * fully covered. The converse fails — a fully covered job can be incomplete — and the two
 * remain separate fields for that reason and because the remedies differ. What would make
 * the missing direction reachable is a *declared* owner set (`runResilient`'s optional
 * `expectedOwners`), and declaring one is the thing this module refuses.
 *
 * ## The job outlives the requestor — CHURN-03
 *
 * The requestor is a browser tab, and tabs close. So the coordinator is arranged to be
 * the least important participant: as each shard settles, a small canonical block naming
 * every answered partition **by result CID** is written to the same blockstore everything
 * else goes to, and its handle is handed straight out through
 * {@link SubmitOptions.checkpoints}. A requestor holding that handle can hand it to
 * another requestor, which resumes by running {@link SubmitOptions.resumeFrom} — the
 * *same* `submitJob` call with a starting state, not a second entry point.
 *
 * **A checkpoint names results; it does not carry them.** `PROJECT.md`'s liveness
 * invariant is what makes that sound — a result is a pure function of
 * `(module, input, partition)` and is content-addressed — so a resume is a *lookup*, not
 * a re-send, and the checkpoint block's size is independent of how big the answers were.
 * `checkpoint.ts`'s own header states the consequence this module relies on: *"A task that
 * was in flight when the tab closed is simply outstanding, because its lease expired."*
 * There is nothing to release and nothing to reconcile.
 *
 * **The cadence is one write per shard that answers, and the alternatives are both worse.**
 * Once at the end is useless: a requestor that departed mid-job wrote nothing, which is the
 * only case this exists for. A write on a timer would decouple the record from the events
 * it records and would still lose an unbounded amount between ticks. So: N writes for N
 * answered shards, serialised through one chain so the `previous` links form a line rather
 * than a fork, each naming *everything* known at the instant it is composed. **What a crash
 * between two writes loses** is the shards that answered since the last published handle;
 * a resume re-runs them, which costs work and never correctness. What each write costs is
 * one canonical encode and one `blockstore.put` of a block whose size grows by one
 * `(index, cid)` pair per shard — arithmetic on a path that is otherwise pure, and the
 * reason the cadence is stated here rather than left to be discovered in a profile.
 *
 * **What a checkpoint cannot know, stated rather than left to be found.** It is written
 * when a shard settles, and {@link ShardResult.disagreed} — a *late* copy that hashed
 * differently — is only known after **every** shard has settled. So a published handle can
 * name a shard whose losing copy later disagreed. Two things bound it: that event already
 * fails {@link JobResult.complete} for the run that observed it, and a resumed job is
 * **never** `complete` anyway, because a carried shard got zero replicas from *this*
 * requestor and is therefore degraded. Nobody can read a resumed job as fully verified,
 * which is the honest reading: this requestor verified the shards it ran and took the rest
 * on a predecessor's word.
 *
 * **The scope line, held.** This is a record written and read back. There is no failover,
 * no leader election, no registry, and no agreement between two requestors about which of
 * them owns a job — that shape is shared mutable state requiring consensus, and
 * `19-CONTEXT.md`'s NO BLOCKCHAIN ruling refuses it. Two requestors resuming the same
 * checkpoint both finish the job and both get the same answers, because the answers are a
 * pure function of the inputs; they duplicate work and nothing else.
 *
 * Pure module: the blockstore and executors arrive as ports, and so do the clock and
 * the timer the lease deadline needs — see {@link SubmitOptions.clock}.
 */

import { CID } from 'multiformats/cid'
import { canonicalCid, decodeCanonical } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import { checkpointOf, recoverCheckpoint, readCheckpoint, writeCheckpoint } from '../checkpoint.ts'
import type { CheckpointFailure, CompletedShard, JobCheckpoint } from '../checkpoint.ts'
import { coverageOf } from '../coverage.ts'
import type { CoverageReport } from '../coverage.ts'
import type { NodeCertificate } from '../enrollment.ts'
import type { Sleep } from '../governor.ts'
import { DEFAULT_MAX_GENERATIONS, LeaseTable, RENEW_AT, checkLease, shouldRenew } from '../lease.ts'
import type { Lease, LeaseEvent } from '../lease.ts'
import type { NameRecord } from '../naming.ts'
import { planWithOffers } from '../placement.ts'
import type { AdmissionControl, Rejection } from '../placement.ts'
import type { Blockstore, Executor, Task } from '../ports.ts'
import { attestationRank, attestationReceipt, composeQuorum } from '../quorum.ts'
import type { AttestationReceipt, QuorumRefusal } from '../quorum.ts'
import { verifyResultAttestation } from '../result-attestation.ts'
import type { ResultWork } from '../result-attestation.ts'
import {
  DEFAULT_SPECULATION_FRACTION,
  DEFAULT_STRAGGLER_FACTOR,
  SpeculationLedger,
  speculativeCandidates,
  stragglers,
} from '../speculation.ts'
import { planPlacement } from '../sovereignty.ts'
import type { NodeDescriptor, OwnerId, Placement, PlacementRequest } from '../sovereignty.ts'
import {
  MIN_CEREMONY_REPLICAS,
  executeCommitReveal,
  isCommitting,
} from './commit-reveal.ts'
import type { CommittingExecutor } from './commit-reveal.ts'
import { executeVerified } from './verify.ts'
import type { AgreeingReplica, VerificationResult } from './verify.ts'

/** One shard's input, carrying the sovereignty label that constrains where it may run. */
export type ShardSpec =
  | { readonly value: CanonicalValue; readonly label: 'public' }
  | { readonly value: CanonicalValue; readonly label: 'sovereign'; readonly ownerId: OwnerId }

export interface JobSpec {
  readonly moduleCid: CID
  /**
   * The signed mapping that vouches for `moduleCid` (DET-03, DATA-08). Copied onto
   * every `Task` this job builds, sovereign and public alike.
   *
   * **Optional here, and deliberately unenforced here.** That is not convenience, and
   * the reason is worth stating because the project's standing rule is that an
   * optional field with a silent default is a hole. `submitJob` runs in the
   * *requestor's own process*. A requestor that omits the record is not attacking
   * anybody — it is about to have its job refused by every node it dispatches to.
   * Enforcing at this line would put the check on the side of the wire the attacker
   * sits on, which is precisely the mistake `guardSovereignty`'s docstring exists to
   * name: "a refusal can be made there rather than trusted to whoever dispatched the
   * task."
   *
   * The enforcement point is `guardModuleProvenance`
   * (`executor/module-provenance.ts`), composed unconditionally by every production
   * node. So omitting this is not harmless and it is not a silent downgrade: a job
   * submitted without a record fails at *every* node it reaches, each refusal naming
   * the missing signed record. Loud, and in the one place that can be trusted to say
   * it.
   */
  readonly moduleRecord?: NameRecord
  /** One shard per element. Length is the partition count. */
  readonly shards: readonly ShardSpec[]
  /**
   * Executors available to run shards. Which ones a given shard actually uses is
   * decided by placement (below), not by this list's order.
   */
  readonly executors: readonly Executor[]
  /**
   * Nodes placement may consider, correlated to `executors` by `nodeId`. Every
   * executor must have a matching descriptor — see `missing-node-descriptor`.
   */
  readonly nodes: readonly NodeDescriptor[]
  /**
   * Replicas requested per shard. 1 disables verification (VER-06). A shard
   * placed at fewer replicas than this is reported `degraded` rather than
   * failing the job — see `ShardResult.degraded`.
   */
  readonly redundancy: number
  /**
   * VER-03 / VER-04. What this caller wants when a public shard asked for
   * verification and the candidate set cannot compose a valid quorum.
   *
   * **Two named choices, and neither of them is "off".** A caller that does not much
   * care still writes one down, which is the whole reason this is required rather
   * than optional with a default — see the last section below.
   *
   * ## `'runs-at-available-redundancy'` — what degrading actually does
   *
   * The shard runs at whatever redundancy the eligible set yields, it is reported
   * `degraded` on its `ShardResult`, and its receipt reports the weaker attestation
   * strength. **The job does not fail.** A caller on this arm gets an answer plus an
   * accurate statement of how well it was checked.
   *
   * ## Why that is the default answer to an uncomposable quorum
   *
   * Phase 12 retired `not-enough-executors` precisely to stop a shard below its
   * requested redundancy from failing a whole job: it is placed at what is available
   * and marked degraded instead. A candidate set too concentrated to verify is the
   * same condition one step further out — and it is a condition the *caller does not
   * control*. Turning it into a refusal would put a refusal in front of the thing it
   * is about, which is the shape the retracted anchor rule had.
   *
   * ## Why degrading here is not silent
   *
   * Criterion 1's load-bearing word is *silently*, not *accepted*.
   * `classifyAttestation` labels a one-operator quorum `owner-attested`, and a
   * multi-certificate one-operator quorum `owner-domain`, rather than `independent` —
   * so the weaker outcome is named by construction, and `degraded` says so a second
   * time on the shard. Nothing about this arm hides anything; it reports a weaker
   * result as weaker.
   *
   * ## When to ask for `'refuses-the-shard'`
   *
   * Only when a weaker answer is worse to this caller than no answer at all — a
   * caller that genuinely requires independent verification and would rather have
   * nothing than something it cannot show to a third party. A caller that would go on
   * to use a degraded result anyway and asks for refusal has chosen to fail jobs it
   * would have accepted.
   *
   * ## Where this field is read, and what it decides
   *
   * **On the `degraded` / `refusal` pair of this file's shard result, and nowhere else** —
   * confirmed by grep, which finds exactly three occurrences of the name: this declaration
   * and those two. (Cited by symbol rather than by line: this paragraph gave `:802-803`
   * when its own +14-line edit had already moved the readers to `:816-817`, and a later
   * commit moved them again. A line number is an absolute reference to a file that keeps
   * changing; a symbol is not.) They
   * sit on the arm reached only when composition was *attempted and refused*, so the
   * dial is consulted where there is a shortfall and never where no quorum was asked
   * for. `'runs-at-available-redundancy'` sets `degraded: true` and leaves `refusal`
   * null, so the shard is placed on the full eligible pool and reports the weaker
   * outcome; `'refuses-the-shard'` carries the composer's own `reason` into `refusal`,
   * and the shard comes back `insufficient` with that same sentence. Both arms are read
   * off one live fixture in `packages/node/src/quorum-agents.node.test.ts`, which
   * asserts the two strings **equal** rather than merely both present.
   *
   * **It was scheduled, and it arrived.** This paragraph read *"Nothing reads this field
   * yet"* from wave 3, when 19-18 landed the field, until wave 4, when 19-06 landed the
   * reader 670 lines below — and it was not updated, which `19-VERIFICATION.md` filed as
   * W1. The argument it made was correct and is kept rather than deleted: a type landing
   * one wave ahead of the code that reads it is this phase's established shape, and
   * Plans 19-13 and 19-14 did the same. What was missing is the other end of it. A
   * scheduled arrival has to be recorded when it arrives, or the note that made it
   * legible becomes the thing that misleads.
   *
   * ## Required rather than optional, and the reason is measured
   *
   * `.planning/PROJECT.md`'s Key Decision **"An optional hook with a silent default is
   * a hole"**, and here the hole has a specific shape this phase has already fallen
   * into twice. Plans 19-01 and 19-13 each made a field optional and omitted it, and
   * each observed **`tsc --noEmit` exit 0 while the behavioural assertion failed**. An
   * optional strictness field would let every existing call site mean *degrade*
   * without ever having said so — a whole tree of callers holding a position none of
   * them stated. Note also that this belongs on `JobSpec` and not on `SubmitOptions`:
   * that object is optional *as a whole*, so a required property inside it would still
   * be omittable by omitting the object, which is the same defect one level down.
   */
  readonly onQuorumShortfall: 'runs-at-available-redundancy' | 'refuses-the-shard'
  /**
   * Consulted before a shard is placed on a node — SCHED-02, SCHED-03.
   *
   * **Present** means every shard is placed by `planWithOffers`: sample `d`
   * candidates by rendezvous rank, take the least-loaded of the sample, offer, and
   * re-pick on refusal, bounded across the shards of this job by what each node
   * published about its own room. **Absent** means `planPlacement` as before — order
   * every eligible node by load and take the best.
   *
   * ## Criterion 5 holds on both arms, and is not what chooses between them
   *
   * `placeWithOffers` calls `eligibleNodes` as its first act (`placement.ts:230`) and
   * `planPlacement` calls the same function first (`sovereignty.ts:169`). That
   * function is exported *"so that there is exactly one of it"*
   * (`sovereignty.ts:124-128`). So sovereignty is filtered before cost is scored on
   * both arms, because on both arms it is filtered by the same line — and a reader
   * looking for the arm that is "the safe one" will not find it, because neither is.
   *
   * ## They are alternatives, and are never composed
   *
   * `planPlacement` returns `ordered.slice(0, redundancy)` (`sovereignty.ts:185`), so
   * feeding its output into `placeWithOffers` would hand the offer loop a pool already
   * narrowed to exactly the nodes it chose — leaving **nothing to re-pick onto**,
   * which is the one behaviour the offer arm exists to have. It would also score cost
   * twice. This is written down because "compose them" is the obvious next idea and it
   * silently removes the re-pick.
   *
   * **The generation loop did not break this, and that is worth stating rather than
   * assuming.** Each generation runs *one* placer over a *narrowed candidate list* —
   * the same arm it ran the first time, chosen by this same field — and never one
   * placer over the other's output. A shard placed by `planPlacement` is re-placed by
   * `planPlacement`; a shard placed by `planWithOffers` is re-placed by
   * `planWithOffers`. Narrowing a placer's input can only shrink an already-eligible
   * set; composing two placers would have removed the re-pick, which is the thing the
   * paragraph above forbids.
   *
   * ## Lease renewal, and why it is asymmetric on this field — CHURN-04
   *
   * A dispatch still outstanding when `shouldRenew` is true has its lease renewed
   * **iff the holder itself says the task is still in flight**. This field is how a
   * requestor asks a node anything, so it is the whole evidence channel and there is
   * deliberately no second hook beside it.
   *
   * *The evidence, and it needs no protocol change.* `serveAgent`'s `exec` branch keys
   * its capacity slot on `` `${task.inputCid}:${task.partitionIndex}` `` (`net/src/agent.ts`,
   * search `const slotKey`), and `LocalCapacity` refuses a second claim on a held key
   * with `` `${offer.shardId} is already in flight here` `` (`placement.ts`, search
   * `is already in flight here`). So a requestor that offers the **same slot key** to
   * the node currently holding the lease and is refused *as a duplicate* has positive
   * evidence that node is still running that exact task. Any other answer — accepted,
   * over-committed, unreachable, or a throw — is not evidence, and the lease is left to
   * lapse.
   *
   * *An unconditional renew is forbidden.* A renewal granted on a timer alone is a
   * longer timeout wearing a lease's clothes: it makes the bound unbounded, and
   * presenting it as CHURN-04 would be dishonest. The rule is therefore stated as a
   * *biconditional* — renewed only against evidence — and the difference between the
   * two is measurable, which is the point: `submit.test.ts`'s renewal pair runs one
   * fixture with the holder present and with the holder gone, and requires the two to
   * differ in the lease **history**, not merely in the outcome.
   *
   * *The asymmetry.* Where this field is **absent** there is no probe, so there is no
   * evidence a requestor could obtain, so nothing is renewed and the lease lapses on
   * time. That is a stated behaviour and not a default: a caller that supplies no way
   * to ask a node anything has, by that choice, no way to learn that a silent node is
   * merely slow. Read the module header for what a lapse costs a genuinely slow job.
   *
   * ## Why optional here is not a hole
   *
   * In the terms `moduleRecord`'s doc above already uses on this same interface:
   * `submitJob` runs in the **requestor's own process**. A requestor that omits this
   * is not attacking anybody — it places without probing, which is what every caller
   * in this repository did before this phase. The bound that binds a *peer* is the
   * serving node's own `LocalCapacity` on `serveAgent`'s `exec` branch, which is
   * unconditional, authoritative, and unaffected by anything a requestor supplies or
   * omits. The absence is also *asserted* rather than reached by omission — see
   * *"a caller that made no offers gets an empty refusal list"* in `submit.test.ts`.
   *
   * ## The limit, in one sentence
   *
   * A requestor that supplies this bounds **itself**; a dishonest one still
   * over-commits and is refused for real at `exec`.
   */
  readonly admit?: AdmissionControl
}

/**
 * The named statement that this requestor holds no verified signed statement about
 * who produced a result — VER-08, VER-09, VER-10.
 *
 * **A statement, never a default.** It says something specific and true: *this
 * requestor cannot account, from signatures it checked, for who ran this shard.* That
 * is a fact about the requestor's own knowledge, not about the nodes — every node in
 * this fabric has equal functionality, and a node reporting `'signed-by-nobody'` is an
 * ordinary node whose executor holds no identity. Reading it as a weak strength would
 * be the conflation this whole phase exists to end, one level down: `owner-attested`
 * over one verified replica of three *sounds stronger* than the truth, which is that
 * two of them are unaccounted for.
 *
 * **It carries its counts because the label alone cannot be acted on.** `agreeing` is
 * how many replicas matched, `verified` how many of those produced a signature that
 * checked out. `0 of 2` and `1 of 2` are different situations with different remedies,
 * and a bare literal would make them the same word.
 */
export interface NoVerifiedAttestation {
  readonly kind: 'holds-no-verified-attestation'
  /** Why, in this module's own words, naming each replica that was not counted. */
  readonly reason: string
  /** Replicas whose outputs matched. `0` when the shard never agreed. */
  readonly agreeing: number
  /** Of those, how many carried a signature over this result that this requestor checked. */
  readonly verified: number
}

/**
 * What a result is attested by, or the named statement that nothing was.
 *
 * **Derived from checked signatures, never declared.** `quorum.ts`'s own doc gives the
 * reason: *a caller that could declare a result independently verified would eventually
 * declare one that was not.* So the receipt arm here is built by
 * `attestationReceipt(...)` over certificates whose holders' signatures over **this
 * task and this output** verified, and there is no path by which a caller supplies one.
 *
 * **It reads the AGREEING set, not the placed set.** A node that was placed and then
 * failed attested nothing, and counting it would report redundancy the result does not
 * have.
 *
 * **What a signature does not say.** It says a certified node computed this output. It
 * says nothing about whether the output is *correct* — correctness is `executeVerified`'s
 * N-version comparison, and a signature on a wrong answer is a signed wrong answer,
 * signed just as convincingly as a right one. Somebody will read "results are signed
 * now" and propose reducing redundancy; attribution tells you whom to stop trusting
 * *after* you know the answer was wrong, and the only thing here that tells you it was
 * wrong is a second independent execution.
 *
 * **This is the map half's receipt and it is NOT the aggregate's.** `submitJob` does not
 * reduce; `reduceJob` is a separate entry point whose aggregation carries its own claim,
 * verified from combine signatures. The two are not one restated — `PROJECT.md`'s split
 * means a sovereign map is `owner-attested` by construction while the aggregation over
 * it can be redundant, so they routinely differ. `reduce.ts`'s own header already writes
 * that split down. Do not unify them.
 */
export type ShardAttestation = AttestationReceipt | NoVerifiedAttestation

/**
 * What the verification quorum came to for one shard — VER-03, VER-04.
 *
 * Three arms, because *why no quorum was attempted* is as much a fact about a result as
 * a refusal is, and a caller told only "not composed" could not tell a sovereign shard
 * from an over-concentrated candidate set.
 *
 * **A composed quorum does not pre-declare a strength, and this is worth its own line.**
 * `operators` here are the operators that were **asked**; {@link ShardAttestation}
 * reports who **answered and signed**. A quorum of two operators whose second member
 * returned nothing verifiable reads the named absence, not `independent` — that is the
 * correct answer rather than a defect in this gate, and reading a strength off
 * `QuorumResult.strength` instead would be the exact conflation this phase exists to end.
 */
export type ShardQuorum =
  /** Composed. These are the operators whose nodes were asked, and the pool placement got. */
  | { readonly kind: 'composed'; readonly operators: readonly string[] }
  /**
   * Attempted and refused, in the composer's own words.
   *
   * Carried onto the shard rather than dropped, because **degrading is defensible only
   * because it is not silent** — a caller that can read `insufficient-operators` or
   * `shared-relay-dependency` can tell an over-concentrated fabric from any other
   * degradation, and one that cannot, cannot.
   */
  | { readonly kind: 'not-composed'; readonly refusal: QuorumRefusal; readonly reason: string }
  /** No quorum was attempted. One of the gate's three conditions did not hold, and this says which. */
  | { readonly kind: 'not-attempted'; readonly reason: string }

/**
 * One sentence for a {@link ShardQuorum}, in the composer's own words — VER-03, VER-04.
 *
 * The same arrangement `describeAttestation` has and for the same reason: two formatters of
 * one value are two things that can come to describe one result differently. Every surface
 * that shows a quorum verdict — `bin/bench.ts`, the demo page — renders this string and
 * composes none of its own.
 *
 * **The refusal kind is emitted verbatim and that is the load-bearing part.**
 * {@link ShardQuorum}'s own docblock says a caller that can read `insufficient-operators`
 * or `shared-relay-dependency` can tell an over-concentrated fabric from any other
 * degradation, and one that cannot, cannot. A sentence that rendered only `reason` would
 * be prose a reader has to parse; the kind is a fixed string a *test* can assert on, which is
 * what makes "the fabric refused this quorum for shared reachability" a checkable claim
 * rather than a phrase that happens to appear.
 *
 * **What this must never be derived from.** Not `redundancy`, not `agreeing.length`, and
 * emphatically not `AttestationReceipt.sharedRelay` — that field is computed from the
 * certificates of whoever answered and signed, so it reads identically on a fabric where
 * this gate never ran. Only the composer knows what the composer decided.
 */
export function describeQuorum(quorum: ShardQuorum): string {
  switch (quorum.kind) {
    case 'composed':
      return (
        `composed across ${quorum.operators.length} ` +
        `${quorum.operators.length === 1 ? 'operator' : 'operators'} ` +
        `(${quorum.operators.join(', ')}) — no two members share an operator`
      )
    case 'not-composed':
      return `not composed [${quorum.refusal.kind}] — ${quorum.reason}`
    case 'not-attempted':
      return `not attempted — ${quorum.reason}`
  }
}

/** One shard's quorum decision, and what placement is handed because of it. */
interface ShardGate {
  readonly quorum: ShardQuorum
  /** The pool placement receives — the quorum's members, or the full candidate set. */
  readonly pool: readonly NodeDescriptor[]
  /** True when this shard runs but did not get the independence it asked for. */
  readonly degraded: boolean
  /** The composer's reason, when the caller asked for refusal rather than a weaker answer. */
  readonly refusal: string | null
}

/**
 * How often a running dispatch is re-examined for having become a straggler — CHURN-02.
 *
 * Also the floor on how quickly one can be spotted, and the default width of the window
 * a losing copy gets to answer in once the job has settled. 250 ms is
 * `coordinator.ts`'s own figure, transcribed rather than imported because that module is
 * deleted in a later plan.
 *
 * **A poll and not a precomputed deadline**, because the threshold a shard is judged
 * against is the median of what has already *finished* — a quantity that does not exist
 * when the shard starts and that moves while it runs.
 */
export const DEFAULT_SPECULATION_WATCHDOG_MS = 250

/**
 * What became of a speculative copy once the job had settled — CHURN-02, VER-01.
 *
 * **One list per shard rather than one map per outcome**, and the reason is
 * `coordinator.ts`'s recorded hole: a copy that answered *with a failure* is neither
 * silent nor disagreeing, and every reader had to remember to consult a third structure
 * that did not exist. The `'agreed'` arm carries nothing and exists purely so the
 * enumeration is exhaustive — *"which turns a fifth outcome invented later into a
 * compile error rather than a silent omission."*
 *
 * A copy is any dispatch of a shard that was still outstanding when another one won, so
 * the *placed* dispatch appears here too when a duplicate beat it. Speculation makes the
 * two symmetric on purpose: once a second copy is running, which of them is "the
 * original" is a fact about scheduling and not about the answer.
 */
export type SpeculativeCopy =
  /** It answered, and its result was the winner's result. Nothing more to say. */
  | { readonly nodeIds: readonly string[]; readonly outcome: 'agreed' }
  /**
   * It answered with a **different** result — reported, never resolved.
   *
   * Two copies of a deterministic function over content-addressed inputs must agree;
   * that they did not is a determinism failure or a dishonest node, and it is the most
   * informative event this system can observe. The differing CID travels with it so the
   * shard names *both* answers rather than only asserting that they differed.
   */
  | { readonly nodeIds: readonly string[]; readonly outcome: 'disagreed'; readonly resultCid: string }
  /** It answered, and what it said was that it failed. Its own bucket for that reason. */
  | { readonly nodeIds: readonly string[]; readonly outcome: 'failed'; readonly reason: string }
  /**
   * Its answer was not compared, and `reason` says why.
   *
   * Deliberately distinct from `'agreed'`. Either it had not answered when the window
   * closed, or the shard reached no single agreed result for it to be compared against —
   * both are "nobody checked this", and folding either into agreement would assert
   * something nobody checked.
   */
  | { readonly nodeIds: readonly string[]; readonly outcome: 'uncompared'; readonly reason: string }

/**
 * Why a shard's generation loop stopped — WIRE-04, CHURN-01.
 *
 * Three of these are the loop's only exits and the fourth is a shard that never entered
 * it. They are a **named value rather than something a reader infers** because the
 * three endings are otherwise distinguishable only by cross-referencing a verification
 * status against a lease history, and a caller asking "did this stop because it
 * succeeded, because it ran out of nodes, or because it ran out of tries?" is asking
 * one question, not three.
 *
 * `'disagreed'` is an ending and **not** a re-dispatch trigger. Disagreement is the one
 * event this whole verification mechanism exists to surface (`verify.ts`: *"Disagreement
 * is surfaced, never majority-voted away"*), and re-running a shard until the replicas
 * happen to agree would be majority-vote-by-attrition.
 */
export type ShardEnding =
  /** It agreed at the redundancy it asked for. */
  | 'agreed'
  /** Replicas produced different results. Retrying would hide the event, so it does not. */
  | 'disagreed'
  /** Placement had nobody left it had not already attempted. */
  | 'no-untried-node'
  /** The lease table refused a further grant: `DEFAULT_MAX_GENERATIONS` is spent. */
  | 'generations-spent'
  /** The first placement never placed it, so no generation ever ran. */
  | 'never-placed'
  /**
   * A checkpoint already named this shard's answer, so this requestor never ran it —
   * CHURN-03.
   *
   * **The one ending that is not an outcome of the generation loop**, and it is a
   * *value* rather than something a reader infers from `generations: 0` plus an empty
   * `attempted`, because `'never-placed'` reads exactly the same way and means the
   * opposite: nobody would take it, versus somebody already did it. The shard's
   * {@link ShardResult.verification} is `agreed` at `replicas: 0` — this requestor
   * obtained no replica of its own — which is also why such a shard is
   * {@link ShardResult.degraded} and why a resumed job is never
   * {@link JobResult.complete}.
   */
  | 'carried-from-checkpoint'

export interface ShardResult {
  readonly partitionIndex: number
  readonly inputCid: CID
  readonly verification: VerificationResult
  /**
   * Every node this shard was dispatched to, in order, across every generation —
   * CHURN-01's *"visible in the job history rather than hidden"*, per shard.
   *
   * **The set ASKED, never the set that answered.** {@link VerificationResult} reports
   * who agreed; this reports who was tried, and the difference between the two is the
   * whole record of a re-dispatch. It is also the reading that catches a widened
   * eligibility gate: a reason string stays plausible while a sovereign shard lands on
   * a foreign node, and a node id in this list does not.
   *
   * A node appears at most once: every generation places over a candidate list with
   * every already-attempted node removed, because placement is deterministic and a
   * re-dispatch handed the same pool would pick the node that just failed, every time.
   * A speculative duplicate is a dispatch and appears here too, appended at the instant
   * it was started — which is also what keeps a later generation from re-placing onto it.
   */
  readonly attempted: readonly string[]
  /**
   * True when a speculative duplicate was started for this shard — CHURN-02.
   *
   * `false` is the ordinary reading and covers three different situations that a caller
   * usually does not need to distinguish: nothing was slow enough, the job-wide budget
   * was gone, or there was nowhere legal to duplicate to. {@link ShardResult.copies} and
   * {@link JobResult.speculationSpent} are where the difference is visible.
   */
  readonly speculated: boolean
  /**
   * True when a copy of this shard produced a **different** result from the winner.
   *
   * **This is the LATE half of disagreement and not the whole of it.** The in-generation
   * half is `verification.status === 'disagreed'` — replicas of one dispatch that did not
   * match. A caller asking "did this shard disagree?" has to read both, which is why
   * {@link JobResult.complete} does. They are separate fields because they are separate
   * events: one is N replicas compared inside a dispatch, the other is two whole copies
   * of the shard compared against each other after the job settled.
   *
   * Reported, never resolved. First-result-wins picks the winner; the disagreement
   * travels alongside it.
   */
  readonly disagreed: boolean
  /**
   * Every copy of this shard that was still outstanding when another one won, and what
   * became of it. See {@link SpeculativeCopy}.
   *
   * `[]` on every shard of every job that speculated nothing, which is most of them —
   * and it is a truthful reading rather than a default: no second copy was started, so
   * none was left over to compare.
   */
  readonly copies: readonly SpeculativeCopy[]
  /**
   * Dispatch generations this shard used. `1` is a shard that never had to retry, `0`
   * a shard that was never placed.
   *
   * Bounded by `DEFAULT_MAX_GENERATIONS` through the lease table, which is what makes
   * `generations - 1` the shard's own re-dispatch count and `JobResult.redispatches`
   * the sum of them.
   */
  readonly generations: number
  /** Why the generation loop stopped. See {@link ShardEnding}. */
  readonly ending: ShardEnding
  /**
   * True when this shard did not get everything it asked for — in **redundancy**, or in
   * **independence**.
   *
   * It covered only the first until Plan 19-06, when it read *"achieved redundancy is
   * below `JobSpec.redundancy`"*. **A quorum shortfall can occur at full redundancy** —
   * two nodes of one operator are two replicas and no quorum — so the narrower reading
   * would have been `false` on a shard that failed to get the verification it asked for,
   * and a caller filtering on this field would have accepted that shard silently. The
   * alternative, considered and rejected: leave this field alone and rely on the receipt.
   * It loses on both counts — the owner ruling says such a shard is *marked degraded*,
   * and a caller filtering on `degraded` is precisely who must not be told nothing.
   *
   * **The receipt says which of the two happened**, and the two are different tests:
   * `degraded` compares what was **asked for** against what was achieved, while
   * {@link ShardResult.attestation} reports what was **established**. A shard can be
   * undegraded and still `owner-domain` — full redundancy across one owner's own nodes is
   * exactly that — so neither field can be inferred from the other. This field also used
   * to say in prose that a degraded shard which agreed *"is owner-attested, not
   * independently confirmed"*; the receipt now says so as a value, so the prose is gone
   * rather than kept beside it. {@link ShardResult.quorum} carries the composer's own
   * words when the shortfall was a quorum's.
   *
   * **The redundancy half is now read off the replicas that ANSWERED, not off the
   * placement.** It was `placement.degraded` — `chosen.length < redundancy` — until
   * Phase 20, and that was measurably the wrong test: a shard placed on two nodes one of
   * which then failed came back `agreed` with `replicas: 1` and `degraded: false`, so a
   * caller filtering on this field accepted a shard that got half the verification it
   * asked for. That is the same silent under-replication the generation loop tops up,
   * and reporting it correctly is what makes the top-up's success visible — a topped-up
   * shard reaches full redundancy across two generations and is *not* degraded, which no
   * placement-shaped test could express.
   *
   * See `sovereignty.ts`'s `Placement.degraded` for why this is reported rather than
   * silently tolerated.
   */
  readonly degraded: boolean
  /**
   * What the verification quorum came to for this shard — VER-03, VER-04.
   *
   * Present on every shard, including those no quorum was attempted for. See
   * {@link ShardQuorum}.
   */
  readonly quorum: ShardQuorum
  /**
   * How strongly this shard's result is attested, or the named absence.
   *
   * See {@link ShardAttestation}. Required rather than optional: an omitted receipt read
   * as "attested" would make an unsigned result indistinguishable from a signed one at
   * the exact point the distinction is the product.
   */
  readonly attestation: ShardAttestation
  /**
   * The refusals collected on the way to placing this shard, in order, each in the
   * refusing node's own words — SCHED-03.
   *
   * `[]` for a caller that supplied no `JobSpec.admit`, and that is a **truthful
   * answer rather than a default**: no offer was made, so nothing refused. It is also
   * `[]` for a shard held back by the cross-shard headroom bound, for the same reason
   * — a node held back was never asked, so it never refused (`placement.ts`'s
   * `planWithOffers` composes that reason on the placement, never on a `Rejection`).
   *
   * Populated on the placed and unplaceable arms alike: a shard nobody would take is
   * the case where knowing *why* matters most.
   */
  readonly rejections: readonly Rejection[]
}

/**
 * How much of a job's owner set actually contributed — CHURN-05.
 *
 * **A named union rather than a bare {@link CoverageReport}**, and this is the decision
 * most likely to be undone by somebody tidying. `coverageOf` treats an empty owner set as
 * **not** complete — its own words, *"An empty job is not a complete one — '0 of 0 owners'
 * answers nothing"* — so a bare report on a public job renders `covered: 0/0 owners —
 * PARTIAL (no owners were expected)`. That is a correct answer to a question the job was
 * never entered for, and it would print on every benchmark rung in this repository. So a
 * job with no sovereign shard says what it is *by name*, the same shape as
 * `'keeps-no-ledger'`, `'signs-nothing'` and `'carries-no-certificate'`, and a reader has
 * to have handled that arm before it can reach `describeCoverage` at all.
 */
export type JobCoverage = CoverageReport | 'defines-no-owners'

/**
 * Did this shard put its owner's data into the aggregate? — CHURN-05.
 *
 * **`agreed`, and no copy of it that disagreed.** An `insufficient` shard produced
 * nothing, a `disagreed` one produced two different things and `verify.ts` refuses to pick
 * between them, and an unplaceable one never ran. The second clause carries 20-07's rule
 * one level out: a shard whose losing copy hashed differently is a failed run and not a
 * run with a footnote, so its owner's bytes are not in an aggregate anybody should read.
 * {@link ShardResult.disagreed} post-dates the sentence in `verify.ts` that this
 * predicate otherwise transcribes, so the clause is written here rather than left implied.
 *
 * **`degraded` deliberately does NOT disqualify**, and the reason is written down because
 * an unstated answer here would read as an oversight. A shard that agreed at one replica
 * instead of two *did* read its owner's data and produce a result over it — the owner
 * contributed. What is weaker is the **verification**, which is a different question with
 * a different remedy (ask for more replicas, versus go and find the owner's node), and
 * {@link ShardResult.degraded}, {@link ShardResult.attestation} and
 * {@link JobResult.complete} each already report it. Folding it in would make `2/3`
 * ambiguous between *an owner is absent* and *an owner's shard got half the redundancy it
 * asked for* — the same collapse of two questions into one number that `coverage.ts`
 * exists to prevent, running the other way. It would also contradict `PROJECT.md`'s own
 * split: sovereign data is **owner-attested** rather than redundantly executed, so
 * requiring full redundancy before an owner counts would demand a guarantee this project
 * does not claim, on exactly the shards coverage is computed over.
 */
function landedForItsOwner(shard: ShardResult): boolean {
  return shard.verification.status === 'agreed' && !shard.disagreed
}

export interface JobResult {
  readonly moduleCid: CID
  readonly shards: readonly ShardResult[]
  /**
   * The **weakest** of this job's shard receipts, or the named absence if any shard
   * carries one.
   *
   * A job is no stronger than its weakest shard: a caller shown `independent` for a job
   * one of whose shards ran once would be told the stronger guarantee on the strength of
   * the weaker one. The comparison goes through `attestationRank` rather than through a
   * remembered string order, which is what that function exists for.
   */
  readonly attestation: ShardAttestation
  /**
   * True only if every shard reached `agreed` at its full requested redundancy, with no
   * copy of it disagreeing.
   *
   * The last clause arrived with speculation. **A disagreement is a failed run, not a run
   * with a footnote** — the same rule `executeVerified` and `executeReduce` already
   * apply — so a job whose winner and whose late copy hashed differently is not complete,
   * however well every individual dispatch went.
   */
  readonly complete: boolean
  /** Node-seconds spent including redundant work. */
  /**
   * Fuel spent including redundant work — **not seconds**.
   *
   * Fuel is bytes moved across the guest ABI (see `WasmExecutor`), chosen because it
   * is deterministic where wall time is not. These fields were once called
   * `grossNodeSeconds`/`usefulNodeSeconds`, which named a unit they never carried; a
   * benchmark publishing them as seconds would have been wrong by a factor nobody
   * could have guessed. Renamed rather than documented, because a comment does not
   * travel with the number into a report.
   *
   * The *ratio* is meaningful whatever the unit, which is why
   * `verificationMultiplier` was correct all along.
   */
  readonly grossFuel: number
  /** Node-seconds that contributed to the answer. */
  /** Fuel that contributed to the answer. Same unit as `grossFuel`. */
  readonly usefulFuel: number
  /**
   * Measured verification tax: gross / useful. Reported on every job so the cost
   * of verification is always visible rather than discovered later (VER-06).
   */
  readonly verificationMultiplier: number
  /**
   * Dispatches beyond the first, summed over every shard — CHURN-01.
   *
   * `0` says this job never had to retry anything. It is the figure `Observation.
   * redispatches` publishes as the literal `0` at `bin/bench.ts` and at
   * `perf-workload.ts`, each with a comment saying why; this is where a real one comes
   * from.
   *
   * Read off `LeaseTable.redispatches`, so it counts *generations beyond the first* and
   * not attempts: a shard placed on two nodes in one generation spent one dispatch by
   * this measure, because one lease was granted. That is the quantity CHURN-01 asks to
   * be visible — how many times the scheduler had to go back and place again.
   */
  readonly redispatches: number
  /**
   * Every lease event this job produced, in order — CHURN-01, CHURN-04.
   *
   * Carried rather than summarised, because a count says *that* a job retried and this
   * says *why*: `expired` is a holder that went silent, `surrendered` is one that
   * answered with a failure, `renewed` is one that proved it was still working, and
   * `abandoned` is a shard that used its last generation. A reader can tell a job that
   * retried and succeeded from a job that never had to without inference, and can tell
   * *which kind* of trouble it had without guessing from a reason string.
   */
  readonly leaseHistory: readonly LeaseEvent[]
  /**
   * Measured speculation tax: total dispatches over useful ones — CHURN-02.
   *
   * Deliberately the same shape as {@link JobResult.verificationMultiplier} and for the
   * same reason: *a cost that is not surfaced is a cost that gets discovered later, by
   * someone else, in a bill.* `1` means speculation cost this job nothing, and it is
   * reported whether or not speculation was used, so its absence from a job is visible
   * rather than assumed.
   *
   * **`1` alone does not say speculation was off.** A job with no stragglers reports `1`
   * too. What distinguishes disabled from idle is this figure *together with* the
   * dispatch count — which is why `submit.test.ts`'s disabled arm asserts both.
   *
   * Read off `SpeculationLedger.multiplier`, so it counts *tasks* rather than replicas:
   * a job of ten shards with one duplicate reads `1.1` whatever its redundancy, because
   * redundancy is `verificationMultiplier`'s question and not this one.
   */
  readonly speculationMultiplier: number
  /** Duplicates this job actually started, out of a job-wide budget it could not exceed. */
  readonly speculationSpent: number
  /**
   * Owners this job was defined over, against owners that **fully** delivered — CHURN-05.
   *
   * Beside the result rather than instead of it: `covered: 2/3 owners` is the sentence
   * `describeCoverage` already writes and criterion 4 already asks for, and this is the
   * value it is written from.
   *
   * **An owner counts only when every one of its shards landed.** One of four is not a
   * contribution — see {@link landedForItsOwner} and the argument reproduced at the site
   * that computes this.
   *
   * **Not {@link JobResult.complete}, and never merged with it.** A caller can be told
   * this job is incomplete because a shard disagreed, or because an owner is entirely
   * absent, and those are different remedies: re-run, versus go and find the owner's node.
   * Deriving either from the other would take a caller's ability to tell them apart.
   * *(One implication does hold, by construction and not by design: because the owner set
   * is derived from the job's own shards, a `complete` job is always fully covered. The
   * converse fails, which is why the pair carries information at all. The module header
   * records what would make the missing direction reachable.)*
   */
  readonly coverage: JobCoverage
}

export type SubmitError =
  | { kind: 'no-shards' }
  | { kind: 'bad-redundancy'; redundancy: number }
  | { kind: 'input-not-encodable'; partitionIndex: number; detail: string }
  /** An executor has no matching `NodeDescriptor` — refused rather than let it slip past placement by omission. */
  | { kind: 'missing-node-descriptor'; nodeId: string }
  /**
   * A `'sovereign'` shard reached here with no usable owner id. Only reachable
   * via an `as ShardSpec` cast, since the discriminated union forbids this at
   * compile time — this is the runtime backstop for that cast (T-12-01).
   */
  | { kind: 'shard-missing-owner'; partitionIndex: number }
  /**
   * Every handle in {@link SubmitOptions.resumeFrom} was unreadable — CHURN-03.
   *
   * **Named through `readCheckpoint`'s own failure union rather than flattened to a
   * sentence**, because the three kinds have three different remedies: `block-missing`
   * says go and find the block, `undecodable` says the bytes are not a canonical block
   * at all, and `malformed` names the *field* that made it unusable. A resume that
   * threw, or one that silently ran the whole job, would both be worse than either —
   * the first loses the reason, the second loses the record.
   *
   * `failure` is the **newest** handle's, since that is the one the caller named; the
   * `detail` says how many handles were tried in total.
   */
  | { kind: 'checkpoint-unreadable'; failure: CheckpointFailure; detail: string }
  /**
   * The checkpoint is readable and is a checkpoint of a **different job** — CHURN-03.
   *
   * Reachable because `jobId` is derived from the module and the ordered input CIDs (see
   * {@link jobIdOf}), so this compares the checkpoint's own account of what job it
   * belongs to against this spec's. Without it a resume against a valid checkpoint of an
   * unrelated job would skip partitions by index — decoding cleanly, type-checking
   * cleanly, and returning another job's answers under this job's shard numbers.
   */
  | { kind: 'checkpoint-names-another-job'; expected: string; found: string }

export type SubmitResult =
  | { ok: true; job: JobResult }
  | { ok: false; error: SubmitError }

/**
 * Build a `PlacementRequest` for one shard without ever assigning an explicit
 * `undefined` to `ownerId` — `exactOptionalPropertyTypes` makes that a
 * different type from omitting the field, and `eligibleNodes` treats a
 * sovereign request whose owner is missing as *broken* rather than
 * unrestricted. Mirrors `coordinator.ts`'s `requestFor`.
 */
function requestFor(shard: ShardSpec, shardId: string, redundancy: number): PlacementRequest {
  return shard.label === 'sovereign'
    ? { shardId, label: shard.label, ownerId: shard.ownerId, redundancy }
    : { shardId, label: shard.label, redundancy }
}

/** A shard that produced no agreement produced nothing to attest. */
function noAgreementToAttest(status: string): NoVerifiedAttestation {
  return {
    kind: 'holds-no-verified-attestation',
    reason: `this shard is ${status} rather than agreed, so there is no agreement to attest`,
    agreeing: 0,
    verified: 0,
  }
}

/**
 * Build a shard's receipt from the replicas that agreed **and proved it**.
 *
 * Four questions per agreeing replica, each with its own name when the answer is no.
 * They are separate because a reader told only "not counted" would go looking at the
 * signature when the real answer is that this requestor holds no certificate for the
 * node at all.
 *
 * 1. **Does this requestor hold a certificate for that node?** The trust anchor is the
 *    descriptor's own `certificate` field, and deliberately **not** a `trustedIssuers`
 *    argument on `submitJob`. The pinned-issuer decision was already made, and already
 *    applied, where the certificate entered — `discoverCandidates`, which verifies
 *    against `trustedIssuers` at the discovery seam. Threading a second issuer set in
 *    here would create *a second place the same decision is made*, which can disagree
 *    with the first with nothing able to catch the disagreement — the same argument that
 *    rejected a parallel `nodeId → certificate` map. It also keeps four production
 *    submitters unchanged, which is the argument that rejected threading certificates
 *    through `JobSpec`.
 * 2. **Did the executor sign anything?** `'signed-by-nobody'` is a truthful statement by
 *    an executor nobody enrolled, not a signature that failed. A replica that signs
 *    nothing has said nothing, and that is not misconduct.
 * 3. **Is the certificate presented the one this node was discovered under?** It looks
 *    redundant beside question 4 and is not: without it a node could answer under some
 *    *other* certificate of its own, and the receipt would report an operator — or a
 *    user key — that this requestor never placed anything with.
 *
 *    Compared on `nodeKey` rather than on the whole certificate, because byte equality
 *    is wrong in one real case: a node that **re-enrolled** between discovery and
 *    execution answers under a fresher certificate with a later `issuedAt`, and a shard
 *    would fall to the named absence though nothing dishonest happened. Pinning *which
 *    node* and then verifying the presented certificate on its own terms accepts the
 *    fresher one and still refuses a substituted one.
 *
 *    **The issuer half is carried by the pinned set below, not by a second comparison
 *    here.** `verifyResultAttestation` is handed exactly the descriptor's own issuer, so
 *    a certificate from any other provider is refused by name as `untrusted-issuer`. An
 *    `issuer !== issuer` test beside it would be a branch nothing could reach, and this
 *    module's neighbours record what a check that cannot fire costs: it reads as a
 *    guarantee while guarding nothing. Widening that set — to every issuer this
 *    requestor knows, say — is what would make such a comparison live again, and is
 *    exactly the change that must not be made quietly.
 * 4. **Does the signature check out over THIS work?** The challenge is rebuilt from the
 *    caller's own task and from `verification.resultCid` — never from anything the
 *    attestation supplies, or it would verify against itself every time. `resultCid` is
 *    the right output to rebuild with because every agreeing replica hashed to it; that
 *    is what agreement means, so no shard output is re-hashed here.
 *
 * A **partial** verification returns the named absence rather than a receipt over
 * whatever happened to check out. A receipt over the subset would overstate or
 * understate, and which of the two would depend on an accident.
 *
 * The transferable half survives this local shortcut: the attestation carries the whole
 * certificate on the wire, so a third party holding only the provider's public key can
 * check the same statement without any of this requestor's descriptors. The shortcut is
 * about what *this* requestor already knows, not about what the artifact contains.
 */
function receiptFor(
  agreeing: readonly AgreeingReplica[],
  work: ResultWork,
  descriptors: ReadonlyMap<string, NodeDescriptor>,
  now: number,
): ShardAttestation {
  const verified: NodeCertificate[] = []
  const unaccounted: string[] = []

  for (const replica of agreeing) {
    const descriptor = descriptors.get(replica.nodeId)
    if (descriptor === undefined) {
      unaccounted.push(`${replica.nodeId}: this requestor holds no descriptor for it`)
      continue
    }
    if (descriptor.certificate === 'carries-no-certificate') {
      unaccounted.push(`${replica.nodeId}: this requestor holds no certificate for it`)
      continue
    }
    if (replica.attestation === 'signed-by-nobody') {
      unaccounted.push(`${replica.nodeId}: the executor stated that it signs nothing`)
      continue
    }
    if (replica.attestation.certificate.nodeKey !== descriptor.certificate.nodeKey) {
      unaccounted.push(
        `${replica.nodeId}: answered under node key ${replica.attestation.certificate.nodeKey}, ` +
          `which is not the ${descriptor.certificate.nodeKey} it was discovered under`,
      )
      continue
    }
    const checked = verifyResultAttestation(
      replica.attestation,
      work,
      new Set([descriptor.certificate.issuer]),
      now,
    )
    if (!checked.ok) {
      unaccounted.push(`${replica.nodeId}: ${checked.reason}`)
      continue
    }
    verified.push(checked.certificate)
  }

  if (unaccounted.length > 0 || verified.length === 0) {
    return {
      kind: 'holds-no-verified-attestation',
      reason:
        verified.length === 0
          ? `no agreeing replica produced a signed statement this requestor could check — ${unaccounted.join('; ')}`
          : `only ${verified.length} of ${agreeing.length} agreeing replicas produced a signed ` +
            'statement this requestor could check, and a strength over that subset would state ' +
            `something this requestor cannot account for — ${unaccounted.join('; ')}`,
      agreeing: agreeing.length,
      verified: verified.length,
    }
  }

  // `attestationReceipt` reports `replicas` from `agreeing.length` and does not dedupe,
  // so two entries for one node would report redundancy the result does not have. The
  // invariant belongs here and not in `quorum.ts`: that module is a pure report over
  // whatever it is handed, and a dedupe inside it would silently repair an assembly bug
  // instead of failing on one. Unreachable through `executeVerified`, which produces one
  // entry per executor and whose executors are keyed by node id one function up — which
  // is why this throws rather than returning a value: it is a defect in this module's own
  // assembly, not a verdict about anything a peer sent, the same call `NotEncodableError`
  // and `WrongSigningKeyError` already make in this package.
  if (new Set(verified.map((certificate) => certificate.nodeKey)).size !== verified.length) {
    throw new Error(
      'two agreeing replicas of one shard verified under the same node key — a receipt built ' +
        'from this set would report redundancy the result does not have',
    )
  }

  return attestationReceipt(verified)
}

/**
 * The capacity slot key a serving node reserves for this task.
 *
 * Transcribed from `net/src/agent.ts`'s exec branch — search `const slotKey` — and it
 * has to be **derived the same way there and here** or the renewal probe asks about a
 * unit of work no node is holding. That branch's own comment gives the derivation's
 * reason: an `exec` request carries no shard id, so `inputCid` plus `partitionIndex` is
 * the task's identity, and it is well defined because `submitJob` content-addresses
 * every shard input.
 *
 * This is a **wire vocabulary** shared with `@o2/net`, not an internal name. It is here
 * rather than imported because `packages/core` may not depend on `packages/net`.
 */
function capacitySlotKey(inputCid: CID, partitionIndex: number): string {
  return `${inputCid.toString()}:${partitionIndex}`
}

/**
 * The exact refusal a node gives for a second claim on a key it is already holding.
 *
 * Transcribed from `placement.ts`'s `LocalCapacity.#decide` — search
 * `is already in flight here` — which composes it in one place precisely so a second
 * construction cannot drift from it. This is the second construction, and the drift it
 * could suffer is guarded rather than promised: `submit.test.ts`'s renewal pair drives a
 * **real `LocalCapacity`** rather than a stub, so a change to that string turns the
 * evidence arm red here instead of silently making every renewal unreachable.
 *
 * Compared for equality against a string this module composed from its own slot key,
 * never sniffed as a substring of whatever a node said. A requestor that accepted any
 * refusal mentioning "in flight" would accept a refusal about a *different* shard.
 */
function inFlightRefusal(slotKey: string): string {
  return `${slotKey} is already in flight here`
}

/**
 * The name a job answers to in its own checkpoints — CHURN-03.
 *
 * **Derived, never declared**, and the argument is the one 20-08 made for the owner set:
 * the standing rule that an optional field with a silent default is a hole governs
 * *choices the caller must state*, and a job's identity is not a choice — it is a fact
 * already present in the caller's own input. `PROJECT.md`'s liveness invariant says a
 * result is a pure function of `(module, input, partition)`, so two submissions of the
 * same module over the same ordered inputs **are** the same job: they compute the same
 * answers and either one's checkpoint is a correct account of the other's progress. A
 * caller-supplied string could disagree between the requestor that departed and the one
 * that arrived, and the resume would then read a checkpoint of a different job while
 * everything type-checked.
 *
 * Deriving it is also what makes {@link SubmitError} `'checkpoint-names-another-job'`
 * reachable at all: a declared id would be whatever the resuming caller passed, so the
 * comparison would be against itself.
 *
 * **Redundancy is deliberately not in it.** A shard's answer does not depend on how many
 * nodes computed it — that is what content addressing means here — so a job re-submitted
 * at a different redundancy is the same job, and its checkpoint names answers that are
 * still correct. What *does* change is how well this requestor verified them, and that is
 * reported on the shard ({@link ShardResult.degraded}, `replicas: 0`) rather than smuggled
 * into an identity.
 *
 * Throws rather than returning an error, and only on an input this function constructs
 * itself — a record of two strings and an array of strings, which the canonical codec
 * cannot refuse. Same call {@link receiptFor} makes for its own assembly invariant.
 *
 * ## Exported on 2026-08-17, and the reason is the read half of CHURN-03
 *
 * This was module-private, and that was the correct scope for as long as nobody could
 * resume anything: the only caller was `submitJob`, thirteen hundred lines below, and an
 * export with no production caller is what `reachability-guard.node.test.ts` reddens on.
 *
 * What changed is that a resume needs the id **before** the submit that would derive it.
 * {@link SubmitOptions.resumeFrom} takes handles, a stored handle has to be looked up
 * under *something*, and `resumeState` refuses a handle whose checkpoint names another
 * job by name — so the key a store files handles under must be this id and cannot be
 * anything looser. `packages/browser/src/idb-checkpoints.ts` is that store and
 * `demo/main.ts#runColouring` is its caller; both are downstream of this function being
 * callable from outside this module.
 *
 * **A second derivation of the same fact is the hazard, and it is bounded rather than
 * denied.** A caller must still canonicalise its own shard values to obtain `inputCids`,
 * which is a step this function does not perform for it — see `submitJob`'s own loop, and
 * `submit.test.ts`'s *"a caller derives the id `submitJob` will derive"* case, which
 * re-derives an id outside `submitJob` and compares it against the one the checkpoint
 * block actually carries. That case is what makes the demo's lookup key true by
 * measurement instead of by reading.
 */
export async function jobIdOf(moduleCid: CID, inputCids: readonly CID[]): Promise<string> {
  const encoded = await canonicalCid({
    module: moduleCid.toString(),
    inputs: inputCids.map((cid) => cid.toString()),
  })
  if (!encoded.ok) {
    throw new Error(
      `a job id over ${inputCids.length} content addresses would not canonicalise — ` +
        `this input is built from strings and cannot be refused: ${JSON.stringify(encoded.error)}`,
    )
  }
  return encoded.cid.toString()
}

/** Somewhere a checkpoint handle goes the instant it exists. See {@link SubmitOptions.checkpoints}. */
export interface CheckpointSink {
  /**
   * Called with each handle as it is written, oldest first.
   *
   * The {@link JobCheckpoint} is handed over beside it because it is already in hand and
   * a sink that wants to show progress would otherwise have to read the block back to
   * learn what it just published.
   *
   * **Awaited**, so a sink that persists slowly slows the job rather than silently
   * falling behind it. A handle that has not reached the sink is a handle nobody can
   * resume from, which makes an un-awaited publish a checkpoint that does not exist.
   */
  publish(handle: CID, checkpoint: JobCheckpoint): Promise<void>
}

/** Records answered shards and publishes a handle per answer. See {@link SubmitOptions.checkpoints}. */
interface CheckpointLog {
  record(shard: CompletedShard): Promise<void>
}

/** The log that writes nothing, for a caller that named `'checkpoints-nothing'`. */
const NO_CHECKPOINTS: CheckpointLog = {
  record: async (): Promise<void> => {},
}

/**
 * One serialised chain of checkpoint writes for one job — CHURN-03.
 *
 * **Serialised, and that is not incidental.** Shards run concurrently, so two settling
 * within one turn would otherwise each compose a checkpoint against the same `previous`
 * and the chain would *fork* — two handles claiming the same predecessor, one of them
 * naming work the other does not. `checkpointChain`'s audit walk would then follow one
 * branch and report a history that omits half the job. Chaining the writes through a
 * single promise costs the settling shard the duration of one encode and one put, which
 * is the tail of a dispatch that has already finished.
 *
 * Each write names **everything known when it is composed**, not a delta, which is what
 * makes any single handle a complete view and therefore something a resume can act on
 * alone. `checkpointOf` sorts and dedupes, so the same knowledge always produces the same
 * CID.
 */
function checkpointLogOf(
  sink: CheckpointSink,
  blockstore: Blockstore,
  job: { readonly jobId: string; readonly moduleCid: string; readonly partitionCount: number },
  clock: JobClock,
  carried: readonly CompletedShard[],
  resumedFrom: CID | null,
): CheckpointLog {
  // Seeded with whatever a resume carried, so a *third* requestor reading this run's
  // newest handle does not re-run the first requestor's work. A checkpoint that named
  // only what this process computed would lose ground on every hand-off.
  const completed: CompletedShard[] = [...carried]
  // Continuous across requestors: this run's first checkpoint names the handle it resumed
  // from as its predecessor, so `checkpointChain` walks back through the departed
  // requestor's history rather than stopping at the hand-off.
  let previous: string | null = resumedFrom === null ? null : resumedFrom.toString()
  let chain: Promise<void> = Promise.resolve()

  return {
    record(shard: CompletedShard): Promise<void> {
      chain = chain.then(async (): Promise<void> => {
        completed.push(shard)
        const checkpoint = checkpointOf({
          jobId: job.jobId,
          moduleCid: job.moduleCid,
          partitionCount: job.partitionCount,
          completed,
          // `readCheckpoint` refuses an `at` that is not a whole number ≥ 0, so a clock
          // port that reports a fraction — or a virtual one that ran backwards — would
          // otherwise produce a block this module could not read back. Clamped here
          // rather than trusted, for the reason `checkpoint.ts` validates every field it
          // reads: this is the only place the value is chosen.
          at: Math.max(0, Math.floor(clock.now())),
          previous,
        })
        const handle = await writeCheckpoint(checkpoint, blockstore)
        previous = handle.toString()
        await sink.publish(handle, checkpoint)
      })
      return chain
    },
  }
}

/** One shard a checkpoint answered, with the bytes its CID resolved to. */
interface CarriedShard {
  readonly resultCid: CID
  readonly output: CanonicalValue
}

/** What a resume found, or the named refusal that stopped it. */
type ResumeState =
  | {
      readonly ok: true
      readonly carried: ReadonlyMap<number, CarriedShard>
      /** The handle actually used. `null` when the caller asked for no resume. */
      readonly from: CID | null
      /** Handles ahead of it whose blocks were unreadable. See `recoverCheckpoint`. */
      readonly skipped: number
    }
  | { readonly ok: false; readonly error: SubmitError }

/**
 * Read the newest usable handle and turn it into the shards this job may skip — CHURN-03.
 *
 * ## Recovery is the point, not a fallback
 *
 * The handles arrive newest first and go straight to `recoverCheckpoint`, whose own
 * docblock gives the reason the signature is a *list*: **a chain cannot be walked
 * backwards past a block you cannot read**, because the link to the predecessor lives
 * inside that block. So the newest block being gone is not an error — it is the ordinary
 * case a coordinator publishes handles for. The job resumes from an older *complete* view
 * and re-runs whatever the lost checkpoint would have let it skip: work, never
 * correctness.
 *
 * ## A named answer is looked up, and a lookup that fails is a shard to re-run
 *
 * `remainingWork` is `checkpoint.ts`'s answer to "what is left", and it reads the
 * partition indices alone. This function is stricter on purpose: a partition counts as
 * carried only if its named result block is **present and decodable in this requestor's
 * blockstore**. A checkpoint whose blocks were garbage-collected names answers nobody can
 * retrieve, and skipping such a shard would produce a job result whose output nobody
 * holds. Falling through to a re-run is the same trade the recovery arm makes and the same
 * one the whole module makes: liveness changes who computes a task and when, never what
 * the answer is.
 */
async function resumeState(
  handles: readonly CID[] | undefined,
  blockstore: Blockstore,
  jobId: string,
  partitionCount: number,
): Promise<ResumeState> {
  if (handles === undefined || handles.length === 0) {
    return { ok: true, carried: new Map(), from: null, skipped: 0 }
  }

  const recovered = await recoverCheckpoint(handles, blockstore)
  if (recovered === null) {
    // `recoverCheckpoint` reports *how many* it skipped and not *why* each failed, so the
    // newest handle is read once more to name a failure. One extra lookup, on a path that
    // is already returning an error, in exchange for a refusal a caller can act on.
    const newest = await readCheckpoint(handles[0] as CID, blockstore)
    return {
      ok: false,
      error: {
        kind: 'checkpoint-unreadable',
        failure: newest.ok
          ? { kind: 'block-missing', cid: (handles[0] as CID).toString() }
          : newest.failure,
        detail:
          `none of the ${handles.length} handle(s) offered for this resume was readable; ` +
          `the newest is ${newest.ok ? 'readable now, so the store changed under this read' : newest.reason}`,
      },
    }
  }

  if (recovered.checkpoint.jobId !== jobId) {
    return {
      ok: false,
      error: {
        kind: 'checkpoint-names-another-job',
        expected: jobId,
        found: recovered.checkpoint.jobId,
      },
    }
  }

  const carried = new Map<number, CarriedShard>()
  for (const shard of recovered.checkpoint.completed) {
    // A partition outside this job. `readCheckpoint` already refuses one past the
    // checkpoint's *own* `partitionCount`; this is the comparison against **this job's**,
    // which is a different number whenever a hand-written block claims a matching id.
    if (shard.partitionIndex >= partitionCount) continue
    let resultCid: CID
    try {
      resultCid = CID.parse(shard.resultCid)
    } catch {
      // The field is a string by `readCheckpoint`'s validation and a CID by nobody's.
      continue
    }
    const bytes = await blockstore.get(resultCid)
    if (bytes === undefined) continue
    try {
      carried.set(shard.partitionIndex, { resultCid, output: decodeCanonical(bytes) })
    } catch {
      // Named, present, and not a canonical block. Re-run it.
      continue
    }
  }

  return { ok: true, carried, from: recovered.cid, skipped: recovered.skipped }
}

/**
 * What the placement array holds for a shard a checkpoint already answered.
 *
 * The placement pass runs over every partition and a carried one has no placement to
 * record, so it records the reason it has none. Named rather than inlined at the two arms
 * that write it, so the two cannot drift into saying different things about one condition.
 */
const CARRIED_NOT_PLACED =
  'a checkpoint already named this shard’s answer, so this requestor placed it nowhere'

/** The record of a shard this requestor did not run, in the shape every other shard reports. */
function carriedResult(
  partitionIndex: number,
  inputCid: CID,
  shard: CarriedShard,
): ShardResult {
  return {
    partitionIndex,
    inputCid,
    // `agreed`, because the answer is in hand and retrievable — and at `replicas: 0`,
    // because **this requestor obtained none**. Reporting the redundancy the predecessor
    // achieved would be this module asserting a verification it did not perform and
    // cannot check, which is the conflation `receiptFor`'s doc refuses one level down.
    verification: {
      status: 'agreed',
      resultCid: shard.resultCid,
      output: shard.output,
      agreeing: [],
      replicas: 0,
      // Empty because **this requestor asked nobody**, which is the same measured zero
      // `replicas`, `grossFuel` and `attempted` take here and not a default standing in
      // for an unknown. A refusal the predecessor met is not in the checkpoint — a
      // checkpoint carries an answer, not the history that produced it — and inventing
      // `[]` to mean "there were none" would be this module asserting something about a
      // run it did not observe, which is the conflation the `replicas: 0` note above
      // refuses in the same breath.
      failures: [],
      grossFuel: 0,
      usefulFuel: 0,
    },
    // Nothing was asked, nothing was placed, no generation ran, no lease was granted.
    // Measured zeroes, the same reading the `never-placed` arm takes — and `ending` is
    // what tells the two apart.
    attempted: [],
    generations: 0,
    ending: 'carried-from-checkpoint',
    speculated: false,
    disagreed: false,
    copies: [],
    // See {@link ShardEnding} `'carried-from-checkpoint'`: zero replicas is below any
    // redundancy a caller can ask for, so this is the field's own definition applied
    // rather than a policy invented here.
    degraded: true,
    quorum: {
      kind: 'not-attempted',
      reason:
        'a checkpoint already named this shard’s answer, so this requestor dispatched it ' +
        'to nobody and composed no quorum for it',
    },
    rejections: [],
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason:
        'this shard’s answer was carried from a checkpoint, so this requestor holds no ' +
        'signature over it from anybody — the predecessor’s receipt, if it had one, is not ' +
        'in the checkpoint and a checkpoint could not be trusted to carry one',
      agreeing: 0,
      verified: 0,
    },
  }
}

/** The default account of time: the platform's, with a wait that cannot outlive the job. */
const platformClock: JobClock = {
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      const timer: unknown = setTimeout(resolve, ms)
      // Node returns a `Timeout` object with `unref`; a browser returns a number and has
      // none. An abandoned wait must not be the reason a process stays alive, and this
      // is the only place in this module that could become one.
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        ;(timer as { unref: () => void }).unref()
      }
    }),
}

/**
 * Fold two generations of one shard into the single result that shard actually got.
 *
 * **Verified together, not reported as two agreements.** A shard that ran once at
 * `replicas: 1` and was topped up once more at `replicas: 1` did not get two answers; it
 * got one answer confirmed by two nodes, and saying otherwise would report a redundancy
 * nobody established. So the replicas are unioned, the fuel is summed across every
 * generation — the honest cost, including the generations that produced nothing — and
 * the *comparison* is redone over the union.
 *
 * **Which means a top-up can discover a disagreement**, and it must. Two generations
 * whose results hash differently are exactly the event `verify.ts` refuses to vote away,
 * arriving one generation later than usual. Grouping by `resultCid` across generations is
 * what makes that reachable at all; taking the second generation's answer because it is
 * newer would be majority-vote-by-recency.
 *
 * `usefulFuel` is the first agreeing generation's, because the answer is that generation's
 * answer — every later replica recomputed the same bytes.
 */
function mergeVerifications(first: VerificationResult, second: VerificationResult): VerificationResult {
  const nodesByCid = new Map<string, string[]>()
  const agreeing: AgreeingReplica[] = []
  const failures: { nodeId: string; reason: string }[] = []
  const reasons: string[] = []
  let winner: { resultCid: CID; output: CanonicalValue; usefulFuel: number } | null = null
  let grossFuel = 0

  for (const generation of [first, second]) {
    if (generation.status === 'agreed') {
      grossFuel += generation.grossFuel
      if (winner === null) {
        winner = {
          resultCid: generation.resultCid,
          output: generation.output,
          usefulFuel: generation.usefulFuel,
        }
      }
      const key = generation.resultCid.toString()
      nodesByCid.set(key, [
        ...(nodesByCid.get(key) ?? []),
        ...generation.agreeing.map((replica) => replica.nodeId),
      ])
      agreeing.push(...generation.agreeing)
      continue
    }
    failures.push(...generation.failures)
    if (generation.status === 'disagreed') {
      for (const partition of generation.partitions) {
        nodesByCid.set(partition.resultCid, [
          ...(nodesByCid.get(partition.resultCid) ?? []),
          ...partition.nodes,
        ])
      }
      continue
    }
    reasons.push(generation.reason)
  }

  if (nodesByCid.size > 1) {
    return {
      status: 'disagreed',
      partitions: [...nodesByCid].map(([resultCid, nodes]) => ({ resultCid, nodes })),
      failures,
    }
  }
  if (winner === null) {
    return {
      status: 'insufficient',
      // Every generation's reason, in order, because "nobody answered" three times over
      // three different node sets is three facts and a caller reading one of them would
      // be told about a third of what happened.
      reason: reasons.join('; then '),
      failures,
    }
  }
  return {
    status: 'agreed',
    resultCid: winner.resultCid,
    output: winner.output,
    agreeing,
    replicas: agreeing.length,
    // **Every generation's refusals, carried across the fold.** This function collected
    // them all along — for the `disagreed` and `insufficient` returns above — and then
    // dropped them here, which is the defect stated in one line: a shard whose first
    // executor refused by name and whose re-pick succeeded reported the success and
    // erased the refusal, so a requestor could see from `ShardResult.attempted` and
    // `ShardResult.generations` *that* a node had been asked and had not worked out, and
    // never *why*. A retry that hides the reason is the silent filtering Phase 6 forbids,
    // arriving one layer up.
    //
    // Unioned rather than replaced, for the reason the replicas are: two generations that
    // each lost a node lost two nodes, and reporting only the last would be a different
    // claim. Order is generation order, so the earliest refusal reads first.
    failures,
    grossFuel,
    usefulFuel: winner.usefulFuel,
  }
}

/** What one generation's placement produced, or the refusals that stopped it. */
type Regeneration =
  | {
      readonly placed: true
      readonly nodeIds: readonly string[]
      readonly rejections: readonly Rejection[]
      readonly degraded: boolean
    }
  | { readonly placed: false; readonly rejections: readonly Rejection[] }

/**
 * Place one shard again, over the same eligibility gate minus every node already tried.
 *
 * **The narrowing happens before placement, never after**, and the reason is
 * `coordinator.ts`'s `runShard`, whose loop this borrows its reasoning from: placement is
 * deterministic rendezvous ranking, so a re-dispatch handed the same pool picks the node
 * that just failed, every time, until the generations run out.
 *
 * **Eligibility cannot widen here, and it is worth being exact about why.** Narrowing a
 * placer's input can only shrink what comes out, and both placers call `eligibleNodes`
 * as their first act on whatever they are handed — `planPlacement` at `sovereignty.ts`,
 * `placeWithOffers` at `placement.ts`, the same exported function, which is exported
 * *"so that there is exactly one of it"*. So a sovereign shard's second generation lands
 * on its owner's nodes or nowhere, and that guarantee is structural rather than
 * something this loop maintains by care. (Measured, and stated because it changes what a
 * plant here can prove: substituting `spec.nodes` for the gate's pool does **not** leak a
 * sovereign shard, because the gate re-runs inside the placer. What it *would* widen is
 * the quorum pool, which is this module's own narrowing and has no second enforcement.)
 *
 * **The two arms stay apart.** The arm is chosen by `admit` exactly as it was for the
 * first generation, so a job never mixes them — see {@link JobSpec.admit}.
 */
async function placeAgain(
  request: PlacementRequest,
  pool: readonly NodeDescriptor[],
  tried: ReadonlySet<string>,
  admit: AdmissionControl | undefined,
): Promise<Regeneration> {
  const remaining = pool.filter((node) => !tried.has(node.nodeId))
  if (remaining.length === 0) return { placed: false, rejections: [] }

  if (admit === undefined) {
    // No `dispatchCount` nudge here, and that is a real difference from the first
    // generation rather than an omission: the nudge spreads a *job's* shards across a
    // node set inside one pass, and a re-dispatch is a single shard placed on its own
    // after that pass has finished. Reconstructing the tally would spread a retry
    // against a count that no longer describes anything in flight.
    const plan = planPlacement([request], remaining)
    const placement = plan.placements[0] as Placement
    return placement.status === 'placed'
      ? { placed: true, nodeIds: placement.nodeIds, rejections: [], degraded: placement.degraded }
      : { placed: false, rejections: [] }
  }

  // One call, one request. `planWithOffers` keeps its cross-shard headroom tally inside
  // a single call, so **a second generation's tally is separate from the first's** — a
  // node this job has already filled looks empty again to this call. That is the bound
  // 18-04 measured, and it is inherited rather than repaired here: the authoritative
  // limit is the serving node's own `LocalCapacity` on the `exec` branch, which is
  // unaffected by what any requestor tallies. Threading one tally across generations
  // would mean holding a placement-time structure open across a dispatch, which is a
  // different mechanism and a new decision.
  const offered = await planWithOffers([request], remaining, { admit })
  const placement = offered[0]
  if (placement === undefined) return { placed: false, rejections: [] }
  return placement.status === 'placed'
    ? {
        placed: true,
        nodeIds: placement.nodeIds,
        rejections: placement.rejections,
        degraded: placement.degraded,
      }
    : { placed: false, rejections: placement.rejections }
}

/** A copy of one shard still in flight, and its answer in both forms it is read in. */
interface Copy {
  /** The nodes this copy ran on. `nodeIds[0]` is the key it is held under. */
  readonly nodeIds: readonly string[]
  /** True for a speculative duplicate, false for the generation's placed dispatch. */
  readonly speculative: boolean
  /** The dispatch, converted so it can never reject. Read again by the late comparison. */
  readonly pending: Promise<VerificationResult>
  /**
   * The same answer in the form the poll loop races, built **once**, here.
   *
   * `coordinator.ts` built this inside the loop and recorded what that cost: a fresh
   * closure and promise per iteration, *"an out-of-memory crash rather than a slow test,
   * and only when a real dispatch is slower than the watchdog, which is exactly when
   * speculation is supposed to be working."* The loop below re-races these same promise
   * objects; it never re-wraps them.
   */
  readonly raced: Promise<Raced>
}

/**
 * What the poll produced: a copy answered, or the timer fired.
 *
 * A discriminated union rather than a sentinel value, because `insufficient` is a
 * perfectly ordinary dispatch result here and a tick must not be confusable with one.
 */
type Raced =
  | { readonly tick: true }
  | { readonly tick: false; readonly key: string; readonly verification: VerificationResult }

/** A copy left running when another one won, kept so its answer can still be read. */
interface OutstandingCopy {
  readonly nodeIds: readonly string[]
  readonly pending: Promise<VerificationResult>
}

/**
 * A dispatch answered, or its lease ran out with the holder still silent.
 *
 * `outstanding` is non-empty only where speculation started a second copy: with one copy
 * in flight, the copy that answers is the only copy there was. That is why turning
 * speculation off restores this loop to exactly the two-wake shape Plan 20-01 shipped.
 */
type Dispatched =
  | {
      readonly kind: 'answered'
      readonly verification: VerificationResult
      readonly outstanding: readonly OutstandingCopy[]
      readonly speculated: boolean
    }
  | { readonly kind: 'lapsed'; readonly speculated: boolean }

/** The job-wide speculation state one shard's dispatch needs to consult. */
interface ShardSpeculation {
  /** The job-wide budget. Shared, because a per-shard one lets a big job duplicate everything. */
  readonly ledger: SpeculationLedger
  /** Durations of shards that have finished, live and job-wide, so the median means something. */
  readonly completed: readonly number[]
  /** This shard's placement request, for the one eligibility gate. Redundancy is not read. */
  readonly request: PlacementRequest
  /** The candidate pool this shard's generations place over — the gate's, never the job's. */
  readonly pool: readonly NodeDescriptor[]
  /**
   * This shard's own `attempted` list, **mutated** when a duplicate is started.
   *
   * Live rather than copied, because the exclusion has to be current *within* a
   * generation: a duplicate started at one tick must not be a candidate at the next, and
   * a later generation must not re-place onto it.
   */
  readonly attempted: string[]
  readonly factor: number
  readonly watchdogMs: number
}

/** One dispatch of one copy, wrapped once into both the forms this module reads it in. */
function dispatchCopy(
  dispatch: (nodeIds: readonly string[]) => Promise<VerificationResult>,
  nodeIds: readonly string[],
  speculative: boolean,
): Copy {
  // Handled at creation, so abandoning this promise on a lapse can never surface as an
  // unhandled rejection. `executeVerified` converts a throwing executor into a named
  // failure itself; this covers the port breaking in a way that one does not.
  const pending: Promise<VerificationResult> = dispatch(nodeIds).then(
    (verification) => verification,
    (cause): VerificationResult => ({
      status: 'insufficient',
      reason: `the dispatch itself threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      failures: [],
    }),
  )
  const key = nodeIds[0] as string
  return {
    nodeIds,
    speculative,
    pending,
    raced: pending.then((verification): Raced => ({ tick: false, key, verification })),
  }
}

/**
 * Run one generation under its lease, renewing only against evidence — CHURN-04.
 *
 * ## Failure is a fact, silence is a deadline
 *
 * The distinction is `coordinator.ts`'s and it is preserved here. A dispatch that
 * *reports* — agreed, disagreed, or every executor failed — is observed, and the caller
 * acts on it immediately. Silence is not observed; it is indistinguishable from
 * slowness, and the only safe answer to "I cannot tell" is to wait a bounded time. The
 * bound is the lease.
 *
 * ## The renewal, and what makes it a lease rather than a longer timeout
 *
 * At `RENEW_AT` — two-thirds of the span, leaving a full third for a late answer to
 * still arrive — the requestor asks the holder about **this task's own slot key**. Only
 * the duplicate refusal counts as evidence, because only it means *this node is running
 * this exact task right now*. An acceptance means the slot is free, which is a node that
 * is not working on it; an over-commit refusal names a different condition; an
 * unreachable answer or a throw is silence with extra steps. A single probe decides it:
 * a holder that cannot show it is working is left the remaining third of its lease to
 * answer for real, and then the lease lapses.
 *
 * Nothing is cancelled on a lapse. The abandoned dispatch may still resolve, and it will
 * resolve to the same bytes any re-dispatch produces — `lease.ts`'s invariant, that
 * liveness changes who computes a task and when, never what the answer is. Its result is
 * simply not the one this shard reports.
 *
 * ## The race, when there is one — CHURN-02
 *
 * A tick may start a **second copy** of this shard on another eligible node while the
 * first is still running, and from then on the loop races both. The first answer that is
 * an answer wins and returns; whatever is still running is handed back on `outstanding`,
 * **never cancelled**, and compared once every shard of the job has settled. A copy that
 * answers `insufficient` does not win — every executor of that copy failed, which is not
 * a result — so the loop keeps waiting for its sibling and merges the failures into
 * whatever finally arrives.
 *
 * **The timer is unconditional.** `watching` decides only whether a tick may
 * *speculate*. An earlier version of `coordinator.ts` used such a flag to drop the
 * watchdog out of the race entirely, which left the loop awaiting a promise that might
 * never settle — the flag doing double duty as an optimisation and as a broken
 * termination argument. Termination is the lease deadline's job and only its job.
 */
async function dispatchUnderLease(
  dispatch: (nodeIds: readonly string[]) => Promise<VerificationResult>,
  placed: readonly string[],
  startedAt: number,
  granted: Lease,
  leases: LeaseTable,
  clock: JobClock,
  probe: ((nodeId: string) => Promise<boolean>) | null,
  speculation: ShardSpeculation | null,
): Promise<Dispatched> {
  const first = dispatchCopy(dispatch, placed, false)
  const copies = new Map<string, Copy>([[first.nodeIds[0] as string, first]])
  /** Merged across copies of this generation, so a loser's failures are not lost. */
  let answered: VerificationResult | null = null
  let speculated = false

  let lease = granted
  /** Cleared once this generation has been refused a renewal. It is never restored. */
  let renewable = probe !== null
  /**
   * Whether a tick may still start a duplicate for this shard.
   *
   * Cleared for the three *permanent* reasons — a duplicate is already running, the
   * job-wide budget is gone, or there is no eligible node left to duplicate onto — each
   * permanent because the budget only shrinks and `attempted` only grows. Being **too
   * new to judge** is the one reason to do nothing that must not clear it: the median
   * moves and elapsed time grows, so a shard that is not a straggler yet may become one.
   */
  let watching = speculation !== null

  for (;;) {
    const at = clock.now()
    // `checkLease` rather than the comparison it wraps, on the same ground as `shouldRenew`
    // below: `lease.ts` is the authority on what a lease permits, and this loop had the
    // predicate hand-inlined at two sites. `checkLease(lease, at).expired` is
    // `at >= lease.expiresAt` exactly — the function returns the `expired: false` arm only
    // when `expiresAt > now` — so this is behaviour-neutral, and `lease.test.ts` holds the
    // equivalence rather than this comment asserting it.
    if (checkLease(lease, at).expired) return { kind: 'lapsed', speculated }

    // The renewal point, measured **back from the deadline** rather than forward from
    // the grant — `expiresAt - leaseMs × (1 - RENEW_AT)`, which is the instant at which
    // a third of a fresh lease is left. On a lease that has never been renewed the two
    // are the same expression, since `expiresAt = grantedAt + leaseMs`.
    //
    // They diverge on a renewed one, and the forward form is wrong there. `LeaseTable.
    // renew` keeps `grantedAt` fixed and pushes `expiresAt` out, so the *span* grows by
    // a whole lease every renewal and `grantedAt + span × RENEW_AT` grows with it: after
    // the elapsed time passes `2 × leaseMs` the forward renewal point falls **behind
    // the current instant**, this loop waits to the deadline instead of asking for
    // evidence, and a holder that was working right up to the deadline has its lease
    // lapse anyway. Found by planting, not by reading — the unconditional-renew mutation
    // reddened the *wrong* arm of `submit.test.ts`'s renewal pair and this arithmetic
    // was why. `shouldRenew` remains the authority on whether a renewal is due; this
    // only decides when to wake up and ask.
    const renewPoint = lease.expiresAt - leases.leaseMs * (1 - RENEW_AT)
    // Wake at the earliest instant at which anything can be decided: the renewal point
    // while renewal is still possible, the next watchdog tick while a duplicate is still
    // possible, and the deadline, which is always in the list. With neither of the first
    // two live this is the two-wake schedule Plan 20-01 shipped, unchanged — a shard that
    // cannot speculate does not poll. Clamped into `(at, expiresAt]` so an instant
    // already in the past is asked about immediately rather than slept through.
    let wakeAt = lease.expiresAt
    if (renewable) wakeAt = Math.min(wakeAt, Math.max(renewPoint, at))
    if (watching && speculation !== null) wakeAt = Math.min(wakeAt, at + speculation.watchdogMs)
    wakeAt = Math.max(wakeAt, at)
    // The timer is **unconditional** — see the header. `watching` chose how soon to wake,
    // never whether to. The copies' `raced` promises are re-raced, never re-wrapped.
    const raced: Raced = await Promise.race<Raced>([
      ...[...copies.values()].map((copy) => copy.raced),
      clock.sleep(Math.max(1, Math.ceil(wakeAt - at))).then((): Raced => ({ tick: true })),
    ])

    if (!raced.tick) {
      copies.delete(raced.key)
      answered =
        answered === null ? raced.verification : mergeVerifications(answered, raced.verification)
      // First result wins, and the copies still running are **registered, not forgotten**.
      // `insufficient` is not a result — every executor of that copy failed — so it does
      // not win a race it has a sibling in; the loop waits for the sibling and the
      // failures ride along in the merge. With one copy in flight there is no sibling and
      // this is exactly Plan 20-01's behaviour: the answer, whatever it was, returns.
      if (raced.verification.status !== 'insufficient' || copies.size === 0) {
        return {
          kind: 'answered',
          verification: answered,
          outstanding: [...copies.values()].map((copy) => ({
            nodeIds: copy.nodeIds,
            pending: copy.pending,
          })),
          speculated,
        }
      }
      continue
    }

    const woke = clock.now()
    if (checkLease(lease, woke).expired) return { kind: 'lapsed', speculated }

    // ── Straggler duplication — CHURN-02, CHURN-06 ────────────────────────────────
    //
    // Before the renewal question, because they are different questions about different
    // things: renewal asks whether *this* holder is still working, duplication asks
    // whether the shard has fallen behind its peers. A shard can be both — a holder that
    // proves it is working and is still slower than everything else gets its lease
    // renewed *and* a second copy started, which is the correct pair of answers.
    if (speculation !== null && watching) {
      if (speculation.ledger.duplicated(lease.taskId) || speculation.ledger.remaining <= 0) {
        watching = false
      } else {
        // **The one eligibility gate.** `speculativeCandidates` routes through
        // `eligibleNodes`, the same function both placers call first, so a sovereign
        // shard's duplicate can only land on its owner's own executable nodes. The pool
        // is the *gate's* pool rather than the job's candidate set, so a composed quorum
        // is not silently widened by a duplicate — the copy may become the answering
        // replica, and its certificate would then be in the receipt.
        const candidates = speculativeCandidates(
          speculation.request,
          speculation.pool,
          speculation.attempted,
        )
        if (candidates.length === 0) {
          // Nowhere legal to duplicate to. For a sovereign shard whose owner has no spare
          // node this is the **correct outcome** and waiting is the only move — CHURN-06
          // holds here by there being no branch that could do anything else.
          watching = false
        } else {
          const slow = stragglers(
            [{ taskId: lease.taskId, nodeId: lease.nodeId, startedAt }],
            woke,
            { completed: speculation.completed, factor: speculation.factor },
          )
          // Too new to judge — no median yet, or not slow enough yet. Keep watching.
          if (slow.length > 0) {
            if (!speculation.ledger.request(lease.taskId)) watching = false
            else {
              const target = candidates[0] as NodeDescriptor
              speculated = true
              speculation.attempted.push(target.nodeId)
              const copy = dispatchCopy(dispatch, [target.nodeId], true)
              copies.set(target.nodeId, copy)
              // The lease is **not** moved. `LeaseTable` models one holder per task, and
              // a duplicate is a second copy inside one generation rather than a new
              // generation: the holder is unchanged, and the lease is closed against it
              // even when the copy is what answered.
            }
          }
        }
      }
    }

    // A `Sleep` port may return early; `shouldRenew` is the authority on whether this is
    // the renewal point, not the arithmetic that chose when to wake.
    if (!renewable || !shouldRenew(lease, woke)) continue

    if (!(await probeHolder(probe, lease.nodeId))) {
      // No evidence. **Not** a renewal, and not an expiry either — the holder keeps the
      // rest of its lease, which is the window in which a node that had just finished
      // and released its slot still answers in time.
      renewable = false
      continue
    }

    const renewed = leases.renew(lease.taskId, lease.nodeId, woke)
    if (renewed === null) return { kind: 'lapsed', speculated }
    lease = renewed
  }
}

/** Distinguishes the comparison window closing from a copy that answered inside it. */
const COMPARE_TICK: unique symbol = Symbol('compare-tick')

/** One shard's leftovers, and the answer they are to be measured against. */
interface ToCompare {
  readonly outstanding: readonly OutstandingCopy[]
  /** The shard's own settled result, or null where it reached no single agreed one. */
  readonly winnerCid: string | null
}

/**
 * A shard that has finished, before the copies it left running have been read.
 *
 * The two-stage shape is what the post-settle comparison needs and is not decoration: a
 * shard cannot report whether a copy disagreed until *every* shard has settled, because
 * that is when the losers are read, and a shard cannot wait for its own loser without
 * giving back the latency speculation exists to save.
 */
interface SettledShard extends ToCompare {
  readonly result: ShardResult
}

/**
 * Read every copy that lost, once every shard has settled — VER-01, CHURN-02.
 *
 * **This is what keeps `disagreed` reachable at all.** Breaking out of a speculative race
 * on the first arrival and dropping the copies still running is `coordinator.ts`'s
 * recorded original defect: timing alone then picks which of two different CIDs becomes
 * the answer and the run reports clean, which is majority-vote-by-race. So the winner
 * returns immediately — waiting for the loser would undo the whole latency saving, since
 * the loser is usually the straggler — and the comparison happens here, **after** the last
 * shard has finished, which costs nothing because the job was going to wait for its
 * slowest shard anyway. By now the losers have had that whole time to answer.
 *
 * **One window for the whole job, not one per copy.** The grace bounds the *comparison*
 * and never the result, and the question it answers — "have the leftovers arrived yet?" —
 * is asked once of all of them. A window per copy would multiply a bound that exists to
 * be a bound.
 *
 * A copy whose shard reached no single agreed result is `uncompared` and says so: there
 * is nothing for it to be compared *against*, which is a different fact from silence and
 * a different fact again from agreement.
 */
async function compareOutstanding(
  shards: readonly ToCompare[],
  clock: JobClock,
  graceMs: number,
): Promise<readonly (readonly SpeculativeCopy[])[]> {
  // No leftovers, or none with an answer to be measured against: no window is opened at
  // all. Every job that speculated nothing takes this branch, which is what keeps the
  // grace off the path of the jobs it has nothing to say about.
  if (!shards.some((shard) => shard.winnerCid !== null && shard.outstanding.length > 0)) {
    return shards.map((shard) =>
      shard.outstanding.map(
        (copy): SpeculativeCopy => ({
          nodeIds: copy.nodeIds,
          outcome: 'uncompared',
          reason: 'this shard reached no single agreed result to compare this copy against',
        }),
      ),
    )
  }

  const graceOver: Promise<typeof COMPARE_TICK> = clock.sleep(graceMs).then(() => COMPARE_TICK)
  return Promise.all(
    shards.map(async (shard) =>
      Promise.all(
        shard.outstanding.map(async (copy): Promise<SpeculativeCopy> => {
          if (shard.winnerCid === null) {
            return {
              nodeIds: copy.nodeIds,
              outcome: 'uncompared',
              reason: 'this shard reached no single agreed result to compare this copy against',
            }
          }
          const settled = await Promise.race<VerificationResult | typeof COMPARE_TICK>([
            copy.pending,
            graceOver,
          ])
          if (settled === COMPARE_TICK) {
            // Silence. **Not** evidence of agreement — recording it as agreement would
            // assert something nobody checked.
            return {
              nodeIds: copy.nodeIds,
              outcome: 'uncompared',
              reason: `this copy had not answered ${graceMs}ms after the job settled`,
            }
          }
          if (settled.status === 'insufficient') {
            // It answered, and what it said was that it failed. Neither silence nor
            // agreement, and its own bucket for that reason.
            //
            // **In the failing node's own words where it gave any.** `executeVerified`
            // composes `'every executor failed'` over the individual refusals, which names
            // the shape of the outcome and not its cause; a reader handed that sentence
            // learns nothing it did not already know from the bucket. Found by test, which
            // asserted the node's own sentence and got the composed one.
            return {
              nodeIds: copy.nodeIds,
              outcome: 'failed',
              reason:
                settled.failures.length === 0
                  ? settled.reason
                  : settled.failures
                      .map((failure) => `${failure.nodeId}: ${failure.reason}`)
                      .join('; '),
            }
          }
          if (settled.status === 'disagreed') {
            // A copy at redundancy > 1 whose own replicas split. Every distinct answer it
            // produced is named, because "it disagreed" without the CIDs is the reading
            // this whole mechanism exists to avoid.
            return {
              nodeIds: copy.nodeIds,
              outcome: 'disagreed',
              resultCid: settled.partitions.map((partition) => partition.resultCid).join(', '),
            }
          }
          const resultCid = settled.resultCid.toString()
          // Compared directly rather than through `settleRace`, and the reason is written
          // down because that function looks like the right tool. It re-derives the winner
          // from arrival instants and ties break on node id — so on a clock that reports
          // the same instant for both, it could name the *loser* as the winner, overturning
          // a decision this module has already taken and already closed a lease against.
          // The winner is known here; all that is left is whether the loser's bytes match.
          return resultCid === shard.winnerCid
            ? { nodeIds: copy.nodeIds, outcome: 'agreed' }
            : { nodeIds: copy.nodeIds, outcome: 'disagreed', resultCid }
        }),
      ),
    ),
  )
}

/** Ask the holder about this task's slot key. Any answer that is not the duplicate refusal is not evidence. */
async function probeHolder(
  probe: ((nodeId: string) => Promise<boolean>) | null,
  nodeId: string,
): Promise<boolean> {
  return probe === null ? false : probe(nodeId)
}

/** A job is no stronger than its weakest shard. */
function jobAttestationOf(shards: readonly ShardResult[]): ShardAttestation {
  const absent = shards.find((shard) => 'kind' in shard.attestation)
  if (absent !== undefined) return absent.attestation
  return shards.reduce((weakest, shard) => {
    if ('kind' in weakest.attestation || 'kind' in shard.attestation) return weakest
    return attestationRank(shard.attestation.strength) < attestationRank(weakest.attestation.strength)
      ? shard
      : weakest
  }, shards[0] as ShardResult).attestation
}

/**
 * Submit a job: shard it, place each shard, execute redundantly, verify, return CIDs.
 *
 * Shards run concurrently — they share no state by construction, which is the
 * whole reason the partition is the unit of parallelism.
 */
/**
 * The clock and the timer the lease deadline runs on — CHURN-04.
 *
 * **Both together or neither**, which is why they are one object rather than two
 * fields: a reading of "now" and a way to wait until later are two halves of one
 * account of time, and a fixture that replaced only one of them would be measuring a
 * virtual deadline against a real clock. Supplying this replaces both.
 *
 * **This is not the clock the certificate check uses**, and the two are deliberately
 * separate reads of different questions. `submitJob` asks `Date.now()` once, for
 * whether a certificate's validity window is open — a point in time judged against
 * fixed instants somebody else minted. This one measures *elapsed* time against a
 * deadline this module granted, which is a different question and needs a different
 * answer in a test: a fixture that advanced the lease clock by thirty seconds must not
 * thereby expire the certificates it enrolled.
 *
 * Optional, and the default is not a policy: `Date.now` and `setTimeout`. Nothing about
 * the job's behaviour changes with it — it is the platform, supplied so a churn
 * reading can be a deterministic sequence of events rather than a race against a real
 * clock, the same discipline `coordinator.ts` and `EnrollmentAuthority` already use.
 */
export interface JobClock {
  /** Reads the requestor's own clock, in milliseconds. */
  readonly now: () => number
  /** Resolves after at least `ms`. */
  readonly sleep: Sleep
}

/**
 * The dials on straggler duplication — CHURN-02.
 *
 * Every one defaults to the exported constant beside it, and every one is here rather
 * than on `JobSpec` because they are the *requestor's* cost/latency preferences about
 * its own job, not facts the fabric needs told. A knob nobody sets drifts from the tests,
 * so these exist for the measurement 20-09 makes and for the fixtures that prove the
 * mechanism, not as a configuration surface.
 */
export interface SpeculationOptions {
  /** Extra dispatches allowed, as a fraction of the shard count. `DEFAULT_SPECULATION_FRACTION`. */
  readonly fraction?: number
  /** How much slower than the median a shard must be. `DEFAULT_STRAGGLER_FACTOR`. */
  readonly factor?: number
  /** Poll interval, and the floor on how fast a straggler can be spotted. */
  readonly watchdogMs?: number
  /**
   * Extra time a losing copy gets to answer once every shard has settled.
   *
   * Bounds the **comparison** and never the result: the winner is already decided and
   * already returned. A copy that misses this window is reported `uncompared`.
   */
  readonly compareGraceMs?: number
}

export interface SubmitOptions {
  /**
   * Straggler duplication, or the named statement that this caller wants none — CHURN-02.
   *
   * **`'duplicates-no-stragglers'` is a value a caller writes, not an omission**, and the
   * asymmetry with the omitted case is deliberate. Omitting this leaves the module's own
   * stated policy in force — the exported constants, which are what
   * `DEFAULT_MAX_GENERATIONS` is to the generation loop. Writing the literal turns
   * duplication off entirely, and that arm exists because **a cost that cannot be turned
   * off cannot be measured**: 20-09 compares a job against itself with and without it,
   * and a fabric with no off switch has no such comparison to make.
   *
   * ## What "on by default" actually costs, measured rather than asserted
   *
   * `DEFAULT_SPECULATION_FRACTION` is 0.1 and the budget is `floor(shards × fraction)`,
   * so **a job of fewer than ten shards has an allowance of zero** and cannot duplicate
   * anything however slow it gets. Below that threshold the watchdog is not even started,
   * so such a job's dispatch waits on exactly the two instants the lease loop already had
   * — the renewal point and the deadline. That is most of the jobs in this repository,
   * and it is why turning this on changed nothing that was not about speculation.
   *
   * Above it, each outstanding dispatch also wakes every `watchdogMs` while a duplicate
   * is still possible, and stops waking once one has been started, the budget is gone, or
   * there is nowhere legal left to duplicate to. Waking is not the same as speculating: a
   * shard must additionally be slower than `factor` × the median of what has finished,
   * and until `MIN_SAMPLES` shards have finished there is no median and nothing is
   * duplicated.
   */
  readonly speculation?: SpeculationOptions | 'duplicates-no-stragglers'
  /**
   * The clock and timer the lease deadline runs on. See {@link JobClock}.
   *
   * Omit outside a test. The default sleeps on an **unref'd** `setTimeout` where the
   * platform has one, so a wait this module abandoned — the ordinary case, since a
   * dispatch that answers wins its race — cannot hold a Node process open past the job
   * it belonged to.
   */
  readonly clock?: JobClock
  /**
   * Where to record that a shard's bytes are sovereign — DATA-10's at-rest half.
   *
   * Optional, and the omission is real rather than a hole: `task-worker.ts` hard-codes
   * `label:'public'` shards into a `MemoryBlockstore`, so it has nothing sovereign to
   * record and no durable place to record it. A caller handling sovereign shards that
   * omits this keeps the pre-13.1 behaviour — it holds the row and nothing guards it —
   * which is why `sovereign-block-refusal.node.test.ts` pins the set of files allowed to
   * call this function at all.
   */
  readonly sovereignCids?: { add(cid: string): Promise<void> }
  /**
   * Where this job's checkpoint handles go as they are written, or the named statement
   * that this caller keeps none — CHURN-03.
   *
   * A handle is a CID and nothing else; the block it names lives in the same `blockstore`
   * every shard input and every agreed output goes to. **Reused rather than given its own
   * store**, because a second store would be a second place the same bytes live, and the
   * one property that makes a checkpoint cheap is that it is content-addressed like
   * everything else.
   *
   * ## Why the handle leaves through here and not on `JobResult`
   *
   * **The case this exists for is the case that never returns a `JobResult`.** A requestor
   * that departs mid-job never reaches the end of `submitJob`, so a handle carried on the
   * result would be a handle nobody with a use for it ever sees. It has to escape the
   * process *as it is written*, which is what makes this a sink and not a field.
   *
   * ## Optional until 2026-08-05, and required after — the argument, then the ruling
   *
   * **Retained for the reasoning, not the verdict.** This was decided and not defaulted,
   * so what stood here is kept in full rather than replaced by its outcome. A reader who
   * only meets the current shape cannot tell which objections were weighed and which were
   * never raised.
   *
   * ### The case for optional, as it was written
   *
   * `JobSpec.onQuorumShortfall` is required because omitting it would let every existing
   * call site *mean* `degrade` without saying so — a position held by callers who never
   * stated one. **There is no equivalent position here.** Omitting this means no block is
   * written and no handle is published; nothing is claimed on the caller's behalf, and no
   * field of the result changes. It is the absence of a destination for bytes, not a
   * silent answer to a question.
   *
   * {@link SubmitOptions.sovereignCids} is the precedent that fits, and it fits on both
   * halves. Its argument is that the omission is *real* for a specific caller —
   * `task-worker.ts` submits into a `MemoryBlockstore` — and that is exactly true here: a
   * checkpoint written into a store that dies with the process is a checkpoint of nothing.
   * Requiring such a caller to name a destination it does not have would be requiring it
   * to state a falsehood.
   *
   * The alternative was `checkpoints: CheckpointSink | 'checkpoints-nothing'` — a required
   * union with a named sentinel and a five-site fan-out, `onQuorumShortfall`'s shape. It
   * was rejected on the merits above, **and** it was out of reach regardless: the five
   * sites were not that plan's files, and two of them (`bin/bench.ts`,
   * `perf-workload.ts`) have their argument lists count-pinned by
   * `serve-agent-hooks.node.test.ts`. Both halves were recorded so nobody would read the
   * constraint as the argument.
   *
   * ### The ruling — repository owner, 2026-08-05
   *
   * **Overruled, and the rejected alternative is what ships.** Two things the case above
   * did not weigh:
   *
   * 1. **Silence and consent were indistinguishable.** The argument turns on omission
   *    claiming nothing, and that is true of the *bytes* — no block is written either way.
   *    It is not true of the *reader*. A submitter that omits this and a submitter that
   *    weighed checkpointing and declined are the same text, so no reader and no guard can
   *    separate a decision from an oversight. `onQuorumShortfall`'s rule was applied too
   *    narrowly: what it forbids is not silently meaning `degrade`, it is a caller holding
   *    a position it never stated. Not checkpointing is such a position.
   * 2. **The write half went thirteen phases with no production caller.** The `sovereignCids`
   *    precedent assumes the option is reached by *someone*, so the omitting caller is the
   *    exception. Here every production submitter omitted it and the recovery half was
   *    proven against sinks that exist only in tests. That is the "Built, not wired" shape
   *    this milestone exists to remove, and an optional field is how it stayed invisible:
   *    `npx tsc --noEmit` exited **0** across the whole tree while nothing anywhere wrote a
   *    checkpoint.
   *
   * **The falsehood objection is answered by the shape rather than waived, and this is the
   * whole point of a named sentinel.** `'checkpoints-nothing'` is not a destination
   * `task-worker.ts` does not have — it is an accurate statement about a caller that keeps
   * none, in the same idiom as `'duplicates-no-stragglers'` one field up,
   * `'serves-unauthenticated'` in `AgentOptions` and `'admits-any-peer'` in
   * `FabricNodeOptions`. A caller submitting into a `MemoryBlockstore` writes it and states
   * a truth. What it can no longer do is state nothing.
   *
   * **The count-pin the argument above cited as making this out of reach did not bind, and
   * that was measured rather than assumed.** `serve-agent-hooks.node.test.ts` was expected
   * to go red on `bin/bench.ts` and `perf-workload.ts`; it was run against the finished
   * change and passed 11/11 untouched. The prediction misread what that file pins: it
   * counts `serveAgent` hook *sentinel substrings* (`'keeps-no-ledger'`,
   * `'serves-unauthenticated'`, `'signs-nothing'` — 2 each in both files) and the argument
   * lines of `authorizeCapability({…})` / `ownStartOutcome`. It does not read
   * `submitJobWithEgress`'s argument list at all, so a fourth argument there moves no
   * count, and `'checkpoints-nothing'` is a string it never counted. **No expected count in
   * that file was moved, and none needed to be.** The half of the original argument that
   * held is the other half: five sites is a real fan-out, and it came to 5 production call
   * sites in 4 files plus this wrapper — the stated number, verified rather than trusted.
   *
   * ## What this does NOT do — do not read it as more than it is
   *
   * **Requiring the field does not make the write half reachable.** Every production
   * submitter now says `'checkpoints-nothing'` explicitly instead of saying nothing; not
   * one supplies a real sink, so no checkpoint block is written by anything an operator
   * runs, and ROADMAP criterion 7 stays **PARTIAL**. What changed is that a *future*
   * submitter must decide, and that a new opt-out is visible rather than silent —
   * `checkpoint-optout-scope.node.test.ts` pins the set of production files allowed to say
   * the sentinel, on `sovereign-block-refusal.node.test.ts`'s model. Closing the criterion
   * needs a runnable entry point holding a store that outlives its process; that is a
   * separate ruling and is not this field's doing.
   */
  readonly checkpoints: CheckpointSink | 'checkpoints-nothing'
  /**
   * Checkpoint handles to resume from, **newest first** — CHURN-03.
   *
   * The ordinary case is one CID: a requestor that departed published a handle, and a
   * second requestor knowing only that CID and this job's spec runs the shards the
   * checkpoint does not name. More than one is the recovery case — `recoverCheckpoint`
   * takes the newest readable handle and says how many it had to skip, because a chain
   * cannot be walked backwards past a block that is gone.
   *
   * **This is not a second job entry point.** WIRE-04's wording is *"without the caller
   * choosing between two functions"*, and a starting state is not a second function: the
   * shards this does not carry go down the *same* placement, lease, dispatch, speculation
   * and coverage path every other shard takes, in the same call. A shard that a resume
   * skips reports {@link ShardEnding} `'carried-from-checkpoint'` and nothing else about
   * this module changes.
   *
   * A resume against a handle that is not a checkpoint of *this* job is refused by name —
   * see {@link SubmitError} `'checkpoint-unreadable'` and `'checkpoint-names-another-job'`.
   * A resume of a job the checkpoint says is finished dispatches nothing, which is a
   * measured no-op rather than a special case: every partition is carried, so there is
   * nothing left for the loop to place.
   */
  readonly resumeFrom?: readonly CID[]
}

export async function submitJob(
  spec: JobSpec,
  blockstore: Blockstore,
  // Required since 2026-08-05, and required *because* one of its fields is. A bag that
  // may be omitted entirely cannot carry a mandatory field: `submitJob(spec, store)` would
  // still compile and still write no checkpoint, which is precisely the silence
  // {@link SubmitOptions.checkpoints}'s ruling removed — the requirement would have been
  // escapable by dropping one argument. Both cited precedents are shaped this way:
  // `AgentOptions.ledger` sits in a required `options: AgentOptions`, and
  // `FabricNodeOptions.relayAdmission` in the required literal `FabricNode.start` takes.
  options: SubmitOptions,
): Promise<SubmitResult> {
  if (spec.shards.length === 0) return { ok: false, error: { kind: 'no-shards' } }
  if (!Number.isInteger(spec.redundancy) || spec.redundancy < 1) {
    return { ok: false, error: { kind: 'bad-redundancy', redundancy: spec.redundancy } }
  }

  const execByNodeId = new Map(spec.executors.map((e) => [e.nodeId, e] as const))
  // Beside it, and for the receipt rather than for placement: the descriptor is where
  // this requestor's certificate for a node lives, and therefore where the question
  // "did the node that answered me answer under the certificate I discovered it with?"
  // is settled. See {@link receiptFor}.
  const descriptorByNodeId = new Map(spec.nodes.map((n) => [n.nodeId, n] as const))
  for (const executor of spec.executors) {
    if (!spec.nodes.some((n) => n.nodeId === executor.nodeId)) {
      return { ok: false, error: { kind: 'missing-node-descriptor', nodeId: executor.nodeId } }
    }
  }
  // Descriptors with no matching executor are simply excluded from placement —
  // a known node that isn't participating in this job, not an error.
  const candidateNodes = spec.nodes.filter((n) => execByNodeId.has(n.nodeId))

  for (const [i, shard] of spec.shards.entries()) {
    if (shard.label === 'sovereign' && (typeof shard.ownerId !== 'string' || shard.ownerId.length === 0)) {
      return { ok: false, error: { kind: 'shard-missing-owner', partitionIndex: i } }
    }
  }

  const partitionCount = spec.shards.length

  // One instant for the whole job, so two shards cannot disagree about whether a
  // certificate had expired.
  //
  // **This module reads the wall clock, once, and nothing else about it.** It is the
  // first read of a platform clock in `packages/core/src`, and it is deliberate rather
  // than incidental: deciding whether a certificate's validity window is open is the
  // *requestor's* call about its own willingness to count a statement, which is the same
  // call `peer-verifier.ts` makes with `Date.now()` directly. The alternatives were both
  // worse. A clock on `SubmitOptions` would be omittable by omitting the object — the
  // required-field-inside-an-optional-object defect, one level down. A clock on `JobSpec`
  // would be a ninety-four-site fan-out for a value every one of them would fill with
  // this same expression.
  const now = Date.now()

  // The lease clock is a **separate read of a different question** — elapsed time
  // against a deadline this module granted, not a point judged against certificate
  // windows somebody else minted. See {@link JobClock}.
  //
  // **Speculation reads this one, not a third.** It asks the same *kind* of question the
  // lease asks — how long has this been running, against a span measured in this
  // process — so a fixture that advances the lease clock advances the straggler
  // threshold with it, which is the only way the two can be reasoned about together.
  // The certificate instant above stays a single `Date.now()` read for the whole job:
  // it judges validity windows somebody else minted, and a job that took a virtual
  // thirty seconds to duplicate a straggler must not thereby expire the certificates it
  // enrolled.
  const clock = options.clock ?? platformClock

  // ── The speculation budget — CHURN-02 ──────────────────────────────────────────────
  //
  // **Job-wide and shared across shards**, because a per-shard budget would let a job
  // with many shards duplicate every one of them and still call each duplicate within
  // its allowance. `speculation.ts`'s own words: *"the budget is a fraction of the job's
  // task count, held once for the whole job, and every duplicate spends from it."*
  //
  // The off arm is a fraction of zero rather than a second flag: the allowance is
  // `floor(tasks × fraction)`, so zero refuses every request, and the multiplier is still
  // the identity `1` — which is what an off arm has to report if it is to be compared
  // against an on one.
  const dial: SpeculationOptions =
    options.speculation === undefined || options.speculation === 'duplicates-no-stragglers'
      ? {}
      : options.speculation
  const ledger = new SpeculationLedger({
    tasks: partitionCount,
    fraction:
      options.speculation === 'duplicates-no-stragglers'
        ? 0
        : (dial.fraction ?? DEFAULT_SPECULATION_FRACTION),
  })
  // A job that could not duplicate anything does not watch for stragglers either. That
  // is not an optimisation with a behavioural edge: `ledger.request` would refuse every
  // one of them anyway, and skipping the watchdog keeps every job below the fraction's
  // threshold — which is most of them — on exactly the wake schedule it had before.
  const speculationEnabled = ledger.allowance > 0
  /**
   * Durations of the shards that have finished, shared so the median means something.
   *
   * Job-wide by construction: a shard is a straggler *relative to its peers*, and a
   * per-shard list would have no peers in it.
   */
  const completedDurations: number[] = []

  // One table for the whole job, because the bound it enforces is per task and its
  // history is the job's. `DEFAULT_MAX_GENERATIONS` is named rather than defaulted into:
  // it is the policy this loop runs on, `submit.test.ts` asserts the attempt count
  // against that same exported constant, and a cap reached by omission is a cap nobody
  // stated. `runResilient` sized its own table to the node pool instead, deliberately —
  // there the pool was the real bound and the table a backstop; here the table IS the
  // bound, for the reason `DEFAULT_MAX_GENERATIONS`' docblock gives. (Past tense since
  // Plan 20-12: that module is deleted, and this is the contrast that explains the
  // choice rather than a live alternative.)
  const leases = new LeaseTable({ maxGenerations: DEFAULT_MAX_GENERATIONS })

  // Persist every shard input as a block first, so a task is addressed entirely
  // by CID and could be re-dispatched to any node without resending the payload.
  const inputCids: CID[] = []
  for (let i = 0; i < partitionCount; i++) {
    const encoded = await canonicalCid((spec.shards[i] as ShardSpec).value)
    if (!encoded.ok) {
      return {
        ok: false,
        error: {
          kind: 'input-not-encodable',
          partitionIndex: i,
          detail: JSON.stringify(encoded.error),
        },
      }
    }
    await blockstore.put(encoded.bytes)
    // DATA-10, and this is the boundary the node owns. `submit-with-egress.ts` names it
    // as the fix a later phase would make, in exactly these words: *register at a boundary
    // the node owns — the blockstore-put of a shard labelled sovereign*.
    //
    // Here rather than in the guarded wrapper, because THIS is the line that makes the
    // submitter hold the row. A submitter reaching the fabric through bare `submitJob`
    // used to put another owner's raw bytes into its own store and record nothing, and
    // `sovereignty-placement.node.test.ts` has been driving that path and passing for
    // exactly that reason. Registering where the put happens covers every caller instead
    // of every caller that remembered.
    //
    // The bytes are already in hand, so this costs a set insert and one append — the
    // second canonicalisation `submit-with-egress.ts` pays is not repeated here.
    if ((spec.shards[i] as ShardSpec).label === 'sovereign' && options.sovereignCids !== undefined) {
      await options.sovereignCids.add(encoded.cid.toString())
    }
    inputCids.push(encoded.cid)
  }

  // ── Checkpointing and resume — CHURN-03 ────────────────────────────────────────────
  //
  // Here rather than earlier because the job's identity is derived from the *input CIDs*,
  // which do not exist until the loop above has canonicalised every shard. That ordering
  // is what makes the id a fact about the job's content rather than about its spelling:
  // two callers that shard the same data into the same partitions derive the same id
  // however they built the values. See {@link jobIdOf}.
  const jobId = await jobIdOf(spec.moduleCid, inputCids)
  const resumed = await resumeState(options.resumeFrom, blockstore, jobId, partitionCount)
  if (!resumed.ok) return { ok: false, error: resumed.error }
  const carried = resumed.carried
  // Explicit on both arms: the sentinel is a value the caller wrote, not an absence this
  // line inferred. Reading it as `!== undefined` would put the two back together — a
  // caller that named `'checkpoints-nothing'` and a caller that named nothing would take
  // the same branch for different reasons, which is the distinction the field was made
  // required to hold. See {@link SubmitOptions.checkpoints}.
  const checkpoints: CheckpointLog =
    options.checkpoints === 'checkpoints-nothing'
      ? NO_CHECKPOINTS
      : checkpointLogOf(
          options.checkpoints,
          blockstore,
          { jobId, moduleCid: spec.moduleCid.toString(), partitionCount },
          clock,
          [...carried].map(([partitionIndex, shard]) => ({
            partitionIndex,
            resultCid: shard.resultCid.toString(),
          })),
          resumed.from,
        )

  // Placement pass — TWO ARRANGEMENTS OF ONE GATE, selected by whether the caller
  // supplied a way to ask a node anything. What the two arms share is the whole of
  // the rule: both build their `PlacementRequest`s through the same `requestFor`,
  // both hand them to a placer whose first act is `eligibleNodes`, and neither
  // re-derives who could run a shard — this module's standing rule, stated at
  // :11-14. What differs is only how an already-eligible set is narrowed to a
  // choice. They are alternatives and are never composed; `JobSpec.admit`'s doc
  // carries the line that makes composing them lose the re-pick.
  //
  // ── The quorum gate — VER-03, VER-04 ──────────────────────────────────────────────
  //
  // It sits HERE, above the arm selection, so both arms receive the same narrowed pool
  // and neither can drift from the other. It narrows an already-eligible set by a
  // constraint placement has no way to express; it does not re-derive who *could* run a
  // shard, so this module's standing rule at :11-14 is intact. And it is applied
  // **before** the load preference, never after: a hard constraint applied after a
  // preference is not a constraint, a shape this repository has recorded twice — NET-08's
  // cap after the loop and 16-06's bound below the fetch.
  //
  // A quorum is composed for a shard only when all three of these hold, and each is
  // written out because each will look like an escape hatch to somebody who does not
  // know why it is there:
  //
  //   1. **`label: 'public'`.** A sovereign shard runs on one owner's own nodes and
  //      therefore has one operator, so `composeQuorum` — which holds one certificate
  //      per operator by construction — would refuse it with `insufficient-operators`,
  //      correctly and uselessly. This is `PROJECT.md`'s split expressed in a branch
  //      rather than in prose: public data gets N-version redundancy across operators,
  //      sovereign data is owner-attested with the aggregation over it verified. Remove
  //      this condition and `owner-domain` becomes unreachable, which is the single most
  //      likely way to get this whole thing wrong.
  //   2. **`redundancy >= 2`.** At redundancy 1 there is no verification — VER-06 makes
  //      it a dial reaching 1, off — and so no quorum to compose. This is the ruling's
  //      first opt-out, and it yields `owner-attested`.
  //   3. **Every candidate carries a certificate.** A requestor holding none cannot
  //      compose anything, and refusing its job would break every caller that builds its
  //      descriptors through `publicNodes`. This is the condition most in need of its
  //      argument written down, so: it is **not** a silent degradation, because the
  //      receipt reports the named absence on every shard of such a job — a caller that
  //      supplies no certificates gets a result that says no attestation was established.
  //      `submitJob` runs in the requestor's own process and a requestor that supplies
  //      nothing bounds only its own claim, which is the same argument `JobSpec.admit`'s
  //      doc already makes for itself.
  //
  // The composition itself is job-level because its input is: the candidate pool is the
  // same for every shard, so `composeQuorum` would return the same answer per shard.
  // Computed once and applied per shard by label.
  const certificated = candidateNodes.flatMap((node) =>
    node.certificate === 'carries-no-certificate' ? [] : [node.certificate],
  )
  // VER-03 — the one place in the fabric that holds both spellings of a node at once.
  //
  // `NodeCertificate` names a node by `nodeKey` (an ed25519 public key) and names relays
  // by **peer id**; `NodeDescriptor` carries the peer id as `nodeId` beside the very
  // certificate that key came from. So the mapping `composeQuorum` needs to see that the
  // relay every other member depends on is *itself* a member exists here and nowhere
  // else — core cannot derive one from the other without importing libp2p, which
  // `CLAUDE.md`'s one-codebase constraint forbids in this package.
  //
  // Built over `candidateNodes` rather than over `spec.nodes`, so it covers exactly the
  // certificates handed to the composer and no others. A certificate the map does not
  // know answers `null`, which `sharedRelay` treats as *no match* — never as a match
  // against another unknown.
  const peerIdByNodeKey = new Map<string, string>()
  for (const node of candidateNodes) {
    if (node.certificate !== 'carries-no-certificate') {
      peerIdByNodeKey.set(node.certificate.nodeKey, node.nodeId)
    }
  }
  const composition =
    candidateNodes.length > 0 && certificated.length === candidateNodes.length && spec.redundancy >= 2
      ? composeQuorum(certificated, {
          size: spec.redundancy,
          peerIdOf: (certificate) => peerIdByNodeKey.get(certificate.nodeKey) ?? null,
        })
      : null
  // The members' descriptors, in the pool's own order. One array, shared by every shard
  // that composes, which is what lets the offer arm group by pool identity below.
  const quorumPool: readonly NodeDescriptor[] =
    composition !== null && composition.ok
      ? ((keys) =>
          candidateNodes.filter(
            (node) => node.certificate !== 'carries-no-certificate' && keys.has(node.certificate.nodeKey),
          ))(new Set(composition.members.map((member) => member.nodeKey)))
      : candidateNodes

  const gates = spec.shards.map((shard): ShardGate => {
    if (shard.label !== 'public') {
      return {
        quorum: {
          kind: 'not-attempted',
          reason:
            'a sovereign shard runs on its owner’s own nodes, which is one operator — the ' +
            'composer would refuse it correctly and uselessly, so it is never handed one',
        },
        pool: candidateNodes,
        degraded: false,
        refusal: null,
      }
    }
    if (spec.redundancy < 2) {
      return {
        quorum: {
          kind: 'not-attempted',
          reason: 'redundancy 1 asks for no verification, so there is no quorum to compose',
        },
        pool: candidateNodes,
        degraded: false,
        refusal: null,
      }
    }
    if (composition === null) {
      return {
        quorum: {
          kind: 'not-attempted',
          reason:
            'this requestor holds no certificate for at least one candidate, so it has nothing ' +
            'to compose a quorum from — the receipt reports the named absence rather than a strength',
        },
        pool: candidateNodes,
        degraded: false,
        refusal: null,
      }
    }
    if (composition.ok) {
      // The narrowing costs the offer arm its re-pick **on this shard**: with the pool
      // equal to the quorum, a member that refuses leaves nothing to re-pick onto and the
      // shard comes back unplaceable naming the refusal. That is a worse liveness answer
      // and a strictly better correctness one, and the trade is written here rather than
      // discovered later. If a later phase wants both, the mechanism is a larger quorum
      // with a chosen subset — a new decision, not a widening of this one. Note what the
      // cost is not: a shard that degraded keeps the full eligible pool and therefore
      // keeps its re-pick, so the liveness is paid by exactly the callers who got the
      // stronger guarantee.
      return {
        quorum: { kind: 'composed', operators: composition.operators },
        pool: quorumPool,
        degraded: false,
        refusal: null,
      }
    }
    // Composition was attempted and refused, so there is a shortfall and the dial is
    // consulted — here and only here. It is not read where no quorum was attempted,
    // because there was nothing to fall short of.
    return {
      quorum: { kind: 'not-composed', refusal: composition.refusal, reason: composition.reason },
      pool: candidateNodes,
      degraded: spec.onQuorumShortfall === 'runs-at-available-redundancy',
      refusal: spec.onQuorumShortfall === 'refuses-the-shard' ? composition.reason : null,
    }
  })

  const shardPlacements: Placement[] = []
  // One empty list per shard. On the no-offer arm that is what survives, and it is a
  // truthful reading rather than a default: no offer was made, so nothing refused.
  let shardRejections: readonly (readonly Rejection[])[] = spec.shards.map(() => [])

  if (spec.admit === undefined) {
    // Sequential and synchronous; only execution below needs concurrency.
    // `dispatchCount` spreads shards across a public job's node set the way the old
    // round-robin did, by nudging the load `planPlacement` orders on — it can never
    // widen who is *eligible*, only reorder who is chosen first among
    // already-eligible nodes.
    const dispatchCount = new Map<string, number>()
    for (let i = 0; i < partitionCount; i++) {
      // A carried shard is not placed, and therefore takes no `dispatchCount` nudge: it
      // is not competing for a node, so counting it would spread the shards that *are*
      // against load nobody is about to apply. This entry is never read — the per-shard
      // loop below answers a carried partition before it looks at a placement — and it is
      // still written truthfully rather than left as a hole, because "never read" is a
      // property of today's control flow and not of the value.
      if (carried.has(i)) {
        shardPlacements.push({ shardId: String(i), status: 'unplaceable', reason: CARRIED_NOT_PLACED })
        continue
      }
      const gate = gates[i] as ShardGate
      if (gate.refusal !== null) {
        // The caller's stated preference, in the composer's own words. Nothing else
        // licenses a refusal here.
        shardPlacements.push({ shardId: String(i), status: 'unplaceable', reason: gate.refusal })
        continue
      }
      const shard = spec.shards[i] as ShardSpec
      const request = requestFor(shard, String(i), spec.redundancy)
      const nodesForShard = gate.pool.map((n) => ({
        ...n,
        load: n.load + (dispatchCount.get(n.nodeId) ?? 0),
      }))
      const plan = planPlacement([request], nodesForShard)
      const placement = plan.placements[0] as Placement
      if (placement.status === 'placed') {
        for (const nodeId of placement.nodeIds) {
          dispatchCount.set(nodeId, (dispatchCount.get(nodeId) ?? 0) + 1)
        }
      }
      shardPlacements.push(placement)
    }
  } else {
    // `d` is deliberately not a `JobSpec` field: `placeWithOffers` defaults to
    // `DEFAULT_D`, and what SCHED-02 asks is that placement sample *multiple*
    // candidates — which two is. A knob nobody sets is a knob that drifts from the
    // tests. There is no `dispatchCount` nudge here either: the offer arm's spread
    // comes from the per-shard rendezvous ranking and from the headroom each node
    // published, both of which are better information than a local tally.
    //
    // **Grouped by pool, because `planWithOffers` takes one pool for a whole job and
    // keeps its cross-shard headroom tally inside a single call.** A per-shard pool
    // therefore cannot be expressed by narrowing its argument. There are at most two
    // distinct pools in any job — the composed quorum, and the full candidate set every
    // sovereign or degraded shard keeps — so the requests are grouped by the array they
    // were handed and each group makes one call. **With one pool this is the single call
    // it replaces, in shard order, byte for byte**, which is every job that composes
    // nothing and every all-public job that does. With two, a node's published headroom
    // is tallied within each group and not across them; that is recorded here rather than
    // found later, and the alternative — one call per shard — would lose the tally
    // altogether, which is a bound `18-04` measured and this module inherits.
    const byPool = new Map<readonly NodeDescriptor[], number[]>()
    for (let i = 0; i < partitionCount; i++) {
      const gate = gates[i] as ShardGate
      // A carried shard makes **no offer**, which is the reading that distinguishes a
      // resume from a restart at the wire and not merely in this process: a node is never
      // asked about a partition somebody else already answered.
      if (carried.has(i) || gate.refusal !== null) continue
      const group = byPool.get(gate.pool)
      if (group === undefined) byPool.set(gate.pool, [i])
      else group.push(i)
    }

    const placedByShard = new Map<number, Placement>()
    const rejectionsByShard: (readonly Rejection[])[] = spec.shards.map(() => [])
    for (const [pool, indices] of byPool) {
      const requests = indices.map((i) =>
        requestFor(spec.shards[i] as ShardSpec, String(i), spec.redundancy),
      )
      const offered = await planWithOffers(requests, pool, { admit: spec.admit })
      for (const [k, shardIndex] of indices.entries()) {
        const placement = offered[k]
        if (placement === undefined) continue
        placedByShard.set(shardIndex, placement)
        rejectionsByShard[shardIndex] = placement.rejections
      }
    }
    for (let i = 0; i < partitionCount; i++) {
      const gate = gates[i] as ShardGate
      shardPlacements.push(
        carried.has(i)
          ? { shardId: String(i), status: 'unplaceable', reason: CARRIED_NOT_PLACED }
          : gate.refusal !== null
            ? { shardId: String(i), status: 'unplaceable', reason: gate.refusal }
            : (placedByShard.get(i) as Placement),
      )
    }
    shardRejections = rejectionsByShard
  }

  const settledShards = await Promise.all(
    inputCids.map(async (inputCid, partitionIndex): Promise<SettledShard> => {
      // ── The resume, and it is the whole of it — CHURN-03 ──────────────────────────
      //
      // Answered **before** the placement is read, because a carried shard has no
      // placement to read. This is the only branch a resume adds to the dispatch path:
      // everything below is what a fresh job does, unchanged, over the partitions the
      // checkpoint did not name. `remainingWork` is not called here and does not need to
      // be — it enumerates the complement of `completed`, and iterating every partition
      // and skipping the carried ones **is** that complement, computed once instead of
      // built into a list and then searched.
      const already = carried.get(partitionIndex)
      if (already !== undefined) {
        const result = carriedResult(partitionIndex, inputCid, already)
        return { outstanding: [], winnerCid: already.resultCid.toString(), result }
      }

      const placement = shardPlacements[partitionIndex] as Placement
      const rejections = shardRejections[partitionIndex] as readonly Rejection[]
      if (placement.status === 'unplaceable') {
        const unplaceable: ShardResult = {
          partitionIndex,
          inputCid,
          // The reason reaches the caller exactly as an unplaceable shard's always
          // has; what is new is that the refusals that produced it are visible
          // beside it, so "nobody would take it" is distinguishable from "there was
          // nobody".
          verification: { status: 'insufficient', reason: placement.reason, failures: [] },
          // Nothing was ever asked, so nothing was attempted and no generation ran. `0`
          // here is a measured count, not a placeholder: a shard that was never placed
          // is a different fact from one that was placed and failed everywhere, and
          // `ending` names which of the two this is.
          attempted: [],
          generations: 0,
          ending: 'never-placed',
          // Nothing ran, so nothing was slow, so nothing was duplicated. Measured
          // readings rather than placeholders, in the same spirit as `generations: 0`.
          speculated: false,
          disagreed: false,
          copies: [],
          // A shard that never ran has no result to describe, so this stays what it has
          // always been on this arm. The record of *why* is on `quorum` beside it, in the
          // composer's own words when a caller asked for refusal.
          degraded: false,
          quorum: (gates[partitionIndex] as ShardGate).quorum,
          rejections,
          attestation: noAgreementToAttest('unplaceable'),
        }
        return { outstanding: [], winnerCid: null, result: unplaceable }
      }

      const shard = spec.shards[partitionIndex] as ShardSpec
      // Built once and spread into both branches. Never `moduleRecord: spec.moduleRecord`
      // inline — see `requestFor` above for why an explicit `undefined` is a different
      // thing here from an omitted field; downstream, `encodeRequest` would put the
      // first on the wire as a present-but-empty key.
      const provenance = spec.moduleRecord === undefined ? {} : { moduleRecord: spec.moduleRecord }
      const task: Task =
        shard.label === 'sovereign'
          ? {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
              ownerId: shard.ownerId,
              ...provenance,
            }
          : {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
              ...provenance,
            }
      // ── The generation loop — WIRE-04, CHURN-01, CHURN-04 ────────────────────────
      //
      // One shard, one task id, one lease at a time. Each pass places (the first pass
      // is the job-level placement above, already done), grants a lease, dispatches
      // under it, and decides whether there is anything left to try.
      //
      // The loop has exactly three exits and each is named on `ending`:
      //   - the shard agreed at the redundancy it asked for, or disagreed;
      //   - `placeAgain` found no untried eligible node;
      //   - `leases.grant` returned null — the generations are spent, or the task is
      //     already complete.
      // Nothing else ends it. In particular no counter is kept here: the bound lives in
      // the lease table, which is also where it is *recorded*, so "why did this shard
      // stop" is answered by the same structure that stopped it.
      const gate = gates[partitionIndex] as ShardGate
      const shardId = String(partitionIndex)
      const slotKey = capacitySlotKey(inputCid, partitionIndex)
      // The evidence channel, or the stated absence of one. `spec.admit` is the only way
      // this requestor can ask a node anything; with none supplied there is nothing to
      // probe with and a lease can only lapse. See {@link JobSpec.admit}.
      const askNode = spec.admit
      const probe: ((nodeId: string) => Promise<boolean>) | null =
        askNode === undefined
          ? null
          : async (nodeId: string): Promise<boolean> => {
              try {
                const answer = await askNode({ shardId: slotKey, nodeId })
                return !answer.accepted && answer.reason === inFlightRefusal(slotKey)
              } catch {
                // A probe that threw told this requestor nothing. Silence with extra
                // steps is still silence, and it is not evidence of work in progress.
                return false
              }
            }

      const attempted: string[] = []
      const collectedRejections: Rejection[] = [...rejections]
      const outstanding: OutstandingCopy[] = []
      let verification: VerificationResult | null = null
      let generations = 0
      let speculated = false
      let placementDegraded = placement.degraded
      let nodeIds: readonly string[] = placement.nodeIds
      let ending: ShardEnding = 'no-untried-node'

      // Built once per shard, not per generation and not per poll. The copy of a slow
      // shard goes through **this same call** with its own executor set, so a speculative
      // copy of a redundancy-2 shard is verified on exactly the terms anything else is and
      // no second verification path appears.
      const runOn = (on: readonly string[]): Promise<VerificationResult> => {
        const chosen = on.map((nodeId) => execByNodeId.get(nodeId) as Executor)
        // ── VER-02: which of the two verification paths this dispatch takes ─────────
        //
        // Three conditions, and each one is a separate refusal to over-claim:
        //
        // - **`label === 'public'`.** `.planning/PROJECT.md`'s integrity table splits
        //   the claim by tier: public data gets N-version redundancy with commit-reveal,
        //   sovereign data is owner-attested and what is verified is the aggregation
        //   *over* contributions. A ceremony across an owner's own two nodes resists
        //   nothing — both replicas are the owner's — and its presence would invite a
        //   reader to infer the independence VER-10's `owner-domain` label explicitly
        //   denies. `commit-reveal.ts`'s header carries the full argument; the serving
        //   side refuses a sovereign `commit` by name as well, so this is not the only
        //   place it is enforced.
        // - **at least `MIN_CEREMONY_REPLICAS`.** A ceremony over one replica binds an
        //   answer nobody could have copied. R=1 is VER-06's dial at off and goes
        //   through `executeVerified` exactly as it always has.
        // - **every executor speaks both rounds.** Asked of the objects rather than of
        //   a dial somebody had to remember to set — see `isCommitting` for the two
        //   alternatives and why each is worse. In practice this is the difference
        //   between a set of `RemoteExecutor`s, which cross a wire and where the
        //   ceremony is the whole point, and the kernel's four, which run in this
        //   process and between which there is nothing to plagiarize.
        //
        // Falling through to `executeVerified` is not a degraded ceremony and must not
        // be read as one: it is the post-hoc comparison this module has always done,
        // and `verify.ts`'s header says in its own words that it carries no plagiarism
        // resistance. The two return the identical `VerificationResult`, so nothing
        // below this line — grouping, receipts, the attestation label, the two display
        // surfaces — can tell which ran, and nothing below this line should.
        if (
          task.label === 'public' &&
          chosen.length >= MIN_CEREMONY_REPLICAS &&
          chosen.every((e) => isCommitting(e))
        ) {
          return executeCommitReveal(task, chosen as readonly (Executor & CommittingExecutor)[])
        }
        return executeVerified(task, chosen)
      }
      // The straggler machinery this shard's dispatches consult, or the stated absence of
      // it. Absent, `dispatchUnderLease` keeps Plan 20-01's two-wake schedule exactly.
      // `requestFor(…, 1)` because a duplicate is one extra copy — `eligibleNodes`, which
      // is all `speculativeCandidates` consults, does not read redundancy at all.
      const speculation: ShardSpeculation | null = speculationEnabled
        ? {
            ledger,
            completed: completedDurations,
            request: requestFor(shard, shardId, 1),
            pool: gate.pool,
            attempted,
            factor: dial.factor ?? DEFAULT_STRAGGLER_FACTOR,
            watchdogMs: dial.watchdogMs ?? DEFAULT_SPECULATION_WATCHDOG_MS,
          }
        : null

      for (;;) {
        // The lease names one holder, and it is the generation's first node. `LeaseTable`
        // models one holder per task by construction — granting over a live lease would
        // put two nodes on one task with neither told — so at redundancy > 1 the lease is
        // the *generation's* deadline held in the name of the node the probe will ask
        // about. That is stated rather than papered over: it is a per-generation
        // deadline, not a per-replica one.
        const holderId = nodeIds[0] as string
        const lease = leases.grant(shardId, holderId, clock.now())
        if (lease === null) {
          ending = 'generations-spent'
          break
        }
        generations += 1
        attempted.push(...nodeIds)

        const startedAt = clock.now()
        const dispatched = await dispatchUnderLease(
          runOn,
          nodeIds,
          startedAt,
          lease,
          leases,
          clock,
          probe,
          speculation,
        )
        speculated = speculated || dispatched.speculated

        if (dispatched.kind === 'answered') {
          outstanding.push(...dispatched.outstanding)
          // What this generation cost, for the median every other shard is judged
          // against. Only a generation that produced a **result** counts: how long a
          // dispatch took to fail everywhere says nothing about how long the work takes,
          // and folding it in would move the straggler threshold with the fabric's
          // failures rather than with its speed. Clamped to at least 1 because
          // `stragglers` refuses a threshold that is not above zero, and a clock that has
          // not advanced would otherwise make every finished shard contribute nothing.
          if (dispatched.verification.status !== 'insufficient') {
            completedDurations.push(Math.max(1, clock.now() - startedAt))
          }
          verification =
            verification === null
              ? dispatched.verification
              : mergeVerifications(verification, dispatched.verification)
          if (verification.status === 'disagreed') {
            leases.complete(shardId, holderId, clock.now())
            ending = 'disagreed'
            break
          }
          if (verification.status === 'agreed' && verification.replicas >= spec.redundancy) {
            leases.complete(shardId, holderId, clock.now())
            ending = 'agreed'
            break
          }
          // Observed failure, or an agreement short of the redundancy asked for. Either
          // way the information is already in hand, so the lease is given back now rather
          // than spending its full duration on it — `lease.ts`'s own argument for
          // `surrender`. It still consumes the generation.
          leases.surrender(shardId, holderId, clock.now())
        } else {
          // Silence, bounded. Reap **this task only**: a global sweep from inside one
          // shard's loop would expire a sibling's live lease and its perfectly good
          // completion would then be refused as stale.
          leases.reap(clock.now(), shardId)
        }

        // How much is still missing. A shard that agreed at 1 of 2 needs one more
        // replica, not two: asking for the full redundancy again would place a second
        // complete copy and report a verification tax nobody spent.
        const wanted =
          verification !== null && verification.status === 'agreed'
            ? spec.redundancy - verification.replicas
            : spec.redundancy
        const again = await placeAgain(
          requestFor(shard, shardId, wanted),
          gate.pool,
          new Set(attempted),
          spec.admit,
        )
        collectedRejections.push(...again.rejections)
        if (!again.placed) {
          ending = 'no-untried-node'
          break
        }
        nodeIds = again.nodeIds
        placementDegraded = placementDegraded || again.degraded
      }

      // A shard whose every generation lapsed or was refused a grant produced no
      // verification at all. It is `insufficient` for the reason the loop stopped, which
      // is a statement about the fabric rather than about any node.
      const settled: VerificationResult = verification ?? {
        status: 'insufficient',
        reason:
          ending === 'generations-spent'
            ? `${shardId} used all ${DEFAULT_MAX_GENERATIONS} of its dispatch generations without an answer`
            : `no node answered for ${shardId} and none is left untried`,
        failures: [],
      }

      // Persist an agreed result so it is retrievable by CID like any other block.
      if (settled.status === 'agreed') {
        const out = await canonicalCid(settled.output)
        if (out.ok) await blockstore.put(out.bytes)
        // CHURN-03, and the ordering is load-bearing: the block goes in **first**, so a
        // handle a departed requestor holds can never name a result nobody can retrieve.
        // The reverse order would publish a promise the store had not yet kept.
        //
        // Awaited, so `submitJob` cannot return before every handle has reached the sink.
        // It serialises against the other shards' writes and not against their dispatches
        // — see {@link checkpointLogOf}.
        await checkpoints.record({
          partitionIndex,
          resultCid: settled.resultCid.toString(),
        })
      }
      // The receipt, built from the agreeing replicas' checked signatures. `resultCid` is
      // the output every one of them hashed to — that is what agreement means — so the
      // challenge is rebuilt from this requestor's own task and that CID, and nothing the
      // attestations carry is used to say what they are about.
      const attestation =
        settled.status === 'agreed'
          ? receiptFor(
              settled.agreeing,
              {
                moduleCid: spec.moduleCid,
                inputCid,
                partitionIndex,
                outputCid: settled.resultCid,
              },
              descriptorByNodeId,
              now,
            )
          : noAgreementToAttest(settled.status)
      const result: ShardResult = {
        partitionIndex,
        inputCid,
        verification: settled,
        attempted,
        generations,
        ending,
        speculated,
        // Filled in below, once every shard has settled and the leftovers have been read.
        // `false`/`[]` here rather than absent, because a shard result is built in one
        // expression and patched in one place — which is what stops the two from
        // drifting apart.
        disagreed: false,
        copies: [],
        // Either shortfall degrades the shard: fewer replicas than asked for, or the
        // independence a composed quorum would have given it. The redundancy half is
        // read off the replicas that ANSWERED — see {@link ShardResult.degraded} — so a
        // shard topped up to full redundancy across two generations is not degraded,
        // and one that agreed at half the redundancy it asked for is, which the
        // placement-shaped test it replaced got wrong in exactly that case.
        degraded:
          gate.degraded ||
          (settled.status === 'agreed' ? settled.replicas < spec.redundancy : placementDegraded),
        quorum: gate.quorum,
        rejections: collectedRejections,
        attestation,
      }
      // `outstanding` is whatever is still running, handed up so the job can read it once
      // every shard has settled. Nothing is cancelled — see {@link compareOutstanding}.
      return {
        outstanding,
        winnerCid: settled.status === 'agreed' ? settled.resultCid.toString() : null,
        result,
      }
    }),
  )

  // Every shard has finished. Now read the copies that lost — see
  // {@link compareOutstanding} for why this is where it happens and what it costs.
  const lateCopies = await compareOutstanding(
    settledShards,
    clock,
    dial.compareGraceMs ?? dial.watchdogMs ?? DEFAULT_SPECULATION_WATCHDOG_MS,
  )
  const shards: readonly ShardResult[] = settledShards.map((settled, index) => {
    const copies = lateCopies[index] as readonly SpeculativeCopy[]
    if (copies.length === 0) return settled.result
    return {
      ...settled.result,
      copies,
      disagreed: copies.some((copy) => copy.outcome === 'disagreed'),
    }
  })

  // ── Coverage over owners — CHURN-05 ────────────────────────────────────────────────
  //
  // Shards each owner contributed, against shards each owner *owes*. The argument for the
  // per-owner gate is `coordinator.ts`'s and is reproduced here rather than referenced,
  // attributed, because a later plan deletes that module and this is the clearest
  // statement of the rule anywhere in the tree:
  //
  //   "Counting an owner as covered the moment any one of their shards lands overstates
  //   coverage exactly where it matters most: an owner with four shards, three of which
  //   failed, would be reported as having contributed, and `complete` would be true over
  //   a quarter of their data. That is the failure `coverage.ts` exists to prevent,
  //   arriving through the composition rather than through `coverageOf`."
  //
  // So the gate is **owed against done, per owner**, and it lives here in the caller.
  // `coverageOf` is pure set arithmetic over owner ids and has no way to express it; a
  // set of "owners that appeared" handed to it would already have lost the count.
  //
  // Arithmetic over shards already in hand — two map builds and a filter — not a second
  // pass over anything. It runs after the late copies have been read, because
  // {@link ShardResult.disagreed} is only known then and it is half of what "landed" means.
  const owedByOwner = new Map<OwnerId, number>()
  const doneByOwner = new Map<OwnerId, number>()
  for (const shard of spec.shards) {
    // A public shard names no owner and therefore contributes to no owner's count —
    // neither to the numerator nor to the denominator. It is not an owner called
    // "public"; it is a shard the question does not apply to.
    if (shard.label !== 'sovereign') continue
    owedByOwner.set(shard.ownerId, (owedByOwner.get(shard.ownerId) ?? 0) + 1)
  }
  for (const settled of shards) {
    const shard = spec.shards[settled.partitionIndex] as ShardSpec
    if (shard.label !== 'sovereign') continue
    if (!landedForItsOwner(settled)) continue
    doneByOwner.set(shard.ownerId, (doneByOwner.get(shard.ownerId) ?? 0) + 1)
  }
  // The expected set is the owners this job's own shards name — never the owners its
  // *nodes* belong to. A pool containing a node of some owner who has no shard here says
  // nothing about what this job was asked for, and counting it would report an owner
  // missing from a job that never wanted them.
  //
  // `unexpected` is carried through rather than dropped, and it is **structurally empty
  // today**: both sets are derived from `spec.shards[i].ownerId` through the one map
  // above, so the contributed set is a subset of the expected one by construction. That
  // is a reason to keep the field, not to remove it — a non-empty `unexpected` here would
  // mean the derivation and the delivery had come apart, which nothing else in this
  // module would catch. It becomes genuinely reachable the day the delivered owner is
  // read from a second source (a `ShardResult` that carried its own owner, or an egress
  // manifest), and not before.
  const coverage: JobCoverage =
    owedByOwner.size === 0
      ? 'defines-no-owners'
      : coverageOf(
          [...owedByOwner.keys()],
          [...owedByOwner]
            .filter(([owner, owed]) => (doneByOwner.get(owner) ?? 0) >= owed)
            .map(([owner]) => owner),
        )

  let gross = 0
  let useful = 0
  for (const s of shards) {
    if (s.verification.status === 'agreed') {
      gross += s.verification.grossFuel
      useful += s.verification.usefulFuel
    }
  }

  return {
    ok: true,
    job: {
      moduleCid: spec.moduleCid,
      shards,
      attestation: jobAttestationOf(shards),
      // A disagreement is a failed run, not a run with a footnote — the same rule
      // `executeVerified` and `executeReduce` apply, and the reason `disagreed` is read
      // here beside the verification status rather than left for a caller to remember.
      complete: shards.every(
        (s) => s.verification.status === 'agreed' && !s.degraded && !s.disagreed,
      ),
      grossFuel: gross,
      usefulFuel: useful,
      verificationMultiplier: useful === 0 ? 0 : gross / useful,
      redispatches: leases.redispatches,
      leaseHistory: leases.history,
      speculationMultiplier: ledger.multiplier,
      speculationSpent: ledger.spent,
      coverage,
    },
  }
}
