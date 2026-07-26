/**
 * Discovery and admission over RPC — SCHED-01, SCHED-03, NET-06.
 *
 * The kernel's `discoverExecutors` works against a `RecordIndex` port and knows
 * nothing about how the answers arrive. This is the adapter that makes the port a
 * real network lookup: ask peers, take the first useful answer.
 *
 * **A peer is asked, not classified.** `RpcRecordIndex` takes a thunk returning the
 * peers to ask, so the set is whatever is currently connected. Nothing here inspects
 * what kind of node a peer is — a browser tab that holds a relay reservation answers
 * a `providers` request exactly as a listening server does, and both are simply
 * entries in the list. That is NET-06 as code rather than as a comment: there is no
 * branch that could treat one differently, because there is no field to branch on.
 *
 * **An unreachable peer is skipped, not fatal.** Discovery from a coffee shop means
 * half the peers you know are gone. A failed request moves to the next one.
 *
 * Pure module.
 */

import type { CID } from 'multiformats/cid'
import type { Admission, CanonicalValue, NodeRecords, Offer, PublicKeyHex, RecordIndex } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { AgentResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

/**
 * A `RecordIndex` served by peers over RPC.
 *
 * Queries peers in order and returns the first non-empty answer. It does *not*
 * merge answers from every peer: a lookup that waited for all of them would be as
 * slow as the slowest, and the first peer holding the record is enough to proceed.
 * A caller that wants a fuller picture asks again with a different peer order.
 */
export class RpcRecordIndex implements RecordIndex {
  readonly #rpc: RpcEndpoint
  readonly #peers: () => readonly string[]

  constructor(rpc: RpcEndpoint, peers: () => readonly string[]) {
    this.#rpc = rpc
    this.#peers = peers
  }

  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    for (const peer of this.#peers()) {
      const response = await this.#ask(peer, encodeRequest({ kind: 'providers', cid }))
      if (response?.kind !== 'providers') continue
      if (response.nodeKeys.length > 0) return response.nodeKeys
    }
    return []
  }

  async recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    for (const peer of this.#peers()) {
      const response = await this.#ask(peer, encodeRequest({ kind: 'records', nodeKey }))
      if (response?.kind !== 'records') continue
      if (response.records !== null) return response.records
    }
    return undefined
  }

  async #ask(peer: string, body: CanonicalValue): Promise<AgentResponse | null> {
    try {
      return parseResponse(await this.#rpc.request(peer, body))
    } catch {
      return null // unreachable peer — ask the next one
    }
  }
}

/**
 * How long an offer waits before the requestor gives up and asks someone else.
 *
 * Deliberately far below `DEFAULT_RPC_TIMEOUT_MS`. An offer is a cheap probe whose
 * entire value is being cheap: power-of-d exists so a placement decision costs two
 * questions instead of a global view, and that saving evaporates if one dead node
 * stalls the decision for thirty seconds. Silence is treated as a refusal — which is
 * correct, because from the requestor's side "you did not answer" and "I am full"
 * have the same consequence, and a node that answers late has told us nothing about
 * whether it can take work *now*.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000

export interface AdmissionOptions {
  readonly probeTimeoutMs?: number
}

/**
 * Ask a node whether it will take a shard — SCHED-03.
 *
 * Every failure is a refusal *with a stated reason*, never an exception: a dead peer
 * must show up in the rejection list next to a busy one, or "why did this land here"
 * becomes unanswerable after the fact.
 */
export function rpcAdmission(
  rpc: RpcEndpoint,
  options: AdmissionOptions = {},
): (offer: Offer) => Promise<Admission> {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS

  const ask = async (offer: Offer): Promise<Admission> => {
    let body: CanonicalValue
    try {
      body = await rpc.request(offer.nodeId, encodeRequest({ kind: 'offer', shardId: offer.shardId }))
    } catch (cause) {
      return {
        accepted: false,
        reason: `unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }
    const response = parseResponse(body)
    if (response?.kind !== 'offer') return { accepted: false, reason: 'malformed offer response' }
    return response.accepted ? { accepted: true } : { accepted: false, reason: response.reason }
  }

  return async (offer: Offer): Promise<Admission> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<Admission>((resolve) => {
      timer = setTimeout(
        () => resolve({ accepted: false, reason: `unreachable: no answer in ${probeTimeoutMs}ms` }),
        probeTimeoutMs,
      )
    })
    try {
      // `ask` resolves rather than rejects, so the losing side of this race can never
      // surface as an unhandled rejection when the probe times out first.
      return await Promise.race([ask(offer), expired])
    } finally {
      clearTimeout(timer)
    }
  }
}
