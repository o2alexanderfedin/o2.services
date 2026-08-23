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
 * ## The sovereign seam — closed 2026-08-03, and left described rather than deleted
 *
 * For a sovereign query, `ExecutorQuery.sovereignFor` is a `PublicKeyHex`, and the
 * descriptor this module builds sets `ownerId` to `certificate.userKey` — also a
 * `PublicKeyHex`. So a `PlacementRequest.ownerId` must be that **user key** for
 * `eligibleNodes` to match it. But `OwnerId` is an opaque string
 * (`sovereignty.ts:27`), so an operator label typed into `--owner-id` did not match one
 * and the shard came back `unplaceable` with nothing obviously wrong.
 *
 * **The half that produced that stall is closed.** Plan 19-09 made a serving node's own
 * clearance the public half of the user key it enrols under: `bin/agent.ts` derives
 * `FabricNodeOptions.sovereignty.ownerId` from `--user-key` and refuses, exit 2 naming
 * both values, if a passed `--owner-id` disagrees with it. So a node can no longer be
 * cleared for an identity its own certificate does not name, and
 * `packages/node/src/owner-domain-agents.node.test.ts` runs a sovereign shard across two
 * such processes from a descriptor this function built.
 *
 * **What is deliberately NOT closed, and it is the seam's honest remainder.** A
 * *requestor* choosing which owner to pin a shard to still passes whatever string it
 * holds; if that string is not a user key, `eligibleNodes` matches nothing and the shard
 * is `unplaceable` — correctly, and the same way it would be for any owner with no live
 * node. `OwnerId` stays opaque because it must: a requestor may pin work to an owner it
 * knows by some other name entirely.
 *
 * The naming half was discharged one wave earlier, by the descriptor now carrying the
 * certificate the user key was read off, so a reader sees both spellings of the same node
 * side by side instead of inferring one from the other.
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
import { discoverExecutors, resolveReplicaSets } from '@o2/core'
import type {
  Exclusion,
  ExecutorQuery,
  NodeDescriptor,
  PublicKeyHex,
  RecordIndex,
  ReplicaSet,
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
  /**
   * The index this lookup asks, or the stated decision to ask only connected peers.
   *
   * **This field exists because its absence was the seam NET-06 spent thirteen days
   * naming.** Both node tiers compose a `DhtRecordIndex` over an `RpcRecordIndex` and
   * expose it as `.recordIndex`; until this option existed, `.recordIndex` occurred
   * exactly twice in the whole repository and both were assignments, because this
   * function built its own bare `RpcRecordIndex` internally and had no field to hand it
   * one. A port neither tier consumes is not a port.
   *
   * The sentinel is spelled out rather than defaulted, following
   * `DhtRecordIndexOptions.recordsFallback`: it builds exactly the
   * `RpcRecordIndex(rpc, peers)` this function always built, so asking connected peers
   * only is a decision a caller made rather than a field a caller omitted — and no
   * existing behaviour changes by being left alone.
   */
  readonly index: RecordIndex | 'asks-connected-peers-only'
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
   * AUTH-03's chain supplier, **selected per candidate**, or
   * `'dispatches-unauthenticated'`.
   *
   * A **supplier**, not an array: one `RemoteExecutor` serves every shard of a job and
   * shards may name different owners, so the chain is selected per task. This mirrors
   * `RemoteExecutor`'s third constructor parameter exactly, and it is required for the
   * reason that parameter is required — an optional hook with a silent default would
   * mean a candidate built without one dispatches unauthenticated and nothing fails.
   *
   * **A function OF THE NODE ID that returns that supplier, and until 2026-08-03 it was
   * the bare supplier — which made every sovereign candidate this helper built
   * undispatchable.** The reason is `RemoteExecutor`'s own: *"the audience a chain must
   * end at is `this` remote node's key: a chain minted for node A is refused at node B
   * with `wrong-audience`"*. One supplier shared across a whole candidate set can name at
   * most one audience, so every other candidate it built was refused — and because a
   * public task returns `[]` and every caller in the repository passed the sentinel, a
   * `tsc`-clean, test-green fabric had **no path at all** by which discovery could place
   * an authenticated sovereign shard. Found while closing AUTH-05, whose whole claim is
   * that the scheduler can target an owner's replica set.
   *
   * A caller with one chain for everybody writes `() => supplier` and loses nothing; a
   * caller minting per-node chains — which is every sovereign caller, by construction —
   * can now express one. The sentinel arm is unchanged, so no existing call site moved.
   */
  readonly dispatch: ((nodeId: string) => CapabilitySupplier) | 'dispatches-unauthenticated'
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
  /**
   * The qualified nodes grouped by the user key their certificates name — AUTH-05.
   *
   * Computed here rather than left to a call site because the certificates were
   * verified exactly once, at the moment they qualified, against the clock this lookup
   * read. Regrouping later means re-verifying against a clock that has moved, and a
   * certificate that expired in between would silently drop an owner's second replica —
   * turning a verified result into an owner-attested one with nothing to show for it.
   *
   * Taken over the **qualified** set rather than over every provider answered, so a
   * replica set never contains a node the lookup's own intersection excluded.
   */
  readonly replicaSets: readonly ReplicaSet[]
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
  const index =
    options.index === 'asks-connected-peers-only'
      ? new RpcRecordIndex(options.rpc, options.peers)
      : options.index
  // Read once and reused below, so the replica sets are grouped against the same
  // instant the certificates were qualified at rather than a slightly later one.
  const now = options.now()
  const found = await discoverExecutors(query, index, {
    trustedIssuers: options.trustedIssuers,
    now,
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
    // The chain is minted for **this** peer id, which is the same id the executor
    // dispatches to and the same id the descriptor below is keyed on — so a chain can
    // never end at an audience other than the node it is sent to. See
    // `CandidateOptions.dispatch` for why the per-node indirection exists at all.
    executors.push(
      new RemoteExecutor(
        peerId,
        options.rpc,
        options.dispatch === 'dispatches-unauthenticated' ? options.dispatch : options.dispatch(peerId),
      ),
    )
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
      // The whole certificate rides along now, so the two fields summarised above are
      // readable directly rather than through this comment — and so are `operatorId`
      // and `discoverability`, which the quorum step needs and which nothing on the
      // dispatch path could reach while this loop kept the user key alone. It is the
      // object the provider signed, passed on unaltered: rebuilding it from parts here
      // would drop `issuer` and `signature`, which are the whole of what makes it
      // checkable by somebody who was not present.
      certificate: executor.certificate,
    })
  }

  return {
    executors,
    nodes,
    excluded: found.excluded,
    providers: found.providers,
    undialable,
    // The same pinned issuers and the same instant the lookup qualified them against.
    // `resolveReplicaSets` re-verifies each certificate itself and drops any that does
    // not verify, so an unverifiable one cannot inflate an owner's replica count — at
    // this call site that is a second refusal behind `discoverExecutors`'s first, and
    // it is kept rather than skipped because the function's guarantee is its own.
    replicaSets: resolveReplicaSets(
      found.executors.map((executor) => executor.certificate),
      options.trustedIssuers,
      now,
    ),
  }
}
