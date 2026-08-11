/**
 * The serving half of a node: answer task dispatches and block requests.
 *
 * A node is symmetric — it submits jobs through `RemoteExecutor` and serves them
 * through `serveAgent`, over the same endpoint. Nothing here distinguishes a
 * "client" from a "worker", which is what lets a browser tab that submitted a job
 * also contribute compute to someone else's.
 *
 * Pure module.
 */

import type { CID } from 'multiformats/cid'
import {
  MAX_PARTIAL_BYTES,
  canonicalCid,
  commitmentDigest,
  decodeCanonical,
  drawCeremonyNonce,
  encodeCanonical,
  fabricCombiner,
  signCombine,
} from '@o2/core'
import type {
  AttestedResult,
  Blockstore,
  CanonicalValue,
  Delegation,
  EnrollmentAuthority,
  EnrollmentRequest,
  Executor,
  LocalCapacity,
  RecordIndex,
  ResultAttestor,
  StartOutcomeLedger,
  Task,
} from '@o2/core'
import type { BlockSource } from './block.ts'
import { PendingCommitments } from './commit-store.ts'
import type { EgressGuard } from './egress.ts'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import type { AgentRequest, AgentResponse } from './protocol.ts'
import type { RpcEndpoint, RpcReply } from './rpc.ts'
import { takeSovereignHold } from './sovereign-egress.ts'
import type { EgressDisposition } from './sovereign-egress.ts'

/**
 * Pulls blocks from peers over RPC, trying each in turn.
 *
 * `peers` is a thunk rather than an array so the source always reflects the live
 * connection set — a peer that arrives after construction is usable, and one that
 * has gone away is not retried forever.
 */
export class RpcBlockSource implements BlockSource {
  readonly #rpc: RpcEndpoint
  readonly #peers: () => readonly string[]

  constructor(rpc: RpcEndpoint, peers: () => readonly string[]) {
    this.#rpc = rpc
    this.#peers = peers
  }

  async fetch(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    for (const peer of this.#peers()) {
      let body: CanonicalValue
      try {
        body = await this.#rpc.request(peer, encodeRequest({ kind: 'block', cid }))
      } catch {
        continue // unreachable peer — ask the next one
      }
      const response = parseResponse(body)
      if (response === null || response.kind !== 'block') continue
      if (response.bytes !== null) return response.bytes
    }
    return undefined
  }
}

/**
 * A combine, in the shape an `Authorizer` judges it in.
 *
 * These are the combine frame's four keys minus `kind` — addresses and the position
 * they sit at in the tree, and deliberately nothing else, because that is all the
 * frame carries (`protocol.ts`' `encodeRequest`). Kept as its own type rather than
 * flattened into {@link AuthorizedWork} so the set of facts an authorizer may decide a
 * combine on is one declaration a reader can check against the wire.
 */
export interface CombineWork {
  readonly combineId: string
  readonly inputCids: readonly CID[]
  readonly level: number
}

/**
 * What this node is being asked to do, handed to {@link Authorizer} before it does it.
 *
 * **A union rather than a `Task`, and that is the whole of the 16-05 fix.** The combine
 * branch used to refuse outright whenever a node had a real `Authorizer`, on the stated
 * grounds that *"`Authorizer` takes `{task, capability}` and a combine has no `Task`"*.
 * That premise was true; the conclusion did not follow. A combine is a unit of work this
 * node is asked to perform, so it belongs in front of the same hook — it just is not a
 * `Task`, and saying so in the type is what lets it through without anything being
 * invented on its behalf.
 *
 * The rejected alternative is worth naming, because it is the one that keeps this type
 * unchanged and is therefore the tempting one: build a `Task` literal for the combine.
 * `Task` requires `moduleCid`, `inputCid`, `partitionIndex` and `partitionCount`, and a
 * combine has **none** of them — it runs the fabric's fixed `fabricCombiner` rather than
 * a module, reads *many* inputs rather than one, and sits at a tree level rather than a
 * partition. Every one of those four fields would have had to be fabricated, and an
 * authorizer that later read one would be admitting or refusing on the strength of a CID
 * naming nothing. A refusal that names the wrong thing is a defect in this repository
 * even when the job correctly fails, so the type widened instead.
 *
 * `capability` is present on both arms and is **always empty** on the combine arm,
 * because the combine frame carries no chain and there is nowhere on it to put one. That
 * is a statement about this build's wire and not a claim that the chain was checked and
 * found empty — see {@link CombineWork}.
 */
export type AuthorizedWork =
  | { readonly kind: 'exec'; readonly task: Task; readonly capability: readonly Delegation[] }
  | { readonly kind: 'combine'; readonly combine: CombineWork; readonly capability: readonly Delegation[] }

/** Decides whether dispatched work may run. Returning a string refuses it. */
export interface Authorizer {
  (request: AuthorizedWork): string | null
}

