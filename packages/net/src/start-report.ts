/**
 * Publishing a start outcome, and reading back what the fabric knows — BROW-02.
 *
 * ## The failure and the reporting channel share a cause
 *
 * A node blocked from starting usually cannot reach a peer, and a node that cannot
 * reach a peer cannot say so. That is not a gap to be engineered away — it is the
 * blocklist cliff itself, seen from the inside. So this function returns how many
 * peers it actually reached alongside the numbers, and a caller that reached none
 * has learned something rather than nothing.
 *
 * ## Why every peer is asked
 *
 * There is no aggregator and no privileged node. Each peer answers with what it has
 * been told, the caller merges those into its own ledger, and the merged view is
 * whatever this node has managed to hear. Two nodes will disagree, and that is
 * correct — this is gossip about reachability, not a ledger of record, and the
 * report says as much by publishing `n` beside every rate.
 *
 * Counts are unauthenticated: a peer can inflate its own. Stated plainly because
 * the measurement is about whether *browsers* block the node, and it is not
 * evidence about peers.
 *
 * Pure module — the endpoint and the peer list arrive as parameters.
 */

import { StartOutcomeLedger } from '@o2/core'
import type { CanonicalValue, StartOutcome, StartReport } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

export interface PublishOptions {
  readonly rpc: RpcEndpoint
  /** Live peer list. A thunk so a peer that arrives late is still asked. */
  readonly peers: () => readonly string[]
  /** This node's own outcome, or `null` to ask without telling. */
  readonly outcome: StartOutcome | null
  /** Visitors this node knows chose not to be counted. */
  readonly declined?: number
  /** Cap on peers contacted, so a large mesh does not turn one page load into a fan-out. */
  readonly maxPeers?: number
}

export interface PublishResult {
  /** Peers that answered. Zero is the interesting case, not an error. */
  readonly reached: number
  /** Peers that were asked. `asked > 0 && reached === 0` is the cliff. */
  readonly asked: number
  readonly report: StartReport
}

/** Enough to see a rate without turning one page load into a broadcast storm. */
export const DEFAULT_MAX_PEERS = 8

export async function publishStartOutcome(options: PublishOptions): Promise<PublishResult> {
  const declined = options.declined ?? 0
  const ledger = new StartOutcomeLedger()
  // The local outcome counts even if nothing else can be reached — a report of one
  // is still a report, and it is the only one a blocked visitor can produce.
  if (options.outcome !== null) ledger.record(options.outcome)
  ledger.decline(declined)

  const peers = options.peers().slice(0, options.maxPeers ?? DEFAULT_MAX_PEERS)
  let reached = 0

  for (const peer of peers) {
    let body: CanonicalValue
    try {
      body = await options.rpc.request(
        peer,
        encodeRequest({ kind: 'report', outcome: options.outcome, declined }),
      )
    } catch {
      continue // unreachable peer — exactly the case this metric exists to count
    }
    const response = parseResponse(body)
    if (response === null || response.kind !== 'report') continue
    reached += 1
    // Overlapping, emphatically not disjoint: every peer answers about the same
    // population, and each has already been told this node's own outcome by the
    // request that just went out. Summing would multiply the sample size by the
    // number of peers asked while leaving the percentages unchanged — a rate over
    // a fictional `n`, which is the one failure mode a report like this must not
    // have.
    ledger.mergeOverlapping(response.counts, response.declined)
  }

  return { reached, asked: peers.length, report: ledger.report() }
}
