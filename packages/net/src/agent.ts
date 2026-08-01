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
import { MAX_PARTIAL_BYTES, canonicalCid, decodeCanonical, encodeCanonical, fabricCombiner } from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  Delegation,
  Executor,
  LocalCapacity,
  RecordIndex,
  StartOutcomeLedger,
  Task,
} from '@o2/core'
import type { BlockSource } from './block.ts'
import type { EgressGuard } from './egress.ts'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import type { AgentRequest, AgentResponse } from './protocol.ts'
import type { RpcEndpoint, RpcReply } from './rpc.ts'
import { takeSovereignHold } from './sovereign-egress.ts'

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
   * SCHED-03 / SCHED-06. Answers offers, and admits execs, from this node's own
   * counters.
   *
   * The node is the only authority on whether it can take more work; a requestor's
   * load figure is a hint that may be seconds stale.
   *
   * The two branches use it differently, and the difference is the whole of
   * SCHED-06:
   *
   * - **`exec`** takes a slot before the executor is called and returns it in a
   *   `finally` immediately after — including on a throw and on an `authorize`
   *   refusal. Over the limit it replies `{kind:'error'}` with the node's own
   *   `over-committed: N of M slots in use`, before the executor is reached.
   * - **`offer`** reads the same counters through `would` and takes **nothing**.
   *   An offer is a question, and a liveness prober asking it must not fill the
   *   slot table of every peer it can see.
   *
   * Pass `'accepts-every-offer'` to opt out of both, which is right for a node
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
  readonly egress:
    | { readonly guard: EgressGuard; readonly sovereignInputs: Blockstore }
    | 'holds-no-registrations'
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
 * **Fetch amplification on this frame: bounded, accepted, and not closed.** This
 * handler is where an unauthenticated `combine` turns into work, so the disposition
 * belongs here rather than at the parser that flagged it.
 *
 * What actually bounds it, all three measurable:
 *
 * 1. `MAX_COMBINE_INPUTS` bounds *k* at the **parser** — a frame naming more inputs
 *    than that never becomes a request, so this function is never entered for one.
 * 2. The loop below is **sequential with an early return**, never a `Promise.all`. The
 *    first input this node refuses ends the frame's cost at the inputs before it, so a
 *    frame naming 64 CIDs whose second is oversized costs two reads and not 64. That
 *    is a property of the loop's shape, and it is asserted in `combine.test.ts`.
 * 3. A node whose `Authorizer` refuses this combine pays **zero** reads, because that
 *    refusal happens before the loop is entered. Until 16-05 this line said *"a node
 *    with a real `Authorizer`"*, which was true only while every such node refused every
 *    combine — the defect 16-05 removed. An authorizer that *admits* now pays the reads,
 *    which is what bounds 1 and 2 above are for.
 *
 * What is **not** closed, stated rather than left to be inferred: a node serving
 * unauthenticated still answers up to `MAX_COMBINE_INPUTS` reads per frame, and each
 * read through a `FetchingBlockstore` has by then already pulled the block over the
 * wire, hash-verified it and written it to the local store. So `MAX_PARTIAL_BYTES`
 * below bounds what this node will **merge**, never what a peer can make it transfer
 * or keep. There *is* a wire ceiling underneath and it is worth naming precisely so
 * nobody reads more into this than it carries: NET-08 has landed, and
 * `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`) bounds any single inbound message with a
 * per-peer cap on concurrent accumulation beside it. NET-08 bounds *one message*;
 * `MAX_COMBINE_INPUTS` bounds *how many* one frame may provoke. No product of the two
 * is written here — a residency figure nobody measured against a running node is not a
 * guarantee. This surface is the same *kind* the `exec` and `block` branches already
 * present, and the general answer to it is per-request admission (SCHED-06), not a
 * second bound invented for this branch alone.
 */
async function runCombine(
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
    return { kind: 'combine', resultCid: null, reason: `unauthorized: ${refusal}` }
  }

  const inputs: CanonicalValue[] = []
  for (const cid of request.inputCids) {
    const bytes = await options.blockstore.get(cid)
    if (bytes === undefined) {
      return { kind: 'combine', resultCid: null, reason: `combine input ${cid.toString()} not held and not obtainable` }
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
      }
    }
    let decoded: CanonicalValue
    try {
      decoded = decodeCanonical(bytes)
    } catch {
      return { kind: 'combine', resultCid: null, reason: `combine input ${cid.toString()} did not decode` }
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
    }
  }
  // The put is what makes the result retrievable by CID like any other block, and it
  // is what makes a late duplicate free: same inputs, same bytes, same CID, no second
  // entry. It writes to this node's own local tier and nowhere else — the requestor
  // fetches it back deliberately, by CID, from this peer (`remoteCombineDispatch`).
  await options.blockstore.put(hashed.bytes)
  return { kind: 'combine', resultCid: hashed.cid, reason: '' }
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

  const answer = async (from: string, body: CanonicalValue): Promise<CanonicalValue | RpcReply> => {
    const request = parseRequest(body)
    if (request === null) {
      return encodeResponse({ kind: 'error', reason: 'malformed request' })
    }

    let response: AgentResponse
    if (request.kind === 'block') {
      const bytes = await blockstore.get(request.cid)
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
      const violated = refusedReason(options.egress, from, encodeResponse(found), executor.nodeId)
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
      // *What is lost.* `placeWithOffers` removes a probed candidate from the
      // pool for **one** shard, and `pool` is rebuilt per request, so across
      // shards the only thing that made wire-side placement over-commit-safe was
      // the reservation — `planWithOffers`' own comment in `@o2/core` says
      // exactly that. With `would()` reserving nothing, `planWithOffers` +
      // `rpcAdmission` will place all N shards of a job on one node with
      // `maxConcurrent: 1`. **Wire-side multi-shard over-commit protection is
      // removed by this change and is Phase 18's to rebuild.** `discovery.test.ts`
      // pins the consequence so it is visible rather than silent. The two
      // candidate mechanisms, so the next reader need not rediscover them: carry
      // the shard id on the `exec` request so an offer reservation can be
      // redeemed and released, or publish the node's slot count in the `offer`
      // response so a requestor can keep its own tally across a placement
      // generation. Both are protocol changes; this phase makes neither.
      //
      // *Why it is still right now.* The node-side bound is what SCHED-06 asks
      // for, and it is the only one that binds a peer which never probes at all.
      // The requestor-side bound was advisory even before this change — nothing
      // forces a requestor to probe.
      const decision =
        options.capacity === 'accepts-every-offer'
          ? undefined
          : options.capacity.would({ shardId: request.shardId, nodeId: executor.nodeId })
      response =
        decision === undefined || decision.accepted
          ? { kind: 'offer', accepted: true, reason: '' }
          : { kind: 'offer', accepted: false, reason: decision.reason }
    } else if (request.kind === 'combine') {
      // MR-03 / MR-05 / MR-06. A plain body, not an `RpcReply` — see `runCombine`'s
      // header for why a combine has no egress hold to give back, and for this
      // frame's fetch-amplification disposition.
      response = await runCombine(request, options)
    } else {
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
          // node succeeds. An `exec ok:false` classifies as **task** and burns
          // against `DEFAULT_MAX_TASK_FAILURES`, which would let a busy peer
          // condemn a perfectly good shard.
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