export interface AgentOptions {
  readonly rpc: RpcEndpoint
  /** Runs dispatched tasks. Typically a `WasmExecutor`. */
  readonly executor: Executor
  /** Serves block requests, and is where the executor reads its inputs from. */
  readonly blockstore: Blockstore
  /**
   * AUTH-03. Consulted **before** the executor is called, so a task without a valid
   * capability chain never reaches `WebAssembly.instantiate`. Pass
   * `'serves-unauthenticated'` to serve unauthenticated, which is only appropriate
   * for public data.
   */
  readonly authorize: Authorizer | 'serves-unauthenticated'
  /**
   * SCHED-01 / NET-06. Records this node serves to peers.
   *
   * Any node may serve these — a browser tab holding a relay reservation answers
   * exactly as a listening server does. Pass `'serves-no-records'` to state this
   * node is not currently reachable to be asked, not that it is a lesser kind of
   * node.
   */
  readonly index: RecordIndex | 'serves-no-records'
  /**
   * SCHED-03 / SCHED-06. Answers offers, and admits the two branches that cost
   * this node something, from its own counters.
   *
   * The node is the only authority on whether it can take more work; a requestor's
   * load figure is a hint that may be seconds stale.
   *
   * Three branches use it and they use it differently, which is the whole of
   * SCHED-06:
   *
   * - **`exec`** takes a slot before the executor is called and returns it in a
   *   `finally` immediately after — including on a throw and on an `authorize`
   *   refusal. Over the limit it replies `{kind:'error'}` with the node's own
   *   `over-committed: N of M slots in use`, before the executor is reached.
   * - **`combine`** takes a slot before the first block is fetched and returns it
   *   in a `finally` the same way. Over the limit it replies with the *combine*
   *   shape — `{resultCid: null}` carrying that same string — because
   *   `executeReduce` reads a null result as "try the next executor in the
   *   ranking", which is the right answer from a busy node, while an `error` there
   *   would be read as a node condition by a caller that never sees the reason at
   *   all. Added in 16-06 on the owner's ruling: a combine's inputs are the outputs
   *   of public map tasks, so the surface it opens is capacity rather than
   *   authorisation.
   * - **`offer`** reads the same counters through `would` and takes **nothing**.
   *   An offer is a question, and a liveness prober asking it must not fill the
   *   slot table of every peer it can see.
   *
   * The two reserving branches share one slot table on purpose — it is one node's
   * CPU, and a bound that let a peer spend it twice by choosing which verb to send
   * would not be a bound. Their keys are namespaced apart (`agent.ts`' combine
   * branch derives `combine:<input cids>`; the exec branch derives
   * `<input cid>:<partition index>`) so neither can dedupe-refuse the other's work.
   *
   * Pass `'accepts-every-offer'` to opt out of all three, which is right for a node
   * that never refuses.
   */
  readonly capacity: LocalCapacity | 'accepts-every-offer'
  /**
   * NET-03. Peer ids currently holding a reservation on this node.
   *
   * A thunk, so the answer is the live set rather than a snapshot taken at
   * construction. Pass `'relays-for-nobody'` to answer with an empty list — which
   * is what a node relaying for nobody would say anyway, so a caller cannot tell
   * "does not relay" from "relays for nobody", and there is deliberately nothing
   * here to tell them apart with.
   *
   * That indistinguishability is deliberate and it has a cost worth stating: a
   * caller cannot tell a stated absence from a genuinely empty set either.
   * `FabricNode` omitted this for the whole of Phase 9, so every static-host
   * rendezvous got a real answer naming nobody, and the caller could not tell that
   * from a relay with no guests. Supply it wherever the data exists. That omission
   * is no longer possible to make silently now that the property is required — a
   * call site must now write `'relays-for-nobody'` to reproduce it, which is
   * exactly the fact this phase makes recordable.
   */
  readonly reservations: (() => readonly string[]) | 'relays-for-nobody'
  /**
   * BROW-02. What this node has been told about how starting went elsewhere.
   *
   * Any node may hold one, on the same terms as any other — the only difference
   * between nodes is discovery. Pass `'keeps-no-ledger'` to answer with nothing,
   * which is a truthful answer from a node that has been told nothing, and is
   * distinguishable from an unreachable node only by the requestor getting an
   * answer at all.
   */
  readonly ledger: StartOutcomeLedger | 'keeps-no-ledger'
  /**
   * BROW-04. Called immediately before this node runs a peer's task — after
   * admission and after authorisation. A request this node refused is not a
   * dispatch it served.
   *
   * The always-visible surface has to say what is running *and for whom*, and the
   * executor cannot answer the second half — a `Task` is addressed entirely by CID
   * and carries no requestor. Only the serving side knows, and only here. Pass
   * `'reports-no-dispatch'` for a node with nothing watching its dispatches.
   */
  readonly onDispatch: ((from: string) => void) | 'reports-no-dispatch'
  /**
   * DATA-05. The tap this endpoint's sends go out through, and the store that says
   * which payloads are sovereign — so a sovereign task's input is guarded for exactly
   * as long as its reply frame takes to settle.
   *
   * **One field, carrying both.** A tap with no store would guard nothing; a store
   * with no tap would have nothing to tell. Neither is constructible.
   *
   * `sovereignInputs` must be the node's **local-only** tier and never one with
   * network fallback. A sovereign input is owner-pinned and already resident, so
   * declaring one must not itself become a network round trip — see
   * `sovereign-egress.ts`, where that ruling is recorded.
   *
   * Any node may hold registrations, on the same terms as any other — the only
   * difference between nodes is discovery. Pass `'holds-no-registrations'` to state
   * that this endpoint's sends are not tapped, which is a truthful statement about
   * this endpoint and not a lesser kind of node.
   *
   * Required rather than optional, and the reason is recorded rather than stylistic:
   * `.planning/PROJECT.md`'s Key Decision **"An optional hook with a silent default
   * is a hole"** (v1.0 audit). Here the hole has a specific shape. A node that
   * omitted this would keep registering sovereign inputs and never release one, so
   * every frame it ever sends would be scanned against every sovereign payload it
   * has ever been handed — it would grow slower for the rest of its life with
   * nothing failing and nobody measuring. Making the omission something a call site
   * has to write down is what turns that into a decision.
   */
  readonly egress: EgressDisposition
  /**
   * AUTH-01 / AUTH-04. The provider signing key this process holds, if it holds one.
   *
   * **This is a per-node setting, not a node kind.** Every node built anywhere in this
   * repository has identical code and identical capability regardless of whether it is
   * passed — the same sentence `bin/agent.ts` already uses about `--owner-id`: *"this is
   * a per-node clearance flag, not a node kind: every agent process built by this binary
   * has identical capability regardless of whether it is passed."*
   *
   * A reader who finds this in six months and writes *"the provider node"* in prose will
   * recreate the defect `fabric-node.ts`' "Why there is no second class" section records:
   * a class that bound a socket, could not run a task, and survived three rounds of
   * renaming because the two disjoint capability sets stayed where they were. There is no
   * provider node. There are nodes, and some of them were given a signing key.
   *
   * Pass `'issues-no-certificates'` to state that this process issues none. That is a
   * truthful statement about this process and not a lesser kind of node, and a node that
   * says it answers by name — see the handler below, which replies with a stated reason
   * rather than with silence.
   *
   * Required rather than optional, for the reason `.planning/PROJECT.md`'s Key Decision
   * **"An optional hook with a silent default is a hole"** gives. Here the hole has a
   * specific shape: a silent default would be a node that answers enrollment requests
   * with nothing at all, which a requestor cannot tell from an unreachable one — so a
   * provider that was misconfigured would look exactly like a provider that was down.
   */
  readonly enroll: EnrollmentAuthority | 'issues-no-certificates'
  /**
   * VER-08 / VER-09 / VER-10. The node's own signing identity — its seed and the
   * provider-signed certificate naming that seed's public half — or the named statement
   * that this node signs nothing.
   *
   * **This is a per-node setting, not a node kind**, on exactly the terms `enroll` above
   * states: every node built anywhere in this repository has identical code and identical
   * capability regardless of whether it is passed. A node that signs and a node that does
   * not are the same node with different configuration, and the only difference between
   * nodes in this fabric is discovery.
   *
   * **One hook, both verbs, and that is the decision rather than a convenience.**
   * `PROJECT.md` states the project's split as *the owner's contribution is trusted; the
   * aggregation over contributions is verified*. A node that signed its map results and
   * not the aggregation over them would satisfy the letter of the third signing leg and
   * none of its point — and **two independent ways to acquire a signing key is precisely
   * how that happens**, because one of them gets wired and the other is forgotten. So a
   * node declares its identity here, once.
   *
   * The two verbs then reach it by different routes, and that is **a structural fact of
   * this codebase rather than a preference**: `exec` runs through an `Executor`, so it
   * signs through `@o2/core`'s `attestResults` wrapper composed around that executor; a
   * combine runs through no executor at all — `serveAgent` performs it itself in
   * `combineAdmitted` — so its signer has to be here. Do not "unify" these into one path;
   * there is no port a combine passes through to be wrapped at.
   *
   * Pass `'signs-nothing'` to state that this node signs nothing. That is the truthful
   * answer from a node nobody enrolled, it reaches a peer as the named
   * `'signed-by-nobody'` on the reply rather than as silence, and it is what the two
   * benchmark rigs pass permanently, because neither holds a certificate and a node
   * nobody certified signing for itself proves nothing to anybody.
   *
   * Required rather than optional, for `.planning/PROJECT.md`'s Key Decision **"An
   * optional hook with a silent default is a hole"**. Here the hole is the narrowest and
   * quietest of the nine: a node that omitted this would answer every combine unsigned,
   * every frame would still be well-formed, every existing assertion would stay green,
   * and the aggregation would simply stop being checkable by anybody — which is the one
   * property this leg exists to provide. This phase measured twice that the type checker
   * alone does not catch that: an optional field leaves `tsc --noEmit` at exit 0 while
   * the behavioural assertion fails.
   */
  readonly attest: ResultAttestor
}

