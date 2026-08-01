/**
 * From a data CID to a dispatchable candidate set — SCHED-01's requestor half.
 *
 * ## What this closes
 *
 * `discoverExecutors` (`@o2/core`) has had **no caller outside test files since
 * Phase 6**, and the reason it had none is visible in its return type: a discovery
 * answer names **node keys**, while `RemoteExecutor` dispatches to the id the
 * *transport* knows. Nothing mapped between them, so there was no way to turn an
 * answer into something you could send work to. This is that bridge, and it is the
 * whole of it: a data CID and a list of peers in, `RemoteExecutor`s and
 * `NodeDescriptor`s out, correlated by `nodeId` so `submitJob` takes them directly.
 *
 * ## Why `peerIdFor` is an argument and not an import
 *
 * The derivation lives in `@o2/libp2p` as `peerIdForNodeKey`, and `@o2/net` does not
 * depend on that package — it is the PORTABLE tier and must stay free of libp2p so it
 * runs unchanged in a browser, in Node, and over the in-process transport. Taking the
 * mapping as a **function** keeps this module pure. A caller on the Node or browser
 * tier passes `peerIdForNodeKey` itself; a caller over `MemoryNetwork` passes whatever
 * its own key-to-address table says.
 *
 * ## Which peers to ask is the caller's decision, and it is load-bearing
 *
 * Passing `() => node.verifiedPeers` means an unverified peer is never asked for a
 * provider list and never contributes a dispatch candidate. Passing
 * `() => node.transport.peers` means it may. **This module does not choose**, because
 * it cannot know whether the caller pinned an issuer at all: a node with no
 * `trustedIssuers` has a `verifiedPeers` equal to its connected set by construction
 * (see `FabricNodeOptions.trustedIssuers`), so neither thunk is right for both
 * configurations and only the caller knows which it is in.
 *
 * **Recommended: `verifiedPeers`.** A provider list is an input to placement, so a
 * peer that can put entries into it can steer where work goes; requiring it to have
 * cleared verification first costs nothing when nothing was pinned, and is the safer
 * default when something was.
 *
 * ## The reach is directly-connected peers only
 *
 * Inherited from `RpcRecordIndex`: no transitive routing and no DHT. The candidate set
 * covers the peers this endpoint is currently connected to and nothing beyond them.
 * That is the fabric's existing shape rather than a new restriction, and it is the
 * honest limit of what a candidate set covers — stated here because a caller would
 * otherwise assume the answer is global.
 *
 * ## The sovereign seam, named rather than discovered
 *
 * For a sovereign query, `ExecutorQuery.sovereignFor` is a `PublicKeyHex`, and the
 * descriptor this module builds sets `ownerId` to `certificate.userKey` — also a
 * `PublicKeyHex`. So a `PlacementRequest.ownerId` must be that **user key** for
 * `eligibleNodes` to match it. But `OwnerId` is an opaque string
 * (`sovereignty.ts:27`), so an operator label typed into `--owner-id` will not match
 * one and the shard comes back `unplaceable` with nothing obviously wrong.
 *
 * That tension is already recorded in `fabric-node.ts`, and
 * `net/src/sovereign-execution.test.ts` dodges it by making the owner id *be* a hex
 * key. **AUTH-05 / Phase 19 owns unifying the two.** This module does not unify it; it
 * names it, so the next reader does not rediscover it from a silent stall.
 *
 * ## `requiredFeatures` is deliberately left to the caller, and callers pass none
 *
 * `CapabilityRecord.features` is `[]` on every node this repository builds, and no
 * feature-detection dependency exists, so a query naming a feature excludes
 * everybody. Nothing here supplies one.
 *
 * Pure module.
 */

import type { CID } from 'multiformats/cid'
import { discoverExecutors } from '@o2/core'
import type {
  Exclusion,
  ExecutorQuery,
  NodeDescriptor,
  PublicKeyHex,
} from '@o2/core'
import { RpcRecordIndex } from './discovery.ts'
import { RemoteExecutor } from './remote-executor.ts'
import type { CapabilitySupplier } from './remote-executor.ts'
import type { RpcEndpoint } from './rpc.ts'

