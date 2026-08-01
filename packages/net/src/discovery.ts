/**
 * Discovery and admission over RPC — SCHED-01, SCHED-03, NET-06.
 *
 * The kernel's `discoverExecutors` works against a `RecordIndex` port and knows
 * nothing about how the answers arrive. This is the adapter that makes the port a
 * real network lookup.
 *
 * **A peer is asked, not classified.** `RpcRecordIndex` takes a thunk returning the
 * peers to ask, so the set is whatever is currently connected. Nothing here inspects
 * what kind of node a peer is — a browser tab that holds a relay reservation answers
 * a `providers` request exactly as a listening server does, and both are simply
 * entries in the list. That is NET-06 as code rather than as a comment: there is no
 * branch that could treat one differently, because there is no field to branch on.
 *
 * **An unreachable peer is skipped, not fatal.** Discovery from a coffee shop means
 * half the peers you know are gone. A failed `records` request moves to the next
 * peer; a failed `providers` request contributes nothing to the union the others
 * form. Neither fails the lookup.
 *
 * **The two halves resolve differently, and {@link RpcRecordIndex}'s doc says why** —
 * `providers` unions across every peer, `recordsFor` takes the first answer. Read that
 * before changing either: they are not two spellings of one policy.
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
 * ## `providers` unions and `recordsFor` does not, and the asymmetry is the point
 *
 * This class used to argue for first-non-empty on both halves: *"a lookup that waited
 * for all of them would be as slow as the slowest, and the first peer holding the
 * record is enough to proceed."* That argument was correct while one index held
 * everybody's records. Under owner ruling **D1** it is false for one of the two
 * halves, and the two halves are now genuinely different questions.
 *
 * A **record** is a signed document. One copy of it is the whole of it: every field is
 * covered by a signature `discoverExecutors` verifies against a pinned issuer, so a
 * second copy from a second peer could only agree with the first or be discarded.
 * First-non-empty is the right answer and stays.
 *
 * A **provider list** is a *set*, and under D1 each node answers `providers` only
 * about its own store. So the first non-empty answer is exactly **one** element, and
 * every other provider of that block is invisible to the requestor — however many
 * peers hold it. Power-of-d sampling over one candidate is not sampling. It unions.
 *
 * ## What the union costs, stated rather than left to be discovered
 *
 * The lookup now pays the **slowest** peer instead of the fastest, and a peer that
 * answers nothing costs the full `RpcEndpoint` budget — `DEFAULT_RPC_TIMEOUT_MS`
 * (`rpc.ts:25`) unless the endpoint was given its own — on **every** lookup, rather
 * than being skipped once a fast answer had already arrived. Both are accepted, and
 * the second is measured rather than asserted: `provider-merge.test.ts` puts a silent
 * peer beside an answering one and reads the elapsed time against the endpoint's own
 * configured budget.
 *
 * A peer that fails *fast* — an unknown id, a partitioned link — costs nothing, because
 * the transport rejects before any budget is entered. The expensive case is silence,
 * not absence.
 *
 * No probe deadline is adopted for it. {@link DEFAULT_PROBE_TIMEOUT_MS} exists in this
 * file and is a number chosen for a different question — how long an *offer* may take
 * — and reusing it here would be a quantity nobody measured for this one. What would
 * change this is a measurement, and there is not one.
 *
 * ## The reach is directly-connected peers only
 *
 * No transitive routing and no DHT: the answer covers the peers this endpoint is
 * currently connected to, and nothing beyond them. That is the fabric's existing shape
 * rather than a new restriction, but it is the honest limit of what a discovery answer
 * covers and it is stated here because a caller reading this class would otherwise
 * assume the answer is global.
 *
 * ## Neither half classifies a peer
 *
 * See this module's header: the peers thunk returns whatever is currently connected
 * and there is no field on which either half could branch on what kind of node a peer
 * is. Both changes above are about *how many* answers are used, never about *whose*.
 */
export class RpcRecordIndex implements RecordIndex {
  readonly #rpc: RpcEndpoint
  readonly #peers: () => readonly string[]

  constructor(rpc: RpcEndpoint, peers: () => readonly string[]) {
    this.#rpc = rpc
    this.#peers = peers
  }

  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    // Concurrently, not in sequence: a union already pays the slowest peer, so asking
    // one at a time would pay the *sum* of all of them for no benefit at all.
    const answers = await Promise.all(
      this.#peers().map(async (peer) => this.#ask(peer, encodeRequest({ kind: 'providers', cid }))),
    )
    const found = new Set<PublicKeyHex>()
    for (const response of answers) {
      // `#ask` swallowed a transport error, which is right here: a peer that could not
      // be reached contributes nothing to a union and there is no verdict being formed
      // about it. An empty answer is likewise a real answer and not a reason to stop.
      if (response?.kind !== 'providers') continue
      for (const nodeKey of response.nodeKeys) found.add(nodeKey)
    }
    // Deduplicated and sorted, so two peers naming the same key produce one entry and
    // the answer does not depend on the order the peers happened to reply in.
    // `discoverExecutors` does this again on what it is handed; that is its business,
    // and this adapter is honest on its own rather than relying on the kernel.
    return [...found].sort()
  }

  /**
   * Unchanged, and deliberately so — see the class doc's first section.
   *
   * Sequential with an early return: the second peer is not asked once the first has
   * answered, which is the whole difference from {@link RpcRecordIndex.providers} and
   * is asserted by a request counter in `provider-merge.test.ts`.
   */
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
      return null // unreachable peer — contributes nothing, fails nothing
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