/**
 * NET-10 — the reason to send *instead of* `body`, or `null` to send `body`.
 *
 * `EgressGuard.send` already refuses a frame carrying a registered sovereign
 * payload, and on the requesting leg that refusal is named immediately. On the
 * responding leg `rpc.ts` swallows it by documented design, so the requestor learns
 * only that nothing came back and waits out its whole budget — it cannot tell
 * *"your data may not leave that node"* from *"that node is gone"*. This asks the
 * question early, while a smaller reply can still be substituted.
 *
 * Two guards keep it off the hot path, and both are deliberate:
 *
 * - a node whose sends are not tapped has nothing to ask;
 * - a node whose tap holds no registrations has nothing to find, and without this
 *   check every reply on every guarded node would pay a second `encodeCanonical`
 *   to discover that. It reads the existing public `registrations` getter rather
 *   than adding a second member; the array that allocates is dwarfed by the encode
 *   it avoids.
 *
 * An encode failure returns `null` deliberately. A body that will not canonicalise
 * is not a body `rpc.ts` can send either — it fails on its own path, loudly, rather
 * than being converted into an egress refusal here and reported as a sovereignty
 * violation that never happened.
 *
 * The returned string's shape is load-bearing in two directions. It **begins**
 * `egress refused: `, the wire vocabulary 13.1-CONTEXT.md decision 4 fixes,
 * asserted by test so it cannot drift — and deliberately distinct from the
 * `over-committed: ` prefix, because the two want opposite retry policies: an
 * egress refusal is a **task** condition sent as `exec ok:false`, a capacity
 * refusal is a **node** condition sent as `error`. It **ends** by naming the
 * serving node, because `RemoteExecutor` passes an `exec` outcome through verbatim
 * and without it the attribution two existing specs assert would be lost.
 */
function refusedReason(
  egress: AgentOptions['egress'],
  to: string,
  body: CanonicalValue,
  nodeId: string,
): string | null {
  if (egress === 'holds-no-registrations' || egress.guard.registrations.length === 0) return null
  const encoded = encodeCanonical(body)
  if (!encoded.ok) return null
  const violated = egress.guard.refuse(to, encoded.bytes)
  return violated === null ? null : `egress refused: ${violated} on ${nodeId}`
}

/**
 * Merge the partials a `combine` request names — MR-03, MR-05, MR-06.
 *
 * Kept out of line so the handler ladder below stays readable, and kept *in* the
 * ladder rather than beside the `exec` branch because a combine returns a plain body:
 * a combine's inputs are partials, and only the executing node of a **map** task
 * registers a sovereign payload (`takeSovereignHold`, wired at both production
 * factories), so there is no registration outstanding against a combine reply to
 * release and therefore no `afterSent` to schedule.
 *
 * Every failure is the `{resultCid: null, reason}` arm and never an `error` frame. The
 * distinction is the retry policy: an `error` is a *node* condition and a combine that
 * could not be run is exactly the fallthrough signal `executeReduce`'s ranking walk
 * consumes, which moves to the next executor in the ranking.
 *
 * ---
 *
 * **Fetch amplification on this frame: slot-bounded per node, and not eliminated.**
 * This handler is where a `combine` turns into work, so the disposition belongs here
 * rather than at the parser that flagged it.
 *
 * Four things bound it, each bounding a **different** quantity. They are listed with
 * what each one measures, because the tempting reading — that they compose into a
 * ceiling on what a node can be made to transfer — is exactly the reading the last
 * paragraph refuses.
 *
 * 1. `MAX_COMBINE_INPUTS` bounds *k*, **how many reads one frame may provoke**, at the
 *    **parser** — a frame naming more inputs than that never becomes a request, so this
 *    function is never entered for one.
 * 2. The loop below is **sequential with an early return**, never a `Promise.all`. That
 *    bounds a frame's cost at **the first input this node refuses**, so a frame naming
 *    64 CIDs whose second is oversized costs two reads and not 64. It is a property of
 *    the loop's shape, and it is asserted in `combine.test.ts`.
 * 3. Admission — SCHED-06, and 16-06's addition — bounds **how many combines this node
 *    has in flight at once**, at its own `LocalCapacity.slots`. A combine over that
 *    limit is refused by name at **zero** reads, because the slot is taken before the
 *    loop is entered. See the block below for why this is the right hook.
 * 4. A node whose `Authorizer` refuses this combine also pays **zero** reads, for the
 *    same ordering reason. Until 16-05 this line said *"a node with a real
 *    `Authorizer`"*, which was true only while every such node refused every combine —
 *    the defect 16-05 removed. `authorizeCapability` reaches its refusal rules through
 *    `task.label === 'sovereign'` and the combine frame carries no such label, so on
 *    this build it admits every combine; bound 3, not this one, is what binds today.
 *
 * Underneath all four, NET-08's `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`) bounds **the
 * size of one inbound message**, with a per-peer cap on concurrent accumulation beside
 * it.
 *
 * **No product of these is written here, and none may be.** A residency figure nobody
 * measured against a running node is not a guarantee. Each bound above names one
 * quantity and says nothing about the others.
 *
 * **What remains open, stated rather than left to be inferred.** Admission bounds
 * *concurrency*, not *arrival rate*: a peer that sends combines one at a time, waiting
 * for each, meets no refusal at all and can keep a slot busy indefinitely. And an
 * *admitted* combine still performs real reads — each one through a
 * `FetchingBlockstore` has by then pulled the block over the wire, hash-verified it and
 * written it to the local store. So `MAX_PARTIAL_BYTES` below bounds what this node
 * will **merge**, never what a peer can make it transfer or keep. What changed in 16-06
 * is that the number of those reads a node will have outstanding at any instant is now
 * its own declared figure rather than unbounded. This surface is the same *kind* the
 * `exec` and `block` branches already present, and it is now answered the same way.
 */