export interface CandidateOptions {
  readonly rpc: RpcEndpoint
  /**
   * The peers to ask. **A thunk, and which thunk is the caller's decision** — see this
   * module's doc. A thunk rather than an array so the answer is the live peer set
   * rather than a snapshot taken at construction, matching `RpcRecordIndex`'s own
   * signature and `AgentOptions.reservations`.
   */
  readonly peers: () => readonly string[]
  /** Provider keys pinned in advance. Certificates are verified offline against these. */
  readonly trustedIssuers: ReadonlySet<PublicKeyHex>
  /** Read once per lookup, so a long-lived caller does not pin a stale clock. */
  readonly now: () => number
  /**
   * Node key to the id the transport knows, or `null` when it names none.
   *
   * Production passes `peerIdForNodeKey` from `@o2/libp2p`. Taken as a function
   * because this package may not import that one — see the module doc.
   */
  readonly peerIdFor: (nodeKey: PublicKeyHex) => string | null
  /**
   * AUTH-03's chain supplier, or `'dispatches-unauthenticated'`. Handed to every
   * executor built here.
   *
   * A **supplier**, not an array: one `RemoteExecutor` serves every shard of a job and
   * shards may name different owners, so the chain is selected per task. This mirrors
   * `RemoteExecutor`'s third constructor parameter exactly, and it is required for the
   * reason that parameter is required — an optional hook with a silent default would
   * mean a candidate built without one dispatches unauthenticated and nothing fails.
   */
  readonly dispatch: CapabilitySupplier | 'dispatches-unauthenticated'
}

export interface CandidateSet {
  /**
   * One executor per qualified, dialable node, addressed by the **peer id** derived
   * from its node key — never by the node key, which no transport knows.
   */
  readonly executors: readonly RemoteExecutor[]
  /**
   * One descriptor per entry in `executors`, correlated by `nodeId`, so
   * `submitJob`'s `missing-node-descriptor` check can never fire on this output.
   */
  readonly nodes: readonly NodeDescriptor[]
  /** Passed through from `discoverExecutors` unchanged, so an empty list can be read. */
  readonly excluded: readonly Exclusion[]
  /** Providers considered, qualified or not. Passed through unchanged. */
  readonly providers: number
  /**
   * Qualified nodes whose key named no peer id, **by name**.
   *
   * Reported rather than filtered away: "absent" would be indistinguishable from
   * "never qualified", and a node that enrolled correctly but cannot be dialled is a
   * different problem from one that was excluded for cause.
   */
  readonly undialable: readonly PublicKeyHex[]
}

/**
 * Turn a data CID and a peer list into executors and node descriptors.
 *
 * No hardcoded node list, no addresses supplied by the caller: everything below the
 * peer thunk is derived from the answer and from signatures verified against pinned
 * provider keys.
 */
export async function discoverCandidates(
  query: ExecutorQuery,
  options: CandidateOptions,
): Promise<CandidateSet> {
  const index = new RpcRecordIndex(options.rpc, options.peers)
  const found = await discoverExecutors(query, index, {
    trustedIssuers: options.trustedIssuers,
    now: options.now(),
  })

  const executors: RemoteExecutor[] = []
  const nodes: NodeDescriptor[] = []
  const undialable: PublicKeyHex[] = []

  for (const executor of found.executors) {
    const peerId = options.peerIdFor(executor.nodeKey)
    if (peerId === null) {
      undialable.push(executor.nodeKey)
      continue
    }
    executors.push(new RemoteExecutor(peerId, options.rpc, options.dispatch))
    nodes.push({
      // The SAME id on both, and it is the transport's — building the descriptor on
      // the node key while the executor is keyed on the peer id is the exact
      // confusion this module exists to remove, and `submitJob` names it
      // `missing-node-descriptor`.
      nodeId: peerId,
      // The pair `ownRecords` publishes on both tiers. `sovereignFor` is a list of
      // user keys this node is cleared to execute for, so being cleared for *its own*
      // user is what makes it usable for that user's sovereign work.
      ownerId: executor.certificate.userKey,
      canExecuteSovereign: executor.capabilities.sovereignFor.includes(
        executor.certificate.userKey,
      ),
      // Discovery learns nothing about load. Zero is not an estimate and must not be
      // read as one — the offer answer (SCHED-02) is where a real figure comes from,
      // and until one arrives every candidate is equally unranked.
      load: 0,
    })
  }

  return { executors, nodes, excluded: found.excluded, providers: found.providers, undialable }
}
