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
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import type { AgentResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

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
   * SCHED-03. Answers offers from this node's own counters.
   *
   * The node is the only authority on whether it can take more work; a requestor's
   * load figure is a hint that may be seconds stale. Pass `'accepts-every-offer'` to
   * accept everything, which is right for a node that never refuses.
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
}

/** Install the request handler that makes this endpoint a serving node. */
export function serveAgent(options: AgentOptions): void {
  const { rpc, executor, blockstore } = options

  rpc.serve(async (from, body): Promise<CanonicalValue> => {
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
      const decision =
        options.capacity === 'accepts-every-offer'
          ? undefined
          : options.capacity.offer({ shardId: request.shardId, nodeId: executor.nodeId })
      response =
        decision === undefined || decision.accepted
          ? { kind: 'offer', accepted: true, reason: '' }
          : { kind: 'offer', accepted: false, reason: decision.reason }
    } else {
      if (options.onDispatch !== 'reports-no-dispatch') options.onDispatch(from)
      // Authorisation first. The ordering is the requirement: refusing after
      // execution would already have run the module against the owner's data.
      const refusal =
        options.authorize === 'serves-unauthenticated'
          ? null
          : options.authorize({
              task: request.task,
              capability: request.capability ?? [],
            })
      response =
        refusal === null
          ? { kind: 'exec', outcome: await executor.execute(request.task) }
          : { kind: 'exec', outcome: { ok: false, reason: `unauthorized: ${refusal}` } }
    }
    return encodeResponse(response)
  })
}