async function runCombine(
  request: Extract<AgentRequest, { readonly kind: 'combine' }>,
  options: AgentOptions,
): Promise<AgentResponse> {
  // SCHED-06 — admission, before any block is fetched.
  //
  // **Why this hook and not a second authorizer rule.** Owner ruling 2026-07-31.
  // 16-05 routed the combine through `options.authorize`, which is structurally right
  // and stays; what it could not do is *bound* anything, because `authorizeCapability`
  // reaches its refusal rules through `task.label === 'sovereign'` and no combine can
  // present that label. Verification measured the consequence: nothing this repository
  // can start could refuse a combine, so the surface widened from unauthenticated nodes
  // to every node. The answer is not a sovereignty label on the wire that nothing would
  // set, and not an `authorize` override on the node factories that would reopen the
  // door Phase 15 closed by hardcoding `authorizeCapability`. A combine's inputs are the
  // outputs of **public** map tasks — content-addressed, already public by
  // construction — so there is nothing on this frame to authorize. What a peer can
  // provoke is CPU and transfer, which is a **capacity** question, and this function's
  // own header named that answer before the branch existed.
  //
  // **The slot key is derived from the inputs, and that is the same rule the `exec`
  // branch follows.** A combine's output is a pure function of `inputCids` — same
  // inputs, same bytes, same CID — so the input set *is* the work's identity, exactly
  // as `inputCid` plus `partitionIndex` is a task's. The rejected alternative is
  // `combineId`: it is the *tree node's* derived id and therefore a requestor's claim
  // about where in a tree this sits, so keying on it would let one peer split identical
  // work across N keys by renaming it — the same failure the `exec` branch records
  // against a per-request monotonic id. The `combine:` prefix keeps these keys in a
  // namespace disjoint from the exec branch's, which begin with a CID string, so
  // neither branch can dedupe-refuse the other's work.
  //
  // **Not a queueing change.** An over-committed node says no with a stated reason; it
  // does not buffer. Queueing would convert a refusal into unbounded latency and hide
  // the load signal `executeReduce`'s ranking walk consumes.
  const capacity = options.capacity === 'accepts-every-offer' ? null : options.capacity
  const slotKey = `combine:${request.inputCids.map((cid) => cid.toString()).join(',')}`
  if (capacity !== null) {
    const admission = capacity.offer({ shardId: slotKey, nodeId: options.executor.nodeId })
    if (!admission.accepted) {
      // Refused **before** the `try`, so this exit holds nothing to give back — the
      // same placement the `exec` branch uses, for the same reason.
      //
      // `admission.reason` verbatim, with no prefix. The `unauthorized: ` prefix in
      // `combineAdmitted` exists so one authorizer's text reads identically on either
      // branch; a capacity refusal wants that property for the same reason, and the
      // `exec` branch adds no prefix either. So `over-committed: N of M slots in use`
      // is one string composed in one place (`LocalCapacity.#decide`), and it is
      // asserted by text and not by kind.
      //
      // The combine reply shape and not an `error` frame — see this function's header.
      // `executeReduce` consumes `resultCid: null` as the signal to try the next
      // executor in the rendezvous ranking, which is precisely the right response to a
      // node that is busy. The cost, recorded rather than left to be discovered:
      // `remoteCombineDispatch` collapses every failure to `null`, so this reason does
      // not reach the requestor at all. That channel is `combine.ts`' documented
      // pre-existing limitation and this branch does not widen it.
      //
      // No attestation, and that is not an oversight the sentinel papers over: this
      // node did not run the combine, so it has nothing to make a statement about.
      // Every refusal arm below reads the same way.
      return { kind: 'combine', resultCid: null, reason: admission.reason, attestation: 'signed-by-nobody' }
    }
  }
  try {
    return await combineAdmitted(request, options)
  } finally {
    // Every exit releases — a result, a named failure, a throw out of the handler, and
    // `combineAdmitted`'s `authorize` refusal, which reads nothing at all. A node that
    // admits correctly and never releases is indistinguishable from a working node for
    // exactly `slots` combines and then refuses everything forever, with the reduce
    // quietly running out of executors and nothing naming the cause.
    //
    // Released here rather than after the reply frame settles, the same trade the
    // `exec` branch states: the slot is about work concurrency, and holding it until
    // the frame lands would couple a CPU bound to a network latency. A combine has no
    // `afterSent` to release in anyway — see this function's header.
    capacity?.release(slotKey)
  }
}

/** The body of a combine this node has already taken a slot for. */
async function combineAdmitted(
  request: Extract<AgentRequest, { readonly kind: 'combine' }>,
  options: AgentOptions,
): Promise<AgentResponse> {
  // Authorisation, before any block is read — the same ordering the `exec` branch
  // states below (*"refusing after execution would already have run the module against
  // the owner's data"*), for the combine's own version of that reason: refusing after
  // the loop would already have made this node fetch, hash-verify and store every
  // partial the frame named. The ordering is asserted, not just intended:
  // `combine.test.ts` counts zero reads on a refusal.
  //
  // **This used to be a hard refusal, and removing it is 16-05.** The branch read
  // `options.authorize !== 'serves-unauthenticated'` and answered *"combine requires a
  // capability chain this build cannot verify"*, on the premise — written into its own
  // comment — that *"every production call site passes the sentinel today, so this is a
  // no-op now"*. Phase 15 falsified that premise by installing `authorizeCapability` at
  // both `FabricNode` and `BrowserNode`, leaving only `bin/bench.ts` on the sentinel. So
  // every combine on every real node was refused and the reduce had no production path
  // at all. It also refused *because* a real authorizer was present, which made a
  // production node strictly less capable than a test node — the inverse of this
  // repository's rule that the only difference between nodes is discovery.
  //
  // Owner ruling 2026-07-31: route a combine through the same hook as everything else,
  // which is what the old comment itself asked for — *"a combine should reuse it rather
  // than grow a second admission path beside it"*.
  const refusal =
    options.authorize === 'serves-unauthenticated'
      ? null
      : options.authorize({
          kind: 'combine',
          combine: {
            combineId: request.combineId,
            inputCids: request.inputCids,
            level: request.level,
          },
          // Empty because the frame carries no chain, not because one was checked.
          capability: [],
        })
  if (refusal !== null) {
    // `unauthorized: `, the same prefix the `exec` branch puts on this hook's refusal,
    // so one authorizer's text reads identically whichever branch consulted it. The
    // combine reply shape rather than an `error` frame, for the reason this function's
    // header gives: `executeReduce`'s ranking walk consumes a `resultCid: null` as the
    // signal to try the next executor, and an `error` would be read as a node condition.
    return {
      kind: 'combine',
      resultCid: null,
      reason: `unauthorized: ${refusal}`,
      attestation: 'signed-by-nobody',
    }
  }

  const inputs: CanonicalValue[] = []
  for (const cid of request.inputCids) {
    const bytes = await options.blockstore.get(cid)
    if (bytes === undefined) {
      return {
        kind: 'combine',
        resultCid: null,
        reason: `combine input ${cid.toString()} not held and not obtainable`,
        attestation: 'signed-by-nobody',
      }
    }
    // `MAX_PARTIAL_BYTES`' first production reader — it had none before this branch,
    // and a bound nothing enforces is a comment. What it bounds is what this node will
    // **merge**; see this function's header for what it deliberately does not bound.
    // Its own docstring carries the reason for the value: a partial that outgrows this
    // has stopped being a summary and started being data, which is also a sovereignty
    // problem.
    if (bytes.byteLength > MAX_PARTIAL_BYTES) {
      return {
        kind: 'combine',
        resultCid: null,
        reason: `combine input ${cid.toString()} is ${bytes.byteLength} bytes, over the ${MAX_PARTIAL_BYTES} byte partial budget`,
        attestation: 'signed-by-nobody',
      }
    }
    let decoded: CanonicalValue
    try {
      decoded = decodeCanonical(bytes)
    } catch {
      return {
        kind: 'combine',
        resultCid: null,
        reason: `combine input ${cid.toString()} did not decode`,
        attestation: 'signed-by-nobody',
      }
    }
    inputs.push(decoded)
  }

  // `fabricCombiner` is total: a value `asFabricPartial` rejects contributes zero
  // rather than throwing, because bytes that arrived from a peer must not be able to
  // abort a combine every other contributor answered honestly. That is the *wire*
  // disposition of the pair — `reduceJob` takes the other one.
  const hashed = await canonicalCid(fabricCombiner(inputs))
  if (!hashed.ok) {
    return {
      kind: 'combine',
      resultCid: null,
      reason: `combine result is not encodable: ${JSON.stringify(hashed.error)}`,
      attestation: 'signed-by-nobody',
    }
  }
  // The put is what makes the result retrievable by CID like any other block, and it
  // is what makes a late duplicate free: same inputs, same bytes, same CID, no second
  // entry. It writes to this node's own local tier and nowhere else — the requestor
  // fetches it back deliberately, by CID, from this peer (`remoteCombineDispatch`).
  await options.blockstore.put(hashed.bytes)
  // VER-08 / VER-09 / VER-10 — the aggregation's half of the third signing leg, and the
  // only path in this function that produces one. Every arm above returned
  // `resultCid: null` with the sentinel, because a combine this node refused is not a
  // merge it can make a statement about.
  //
  // **The inputs are signed in the order they were merged. They are NEVER sorted.** A
  // combine's output is a function of its input *sequence*, so a sorted challenge would
  // let a reordered input list verify against a result that list did not produce. The
  // reflex to sort comes from `payloadOf` in `enrollment.ts`, which sorts `relayIds` —
  // correct there because a relay set is a **set**, and wrong here because this is a
  // sequence. `combineChallenge` carries the same warning at the encoding.
  //
  // **`combineId` and `level` are deliberately not signed.** `agent.ts`' slot key records
  // the reason and it is the same one: `combineId` is the *tree node's* derived id and
  // therefore a requestor's claim about where in a tree this sits, so keying on it would
  // let one peer present the same merge under any number of names. The input set is the
  // work's identity, and `hashed.cid` — already computed above, so signing costs no
  // second hash — is the answer.
  //
  // A signature costs one Ed25519 sign over a challenge whose size does not depend on
  // the partials, only on how many were named.
  const attestation: AttestedResult =
    options.attest === 'signs-nothing'
      ? 'signed-by-nobody'
      : signCombine(options.attest, request.inputCids, hashed.cid)
  return { kind: 'combine', resultCid: hashed.cid, reason: '', attestation }
}

