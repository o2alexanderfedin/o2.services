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
import type { AgentResponse } from './protocol.ts'
import type { RpcEndpoint, RpcReply } from './rpc.ts'

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

/** Decides whether a dispatched task may run. Returning a string refuses it. */
export interface Authorizer {
  (request: { readonly task: Task; readonly capability: readonly Delegation[] }): string | null
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
   * BROW-04. Called when a peer dispatches a task here, before it runs.
   *
   * The always-visible surface has to say what is running *and for whom*, and the
   * executor cannot answer the second half — a `Task` is addressed entirely by CID
   * and carries no requestor. Only the serving side knows, and only here. Pass
   * `'reports-no-dispatch'` for a node with nothing watching its dispatches.
   */
  readonly onDispatch: ((from: string) => void) | 'reports-no-dispatch'
  /**
   * DATA-05. The tap this endpoint's sends go out through, so a sovereign task's
   * registration can be released once its reply frame has settled.
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
  readonly egress: EgressGuard | 'holds-no-registrations'
}

/** Install the request handler that makes this endpoint a serving node. */
export function serveAgent(options: AgentOptions): void {
  const { rpc, executor, blockstore } = options

  rpc.serve(async (from, body): Promise<CanonicalValue | RpcReply> => {
    const request = parseRequest(body)
    if (request === null) {
      return encodeResponse({ kind: 'error', reason: 'malformed request' })
    }

    let response: AgentResponse
    if (request.kind === 'block') {
      const bytes = await blockstore.get(request.cid)
      response = { kind: 'block', bytes: bytes ?? null }
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
    } else {
      if (options.onDispatch !== 'reports-no-dispatch') options.onDispatch(from)

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
                task: request.task,
                capability: request.capability ?? [],
              })
        outcome =
          refusal === null
            ? await executor.execute(request.task)
            : { ok: false as const, reason: `unauthorized: ${refusal}` }
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
      const egress = options.egress
      if (egress === 'holds-no-registrations') return encodeResponse({ kind: 'exec', outcome })
      const label = request.task.inputCid.toString()
      return {
        body: encodeResponse({ kind: 'exec', outcome }),
        // Released here rather than where the guard and the label are both already
        // in scope — inside `registerSovereignInputs` — because the frame the
        // registration exists to be scanned against is *this reply*, which has not
        // been sent yet at the moment `execute` resolves. `rpc.ts` invokes this in
        // a `finally` around the response send, which is the first moment the frame
        // has settled.
        //
        // Unconditional on the label rather than re-testing whether the task was
        // sovereign: `release` for a label it does not hold is a no-op, so the
        // unconditional form cannot leak if registration's own condition ever
        // changes, while a conditional form would have to be kept in step with it.
        afterSent: () => {
          egress.release(label)
        },
      }
    }
    return encodeResponse(response)
  })
}