/**
 * Redeem the challenge an enrolment frame answers, then decide entitlement — AUTH-01.
 *
 * **This is where the freshness check lives, and the placement was chosen rather than
 * fallen into.** `EnrollmentAuthority.enrol` is a pure function of `(request, now)` that
 * answers *is this node entitled to a certificate* — a question about the request alone.
 * Replayability is not a property of a request; it is a property of an **exchange**, and
 * this branch is the only place in this repository where a stranger's bytes become one.
 * `enrollment.ts`' header states the residual that follows: a host wiring `enrol` to a
 * transport of its own would get no freshness, and `serveAgent` is the only such wiring
 * here.
 *
 * The ordering is redeem-then-enrol, so a replayed frame never reaches the limiter and
 * never spends anybody's budget. It is the same discipline `enrol` already applies
 * internally by checking possession and consent before touching the window.
 *
 * A *refusal* is returned rather than an `error` frame, on the `enrol` branch's stated
 * rule: this is an answer about the request, and it names the one next action that works —
 * ask for another challenge. `error` stays reserved for facts about the answering node.
 */
function certifyFreshly(
  authority: EnrollmentAuthority,
  request: EnrollmentRequest,
  now: number,
): AgentResponse {
  const stale = authority.redeemChallenge(request, now)
  if (stale !== null) return { kind: 'enrol', result: stale }
  return { kind: 'enrol', result: authority.enrol(request, now) }
}

/**
 * Install the request handler that makes this endpoint a serving node.
 *
 * A node that serves also **combines**, unconditionally and with no option to say
 * otherwise. Combining is not a capability a node can lack: if it were,
 * `executeReduce`'s rendezvous ranking would be selecting among nodes that differ in
 * what they can do, which is the one thing this project has ruled out. So the combine
 * branch takes no new `AgentOptions` field — it uses the `blockstore` this function
 * already takes and the fabric's single `fabricCombiner`. See `AgentOptions`' per-field
 * docs for the shared reasoning it follows: the only difference between nodes is
 * discovery.
 */
export function serveAgent(options: AgentOptions): void {
  const { rpc, executor, blockstore } = options

  /**
   * VER-02's holding area, one per served node.
   *
   * **Not an `AgentOptions` hook**, and that is a deliberate exception to this
   * function's own nine-hook discipline rather than an oversight. Every hook above is a
   * hook because a *deployment* has something to say about it — a signing key it holds
   * or does not, a ledger it keeps or does not, records it serves or does not. This is
   * not that: it is the mechanism's own working memory, bounded by two constants sited
   * in `commit-store.ts`, and a node that could be configured to hold nothing would be a
   * node that silently cannot take part in a ceremony while answering every frame in it.
   * The named-absence pattern exists to make a deployment's silences legible; there is
   * no silence here to make legible.
   */
  const pending = new PendingCommitments(options.executor.nodeId)

  const answer = async (from: string, body: CanonicalValue): Promise<CanonicalValue | RpcReply> => {
    const request = parseRequest(body)
    if (request === null) {
      return encodeResponse({ kind: 'error', reason: 'malformed request' })
    }

    let response: AgentResponse
    if (request.kind === 'block') {
      // **Local holdings only, and the `has` gate is what makes it local.**
      //
      // This branch used to be a bare `blockstore.get`, and in production `blockstore` is
      // a `FetchingBlockstore` — so a node asked for a block it did not hold went to the
      // network to find one, for the peer that had just asked it. Two nodes wired to each
      // other, which in a mesh is every pair, then deadlocked: A's `get` registers the CID
      // in its in-flight map and asks B; B's serve path calls its own `get`, which asks A;
      // A's serve path calls `get` again and is handed back **the very promise that is
      // waiting on B**. Nothing can resolve it, so the `bytes ?? null` refusal three lines
      // down — which is correct and has always been here — was simply never reached, and
      // the requestor waited out its whole RPC budget for an answer this node could have
      // given immediately.
      //
      // **The 60 s that was reported is the demo page's `rpcTimeoutMs`, not a fact about
      // blocks.** Re-sited at 2 000 ms the same fixture reads 2 002 ms. A duration equal
      // to a timeout is evidence of the timeout — the rule this repository already paid
      // for once on `lift.node.test.ts`.
      //
      // `has` is the right instrument rather than a convenient one: `FetchingBlockstore`
      // documents it as *"Local presence only — deliberately does not go to the network"*,
      // for this exact reason one layer down. And when it answers true the `get` below
      // reads the local tier and cannot dial, because `get` checks local first.
      //
      // **This costs no reachability.** `RpcBlockSource.fetch` already walks every peer
      // itself, so a serving node that also walked its peers was duplicating the
      // requestor's own loop — with no hop bound, no cycle check, and no idea who had
      // asked. What it removes is a node unwittingly acting as an open recursive proxy
      // for anything any peer names. The `combine` branch keeps its network fallback and
      // says so in its own refusal text (*"not held and not obtainable"*); that branch is
      // fetching inputs it was asked to **compute over**, which is a different question
      // from "do you have this".
      //
      // The race between `has` and `get` is benign and worth stating: a block evicted in
      // that window makes this answer `bytes: null`, which is a *stated* miss and exactly
      // what a caller must handle anyway. Silence was never one of the outcomes.
      const bytes = (await blockstore.has(request.cid)) ? await blockstore.get(request.cid) : undefined
      const found: AgentResponse = { kind: 'block', bytes: bytes ?? null }
      // ROADMAP criterion 7. This branch gets the same treatment as `exec`
      // because without it a node asked for registered bytes answers with a
      // silence the requestor cannot tell from absence — the same defect NET-10
      // exists to remove, one branch over.
      //
      // That a node refuses to serve a registered sovereign block at all is the
      // owner ruling of 2026-07-28, recorded in `egress.ts` where it belongs;
      // this branch does not re-derive it, it only makes the refusal legible.
      // What that ruling knowingly accepts is that a peer cannot tell refusal
      // from absence — and the consequence here is `RpcBlockSource.fetch` above,
      // which treats any non-`block` reply as a miss and asks the next peer. So a
      // multi-peer fetch degrades rather than loops, while a caller that asked
      // this node directly gets a named reason. That shape is deliberate.
      // DATA-10's at-rest half — asked by CID, and asked FIRST.
      //
      // `refusedReason` below scans the frame against every payload the guard currently
      // holds, and holds are job-scoped, so it stops answering the moment a job ends. That
      // lifetime is right for a byte scan and wrong for a fact about data: sovereignty is
      // a property of the bytes, not of whether a job happens to be running over them.
      //
      // A `block` request names a CID, so this case never needed the scan. One lookup,
      // and it keeps answering for as long as the node holds the row.
      const durable =
        options.egress === 'holds-no-registrations' ||
        options.egress.sovereignCids === 'forgets-sovereignty-between-jobs'
          ? null
          : options.egress.sovereignCids.has(request.cid.toString())
            ? `egress refused: ${request.cid.toString()} on ${executor.nodeId}`
            : null
      const violated =
        durable ?? refusedReason(options.egress, from, encodeResponse(found), executor.nodeId)
      response = violated === null ? found : { kind: 'error', reason: violated }
    } else if (request.kind === 'providers') {
      // An empty list from a node that holds no index is a truthful answer, not an
      // error: the requestor's fallback chain moves on to the next source.
      response = {
        kind: 'providers',
        nodeKeys: options.index === 'serves-no-records' ? [] : await options.index.providers(request.cid),
      }
    } else if (request.kind === 'records') {
      response = {
        kind: 'records',
        records:
          options.index === 'serves-no-records' ? null : (await options.index.recordsFor(request.nodeKey)) ?? null,
      }
    } else if (request.kind === 'reservations') {
      response = {
        kind: 'reservations',
        peerIds: options.reservations === 'relays-for-nobody' ? [] : options.reservations(),
      }
    } else if (request.kind === 'report') {
      const ledger = options.ledger === 'keeps-no-ledger' ? null : options.ledger
      if (request.outcome !== null) ledger?.record(request.outcome)
      ledger?.decline(request.declined ?? 0)
      response = { kind: 'report', counts: ledger?.counts() ?? [], declined: ledger?.declined ?? 0 }
    } else if (request.kind === 'offer') {
      // `would`, not `offer`: an offer is a *question*, and answering a question
      // must not consume the thing being asked about. The reservation lives on
      // the `exec` branch below, where the CPU is actually spent.
      //
      // This is a **trade, not an improvement**, and both halves are recorded
      // because describing it as strictly better would be the same class of
      // claim this phase exists to delete.
      //
      // *What is gained.* The offer branch no longer reserves a slot that
      // nothing can redeem. An `exec` request carries no shard id (see
      // `protocol.ts`'s `AgentRequest`), so no serving node can correlate an
      // offer reservation with the exec that would release it — and
      // `browser/demo/main.ts` sends `{kind:'offer', shardId:'probe'}` to every
      // connected peer on every `computePeers()` call, so a reserving offer
      // branch would fill every peer's slot table with a shard named `probe` and
      // then refuse all real work.
      //
      // *What was lost, and what Phase 18 did about it.* `placeWithOffers`
      // removes a probed candidate from the pool for **one** shard, and `pool` is
      // rebuilt per request, so across shards the only thing that made wire-side
      // placement over-commit-safe was the reservation. With `would()` reserving
      // nothing, `planWithOffers` + `rpcAdmission` placed all N shards of a job on
      // one node with `maxConcurrent: 1`, and `discovery.test.ts` pinned that
      // consequence so it stayed visible rather than silent.
      //
      // Two candidate mechanisms were recorded here. **Phase 18 took the second**
      // (owner ruling D2, 2026-08-01): this response publishes the node's slot
      // count and in-flight count, and the requestor keeps its own tally across a
      // placement generation. It reserves nothing, so there is no reservation to
      // leak and no expiry to manage.
      //
      // **The first was rejected**, and the reason is the paragraph above: carrying
      // a shard id on `exec` so an offer reservation could be redeemed is exactly
      // what Phase 13.1 removed. Restoring it needs a reservation expiry, a
      // wall-clock bound inside admission, and a way to tell a liveness probe from
      // a real offer — three new mechanisms where D2 needs one field. Do not
      // re-propose it.
      //
      // *Why `would` is still right.* The node-side bound is what SCHED-06 asks
      // for, and it is the only one that binds a peer which never probes at all.
      // The requestor-side bound is advisory and always was — nothing forces a
      // requestor to probe, or to believe what it reads. What D2 removes is wasted
      // round trips, not the bound.
      const decision =
        options.capacity === 'accepts-every-offer'
          ? undefined
          : options.capacity.would({ shardId: request.shardId, nodeId: executor.nodeId })
      // A node with no counters to read states nothing rather than inventing a
      // figure. `LocalCapacity` always states one, on both arms.
      const stated =
        decision === undefined || decision.capacity === 'states-no-capacity'
          ? null
          : decision.capacity
      response =
        decision === undefined || decision.accepted
          ? { kind: 'offer', accepted: true, reason: '', capacity: stated }
          : { kind: 'offer', accepted: false, reason: decision.reason, capacity: stated }
    } else if (request.kind === 'combine') {
      // MR-03 / MR-05 / MR-06. A plain body, not an `RpcReply` — see `runCombine`'s
      // header for why a combine has no egress hold to give back, and for this
      // frame's fetch-amplification disposition.
      response = await runCombine(request, options)
    } else if (request.kind === 'enrol') {
      // AUTH-01 / AUTH-04. Answered by name rather than by falling through into the
      // `exec` branch below — which is where a new request kind lands by default. An
      // enrollment frame reaching the executor would be read as a task with no module
      // and no input.
      //
      // A node holding no signing key answers `error`, not a refusal `result`. The
      // distinction is which question was answered: a refusal says *your request was
      // not granted* and names which of three things was wrong with it, while this
      // says *I am not somewhere that grants them*, which is a fact about this node.
      // Collapsing the two would tell a requestor to fix its proof when it should be
      // asking somebody else.
      //
      // **No capacity slot is taken here, and that is a measurement rather than an
      // omission.** `LocalCapacity` bounds how many units of work are in flight *at
      // once*, and `EnrollmentAuthority.enrol` is fully synchronous — it verifies two
      // signatures and signs one payload with no `await` anywhere in it. Nothing can
      // interleave between a take and a release around a synchronous call, so the
      // count could never read above one and the bound would never bind. Taking a slot
      // here would be a reported bound rather than a measured one, which is the defect
      // this repository keeps finding. What genuinely bounds this branch is AUTH-04's
      // rate limit, one layer in, and it bounds *issuance* per user key.
      //
      // What that leaves open, stated rather than left to be found: a peer sending
      // forged requests is refused before the limiter is reached
      // (`enrollment.ts`' possession-then-consent-then-window ordering), so those cost
      // this node two signature verifications each and consume nobody's budget. That is
      // a CPU surface bounded by NET-08's inbound message ceiling and by nothing else
      // on this branch.
      response =
        options.enroll === 'issues-no-certificates'
          ? { kind: 'error', reason: 'this node issues no certificates' }
          : // `Date.now()` at this boundary is deliberate, and this is the first clock
            // read in production `@o2/net` source — said plainly so the next reader does
            // not have to check. `@o2/core`'s enrollment module takes the clock as a
            // parameter *precisely* so an adapter supplies it, keeping that module free
            // of platform time and its limiter deterministic under test. `Date.now()`
            // behaves identically in both targets `@o2/net` has to run in.
            certifyFreshly(options.enroll, request.request, Date.now())
    } else if (request.kind === 'enrol-challenge') {
      // AUTH-01 freshness, the first leg of the two the enrolment exchange now takes.
      //
      // **Unconditional for a provider that issues at all.** There is no refusal arm here
      // because nothing about this frame can be wrong: it carries no fields, so there is
      // nothing to judge. A node holding no signing key answers `error` for the reason the
      // `enrol` branch above gives — a fact about this node, not about the request.
      //
      // **What this branch costs, stated on the same terms as the branch above.** An
      // unauthenticated peer can mint without ever answering, and each mint is 32 random
      // bytes plus one map entry that `mintChallenge` sweeps out a TTL later. That is
      // strictly cheaper than the two signature verifications an unanswerable `enrol` frame
      // already costs this node, so it widens no surface that was not already accepted —
      // see `enrollment.ts`' header on the deliberately accepted enrolment DoS. It takes no
      // capacity slot for the same measured reason the `enrol` branch does not: minting is
      // synchronous, so nothing can interleave around it and the count could never read
      // above one.
      //
      // **Bound to a local, and the shape deliberately differs from the branch above.**
      // `mutation-ledger.ts`'s `E2` keys on that branch's exact `response =` /
      // `options.enroll === 'issues-no-certificates'` pair, and a second verbatim copy here
      // makes its plant name two sites instead of one — `mutation-guard.node.test.ts` said
      // so by name when this branch was first written the other way. A proof asset is not
      // something to work around silently.
      const issuer = options.enroll
      response =
        issuer === 'issues-no-certificates'
          ? { kind: 'error', reason: 'this node issues no certificates' }
          : { kind: 'enrol-challenge', challenge: issuer.mintChallenge(Date.now()) }
    } else if (request.kind === 'reveal') {
      // VER-02 round 2. Three refusals live in `PendingCommitments.take` and each is a
      // different subject — a name this node never minted, a name that has already been
      // taken or expired, and a name belonging to **another peer**. The third is the
      // serving half of the requirement: a replica that could read a co-replica's answer
      // out of the node holding it would have the peer's answer *before* revealing its
      // own, which is precisely the plagiarism the commitment exists to fix, arriving by
      // a different door.
      //
      // No admission slot is taken, and no executor runs. This branch is a map lookup —
      // the work was paid for on the `commit` that produced the entry, and charging for
      // it twice would let a busy node refuse to hand back an answer it has already
      // computed, stranding a ceremony it agreed to join.
      const taken = pending.take(request.handle, from, Date.now())
      const outcome = taken.ok
        ? ({
            ok: true,
            nonce: taken.pending.nonce,
            output: taken.pending.output,
            fuelUsed: taken.pending.fuelUsed,
            attestation: taken.pending.attestation,
          } as const)
        : ({ ok: false, reason: taken.reason } as const)
      // NET-10, on the branch where the output finally crosses. This is the *only* frame
      // of the ceremony that carries an output, so it is the only one a sovereign payload
      // could ride out on — and although the `commit` branch below refuses sovereign
      // tasks outright, a public task's output can still contain registered bytes, which
      // is exactly the case NET-10 exists for. The scan is the `exec` branch's, verbatim
      // in shape.
      const candidateBody = encodeResponse({ kind: 'reveal', outcome })
      const violated = refusedReason(options.egress, from, candidateBody, executor.nodeId)
      return violated === null
        ? candidateBody
        : encodeResponse({ kind: 'reveal', outcome: { ok: false, reason: violated } })
    } else {
      // `exec` and `commit` share this branch, because a commit **is** an exec whose
      // answer is withheld. Everything the two have in common — the derived slot key,
      // admission, authorisation, the dispatch report, the executor call, the release in
      // `finally` — happens once, and the two diverge only at the reply. A second branch
      // would be a second admission path and a second authorisation call site, and this
      // repository has already recorded what that costs once: `16-06`'s ruling on the
      // combine branch is that a second gate beside an existing one is worse than
      // widening the existing one.
      //
      // The consequence that matters most is the authorisation one. `authorize` is
      // called below with `kind: 'exec'` on both, so **every `Authorizer` ever written
      // against this codebase already covers the ceremony** without being told it
      // exists. Had the commit path passed a new discriminant, every authorizer would
      // have fallen through its `exec` case and admitted a commit it would have refused
      // as an exec — and the peer would collect the answer in round 2 having never been
      // entitled to round 1.
      const ceremony = request.kind === 'commit'

      // VER-02 is a **public-tier** mechanism, and this is where that is enforced rather
      // than assumed. `.planning/PROJECT.md`'s integrity table splits the claim: public
      // data gets N-version redundancy with commit-reveal, sovereign data is
      // owner-attested and the verified thing is the aggregation over contributions. A
      // ceremony over an owner's own two nodes resists nothing — both replicas are the
      // owner's — while its *presence* would invite a reader to infer the independence
      // the receipt explicitly denies (`owner-domain` is a weaker claim than
      // `independent`, VER-10).
      //
      // Refused on the `commit` arm rather than silently degraded to an `exec`, because
      // a requestor that asked for a ceremony and got an ordinary execution back would
      // have no way to tell. Named, so the requestor learns which tier it is on.
      if (ceremony && request.task.label === 'sovereign') {
        return encodeResponse({
          kind: 'commit',
          outcome: {
            ok: false,
            reason: `commit refused: the commit-reveal ceremony runs on public shards only, and this task is labelled sovereign on ${executor.nodeId}`,
          },
        })
      }

      // Claimed before the executor runs, for the reason `PendingCommitments.reserve`
      // states: a node already holding its limit of unrevealed answers declines the work
      // rather than performing it and then finding nowhere to put the result.
      const reserved = ceremony ? pending.reserve(Date.now()) : null
      if (reserved !== null && !reserved.ok) {
        return encodeResponse({ kind: 'commit', outcome: { ok: false, reason: reserved.reason } })
      }

      // SCHED-06 — admission, on the branch that actually costs a
      // `WebAssembly.compile` plus an `instantiate` plus a linear memory.
      //
      // The slot key has to be *derived*, because an `exec` request carries no
      // shard id. `inputCid` plus `partitionIndex` is the task's own identity,
      // and both consequences of using it are wanted:
      //
      // - a duplicate dispatch of the **identical** task to this node while the
      //   first is still running is refused with a stated reason. That is
      //   correct: it is the same work, and speculation is supposed to place the
      //   duplicate somewhere else.
      // - one requestor cannot occupy N slots here by replaying one task.
      //
      // The rejected alternative is a per-request monotonic id. It never
      // collides, so the dedupe never fires — which throws away the one
      // behaviour `LocalCapacity` was built with and re-opens the replay hole.
      //
      // The assumption the key rests on: `inputCid` plus `partitionIndex`
      // identifies a unit of in-flight work. It holds because `submitJob`
      // content-addresses every shard input, so two jobs over identical input
      // bytes are the same computation.
      const capacity = options.capacity === 'accepts-every-offer' ? null : options.capacity
      const slotKey = `${request.task.inputCid.toString()}:${request.task.partitionIndex}`
      if (capacity !== null) {
        const admission = capacity.offer({ shardId: slotKey, nodeId: executor.nodeId })
        if (!admission.accepted) {
          // Refused **before** the `try`, not inside it: a refused request must
          // not run the executor, so it must not enter the block that calls it.
          //
          // `{kind:'error'}` and not `{kind:'exec', outcome:{ok:false}}`.
          // `churn.ts`'s classification table calls `error` a **node**
          // condition — reachable, refusing to serve *this* — which is the retry
          // policy a capacity refusal wants, because the same task on another
          // node succeeds. An `exec ok:false` classifies as **task**, which was
          // the kind a scheduler gave up on quickly, so a busy peer answering
          // that way could condemn a perfectly good shard.
          //
          // **The consequence half of that is now latent, and saying so is the
          // point of a comment.** Plan 20-12 deleted `runResilient`, the only
          // thing that ever branched on the kind, along with the task-failure
          // budget it was counted against; `submitJob` bounds every failure at
          // `DEFAULT_MAX_GENERATIONS` instead and cannot see kinds at all. So the
          // shape chosen here is still the right one and is still classified,
          // but nothing downstream currently acts on the difference. If a kind
          // reaches `ExecutionOutcome` — `20-CONTEXT.md`'s deferred item — this
          // branch is already correct and needs no revisiting.
          //
          // The cost of reusing the shape, recorded rather than left to be
          // discovered: a requestor cannot tell `malformed request` from
          // `over-committed: …` without reading the string. That is acceptable
          // here because `AgentResponse.error.reason` is consumed as an
          // explanation, while `RpcFailure` carries a typed detail precisely
          // because *it* is consumed to decide control flow. The
          // `over-committed: ` prefix is therefore part of the wire vocabulary,
          // and is asserted by test so it cannot drift.
          return encodeResponse({ kind: 'error', reason: admission.reason })
        }
      }
      // Taken before the executor runs, because `RpcBlockSource` may send frames over
      // this same guarded transport while it runs, and given back only by the value
      // returned here. A dispatch that declares nothing gets `null` and has nothing
      // to give back — which is the state that used to be unrepresentable, and the
      // reason one public exec could strip a sovereign payload's guard.
      const egress = options.egress
      const hold =
        egress === 'holds-no-registrations'
          ? null
          : await takeSovereignHold(request.task, {
              blockstore: egress.sovereignInputs,
              guard: egress.guard,
            })

      // Everything that can throw is inside this try, and the catch turns it into a
      // named outcome. That is needed here for the release path — an exit that
      // propagates out of this handler never reaches `afterSent` below — and it
      // fixes something on its own account, which a reader should see was intended
      // rather than accidental: a throwing executor used to reach `rpc.ts`'s
      // handler catch, which replies `{error: …}`. `parseResponse` does not
      // recognise that shape, so the requestor reported the response *malformed*
      // and the actual reason was lost on the way home.
      let outcome
      try {
        // Authorisation first. The ordering is the requirement: refusing after
        // execution would already have run the module against the owner's data.
        const refusal =
          options.authorize === 'serves-unauthenticated'
            ? null
            : options.authorize({
                kind: 'exec',
                task: request.task,
                capability: request.capability ?? [],
              })
        if (refusal === null) {
          // On the line above the call it reports. What the surface claims is work
          // this node ran; a request refused for capacity or for capability is not
          // that, and the adjacency is what stops a future gate slipping between
          // the count and the run. Inside the `try` so a throwing listener becomes
          // a named outcome with the slot released below, rather than escaping
          // into `rpc.ts` and coming home to the requestor as a malformed reply.
          if (options.onDispatch !== 'reports-no-dispatch') options.onDispatch(from)
          outcome = await executor.execute(request.task)
        } else {
          outcome = { ok: false as const, reason: `unauthorized: ${refusal}` }
        }
      } catch (cause) {
        outcome = {
          ok: false as const,
          reason: `execution failed on ${executor.nodeId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }
      } finally {
        // Released here and not in `afterSent`. The slot is about **execution**
        // concurrency; holding it until the reply frame settles would couple a
        // CPU bound to a network latency. That is the opposite of the reasoning
        // that puts the *egress* release in `afterSent`, where the thing being
        // waited for really is the frame.
        //
        // Every exit releases — success, a failed outcome, a throw, and the
        // `authorize` refusal above, which never called the executor at all. A
        // node that admits correctly and never releases is indistinguishable
        // from a working node for exactly `slots` tasks and then refuses
        // everything forever.
        capacity?.release(slotKey)
      }

      if (ceremony) {
        // ── VER-02 round 1's reply ────────────────────────────────────────────────
        //
        // The two paths diverge here and nowhere earlier. Everything above ran
        // identically for an `exec`; what a ceremony changes is that the answer stays
        // on this node and only its digest crosses.
        //
        // **This node draws the nonce and computes the digest.** Both halves are here,
        // on the executing side, and that placement is the entire correction to the
        // ceremony deleted in `855cdf5` — there the requestor minted the nonce and
        // compared a digest with itself, so the check could not be false. Here the
        // requestor receives a value it did not produce and cannot reproduce until
        // round 2 hands it the nonce.
        //
        // There is no egress hold to release and no `afterSent` to schedule: the
        // sovereign arm was refused at the top of this branch, so `takeSovereignHold`
        // answered `null` by the same `label !== 'sovereign'` test. The output does not
        // cross on this frame at all — it crosses on the `reveal`, which does its own
        // NET-10 scan.
        if (!outcome.ok) {
          return encodeResponse({ kind: 'commit', outcome: { ok: false, reason: outcome.reason } })
        }
        const hashed = await canonicalCid(outcome.output)
        if (!hashed.ok) {
          // Reported as this node's refusal to commit, not as a broken frame — the same
          // disposition `runOne` takes in `verify.ts` when the codec refuses an output.
          return encodeResponse({
            kind: 'commit',
            outcome: {
              ok: false,
              reason: `output not encodable on ${executor.nodeId}: ${JSON.stringify(hashed.error)}`,
            },
          })
        }
        const nonce = drawCeremonyNonce()
        const digest = await commitmentDigest(nonce, request.task, hashed.cid)
        const handle = (reserved as { readonly ok: true; readonly handle: string }).handle
        pending.file(handle, {
          committedBy: from,
          nonce,
          output: outcome.output,
          fuelUsed: outcome.fuelUsed,
          attestation: outcome.attestation,
          at: Date.now(),
        })
        return encodeResponse({ kind: 'commit', outcome: { ok: true, digest, handle } })
      }

      if (egress === 'holds-no-registrations') return encodeResponse({ kind: 'exec', outcome })
      // NET-10. The candidate reply is encoded once and asked about before it is
      // handed to the exit; on a hit it is replaced by a frame that, by
      // construction, cannot carry the payload it refuses. `rpc.ts` is untouched:
      // its responding leg still swallows a send failure by design, and
      // `EgressGuard.send` still refuses on its own — this is the fast path, not
      // the guarantee.
      const candidateBody = encodeResponse({ kind: 'exec', outcome })
      const violated = refusedReason(egress, from, candidateBody, executor.nodeId)
      const body =
        violated === null
          ? candidateBody
          : encodeResponse({ kind: 'exec', outcome: { ok: false, reason: violated } })
      // Given back here rather than where the hold was taken, because the frame it
      // exists to be scanned against is *this reply*, which has not been sent yet at
      // the moment `execute` resolves. `rpc.ts` invokes this in a `finally` around the
      // response send, which is the first moment the frame has settled. The pre-scan
      // does not move it: both exits still have a frame in flight.
      return hold === null ? body : { body, afterSent: () => hold.release() }
    }
    return encodeResponse(response)
  }

  // A serving fault is this node's condition, not a statement about the fabric.
  // Uncaught it reaches `rpc.ts`'s handler catch, which replies `{error: …}` — a
  // shape with no `kind`, so `parseResponse` returns null and a node that
  // physically cannot read the block says the same thing as one that simply does
  // not have it. Caught here rather than per branch because the bug is an
  // omission: a branch added later inherits the treatment instead of having to
  // remember it.
  //
  // Two things this deliberately does not do. It does not merge with the exec
  // branch's own catch — that one produces a *task* condition with the slot
  // released, this one a *node* condition, and the two want opposite retry
  // policies. And it leaves `RpcBlockSource` treating any non-`block` reply as a
  // miss, so one broken peer still cannot deny a multi-peer fetch.
  //
  // What stays open, so it is not rediscovered as new: a throw after
  // `takeSovereignHold` succeeds still leaks the hold, exactly as it did before
  // this catch existed, because the release lives only in the returned
  // `afterSent`. And the catch is broad — a programming error in here now leaves
  // by the wire, to an unauthenticated requestor, and this pure module has no
  // logger to say so anywhere else.
  rpc.serve(async (from, body) => {
    try {
      return await answer(from, body)
    } catch (cause) {
      return encodeResponse({
        kind: 'error',
        reason: `serving failed on ${executor.nodeId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  })
}
