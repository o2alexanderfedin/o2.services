/**
 * The fabric's index, answered by a Kademlia DHT — SCHED-01 and NET-06.
 *
 * ## What this is, and what it deliberately is not
 *
 * `RecordIndex` is a two-method port whose own docblock names this as its purpose: *"what
 * lets a single implementation be swapped for a DHT, a delegated HTTP router, or an
 * in-memory fixture without the discovery logic noticing."* This is that swap. Nothing in
 * `discoverExecutors` changes, and nothing here knows what a job is.
 *
 * It is **not** a second discovery mechanism running beside the first. Both halves compose
 * with an existing index, and both composition arguments are **required**, so an instance
 * that answers *less* than today's fabric cannot be constructed — it is a compile error
 * rather than a review comment.
 *
 * ## The two-spellings hazard, and why it cannot bite the record half
 *
 * A DHT is keyed by libp2p `PeerId`. `RecordIndex` is keyed by `PublicKeyHex`. These are
 * two spellings of one node and they never compare equal — a defect of exactly this shape
 * shipped here once, where a quorum rule compared relay peer ids against member node keys
 * and silently never matched.
 *
 * So the record half performs **no conversion at all**: the DHT key is derived from the
 * node key itself ({@link dhtKeyForNodeKey}), routing is kad-internal XOR distance, and no
 * `PeerId` is produced or consumed. There is no comparison across namespaces to get wrong,
 * because there is no comparison.
 *
 * The provider half **must** convert — `findProviders` answers in `PeerId`s and the port
 * returns node keys — so it converts in exactly one direction, in exactly one place, and a
 * peer whose id does not name an Ed25519 key is **dropped and counted** rather than
 * guessed at. {@link DhtRecordIndex.unnamedProviders} is that count, because the port's
 * `readonly PublicKeyHex[]` return type has nowhere to put a refusal.
 *
 * ## Verification is the caller's, and it is not skipped
 *
 * A DHT is untrusted transport. Records are self-authenticating, so a stored value proves
 * nothing by being stored — it proves something by verifying. `verify` is a **required**
 * constructor argument for that reason: there is no default that quietly accepts.
 *
 * ## Every query is bounded
 *
 * A kad query against an empty routing table does not answer `[]` — it waits. That is the
 * right behaviour for the library (an empty answer would read as *"nobody holds this"*
 * rather than *"ask me once I know somebody"*), and the wrong behaviour for a caller
 * holding a job. So `timeoutMs` is required and every call carries an `AbortSignal`.
 * A timeout is not an error here: it degrades to the composed index, which is what the
 * fabric answered before this class existed.
 */

import type { PeerInfo } from '@libp2p/interface'
import type { KadDHT, QueryEvent } from '@libp2p/kad-dht'
import type { NodeRecords, PublicKeyHex, RecordIndex } from '@o2/core'
import { decodeNodeRecords } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { nodeKeyForPeerId } from './identity.ts'

/**
 * The fabric's own keyspace prefix.
 *
 * A distinct namespace so these records neither pollute nor are polluted by any other DHT
 * sharing the process. It pairs with a distinct `protocol` on the `kadDHT` service itself;
 * the two are separate settings and both are needed — the protocol keeps the *wire* apart,
 * this keeps the *keys* apart.
 */
export const O2_KEY_PREFIX = '/o2/'

/**
 * The fabric's own DHT wire protocol.
 *
 * Distinct from Amino's `/ipfs/kad/1.0.0` so this keyspace neither pollutes nor is
 * polluted by the public network — and, more practically, so an Amino peer never appears
 * in a routing table here. Amino peers advertise TCP/QUIC, which a browser cannot dial, so
 * one in the table is a slot spent on a peer half this fabric can never reach.
 *
 * It pairs with {@link O2_KEY_PREFIX}: this keeps the **wire** apart, the prefix keeps the
 * **keys** apart, and both are needed.
 */
export const O2_KAD_PROTOCOL = '/o2/kad/1.0.0'

/**
 * How long a DHT query may run before the composed index answers instead.
 *
 * A bound is mandatory rather than prudent: with an empty routing table a kad query does
 * not answer `[]`, it waits — correctly, because `[]` would read as *"nobody holds this"*
 * instead of *"ask again once I know somebody"*. A requestor holding a job cannot wait on
 * that distinction.
 *
 * Five seconds is a stated judgement, not a discovered boundary, and it is sited against
 * the one figure this repository has measured nearby: a cold WebRTC handshake floors at
 * ~1.04 s, so an O(log N) walk over cold browser peers is seconds. A bound below that
 * would time out on a working fabric; far above it would stall a job on a dead one.
 */
export const DHT_QUERY_TIMEOUT_MS = 5_000

/**
 * Where one node's records live in the keyspace.
 *
 * Derived from the node key rather than from a peer id, which is what removes the
 * conversion — see this module's header. The node key is already lowercase hex by
 * `identity.ts`'s own rule, so one node has exactly one key here and no second spelling
 * exists to disagree with it.
 */
export function dhtKeyForNodeKey(nodeKey: PublicKeyHex): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${O2_KEY_PREFIX}${nodeKey}`) as Uint8Array<ArrayBuffer>
}

/**
 * Somewhere to put the addresses a provider lookup returned.
 *
 * **This is not decoration.** `findProviders` answers with `PeerInfo` — an id *and* its
 * multiaddrs — and the port returns node keys alone. Without somewhere for the addresses
 * to go, a requestor ends up holding the key of a peer libp2p has no address for and
 * cannot dial, so a successful lookup produces an undialable candidate. The sink is how
 * the addresses reach the peer store.
 */
export interface ProviderAddressSink {
  (info: PeerInfo): void
}

/** Checks a record actually came from the node it names. Both signatures, not one. */
export interface RecordVerifier {
  (nodeKey: PublicKeyHex, records: NodeRecords): boolean | Promise<boolean>
}

export interface DhtRecordIndexOptions {
  readonly dht: KadDHT
  /**
   * Asked alongside the DHT for providers, and its answers are **unioned** with the DHT's.
   *
   * Required, and a union rather than a fallback: a provider answer is a set, and
   * first-wins under-reports it — which is the defect `RpcRecordIndex.providers` was
   * changed to fix. Requiring it is what makes this class strictly additive: every
   * provider the fabric names today, it still names.
   */
  readonly providersFrom: RecordIndex
  /**
   * Asked for records when the DHT holds none, or the stated decision not to ask anyone.
   *
   * The sentinel is spelled out rather than defaulted so that answering from the DHT alone
   * is a decision somebody made, not a field somebody omitted.
   */
  readonly recordsFallback: RecordIndex | 'answers-from-the-dht-alone'
  /** Checks both signatures on a record read off the DHT. No default — see the header. */
  readonly verify: RecordVerifier
  /** Bound on every query. See the header: an empty routing table waits rather than answers. */
  readonly timeoutMs: number
  /** Where a discovered provider's multiaddrs go, or the stated decision to drop them. */
  readonly addresses: ProviderAddressSink | 'discards-provider-addresses'
  /**
   * This node's own key, which a provider answer must not contain — or the stated
   * decision that it may.
   *
   * **Required, because the alternative was measured and it is not a cosmetic
   * duplicate.** Once a node announces the blocks it holds, `findProviders` truthfully
   * answers *itself* for anything it stored — and a requestor's own key arriving in its
   * own candidate list is wrong twice over. It double-counts for redundancy, and
   * redundancy in this fabric is N-version execution whose entire claim is that the
   * executors are **independent**: a shard run twice on one node agrees with itself and
   * demonstrates nothing.
   *
   * It is also the property `attestation-ui.e2e.test.ts`'s SCHED-01 case calls its
   * anti-vacuity check — *"a page that had quietly answered from its own record index
   * would list itself here"* — and that case went red the first time provider
   * announcement shipped, with the tab appearing in its own `providers` answer.
   *
   * The RPC half never needed this: a node asks its **peers**, and `SelfRecordIndex`
   * answers only about the node it belongs to, so a requestor was never in a position to
   * hear about itself. A DHT has no such shape, which is why the filter lives here rather
   * than being inherited.
   *
   * The sentinel exists for a caller that genuinely wants every provider — an audit, or a
   * fixture measuring what the keyspace holds — and it has to be written down so that
   * including yourself is a decision rather than an omission.
   */
  readonly self: PublicKeyHex | 'answers-about-itself-too'
}

export class DhtRecordIndex implements RecordIndex {
  readonly #dht: KadDHT
  readonly #providersFrom: RecordIndex
  readonly #recordsFallback: RecordIndex | 'answers-from-the-dht-alone'
  readonly #verify: RecordVerifier
  readonly #timeoutMs: number
  readonly #addresses: ProviderAddressSink | 'discards-provider-addresses'
  readonly #self: PublicKeyHex | 'answers-about-itself-too'

  /**
   * Providers the DHT named that this class could not name back.
   *
   * A peer id that does not decode to an Ed25519 public key has no `PublicKeyHex` spelling,
   * so it cannot appear in the return value and it is not guessed at. The count is here
   * because a silently shortened list is the failure this repository keeps finding, and a
   * number a test can read is the cheapest defence against it.
   */
  unnamedProviders = 0

  /** Records read off the DHT whose signatures did not check, and were therefore not used. */
  unverifiedRecords = 0

  constructor(options: DhtRecordIndexOptions) {
    this.#dht = options.dht
    this.#providersFrom = options.providersFrom
    this.#recordsFallback = options.recordsFallback
    this.#verify = options.verify
    this.#timeoutMs = options.timeoutMs
    this.#addresses = options.addresses
    this.#self = options.self
  }

  /**
   * The union of what the DHT knows and what the composed index knows.
   *
   * Both are asked concurrently. Asking in sequence would pay the sum of two slow answers
   * to produce a set that needs both of them anyway.
   *
   * A DHT failure contributes nothing and fails nothing — the composed index's answer
   * still stands, which is the degradation this class is built to make invisible.
   */
  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    const [fromDht, fromPeers] = await Promise.all([
      this.#dhtProviders(cid),
      this.#providersFrom.providers(cid).catch((): readonly PublicKeyHex[] => []),
    ])
    // Sorted, so the answer does not depend on which source replied first. The kernel
    // sorts again on what it is handed; this class is honest on its own rather than
    // relying on that.
    return [...new Set([...fromDht, ...fromPeers])].sort()
  }

  async #dhtProviders(cid: CID): Promise<readonly PublicKeyHex[]> {
    const found: PublicKeyHex[] = []
    try {
      for await (const event of this.#query(this.#dht.findProviders(cid, this.#routing()))) {
        if (event.name !== 'PROVIDER') continue
        for (const info of event.providers) {
          const nodeKey = nodeKeyForPeerId(info.id.toString())
          if (nodeKey === null) {
            // No `PublicKeyHex` spelling exists for this peer, so there is nothing
            // truthful to return for it. Counted rather than dropped in silence.
            this.unnamedProviders += 1
            continue
          }
          // Not itself. See `DhtRecordIndexOptions.self` — a requestor in its own candidate
          // list double-counts for a redundancy whose whole claim is independence.
          if (nodeKey === this.#self) continue
          // Before the key is returned, so a caller that dials what it is handed has an
          // address for it. See `ProviderAddressSink`.
          if (this.#addresses !== 'discards-provider-addresses') this.#addresses(info)
          found.push(nodeKey)
        }
      }
    } catch {
      return [] // timeout, or no routing table yet — the composed index still answers
    }
    return found
  }

  /**
   * The DHT's record for a node, if it holds one that verifies, else the composed index's.
   *
   * **A record that does not verify is not used and does not end the search.** Treating a
   * forged value as "the answer, and it was bad" would let anyone who can write to the
   * keyspace suppress a node by publishing garbage under its key. So it is counted and the
   * next value — and finally the fallback — still gets its turn.
   */
  async recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    const fromDht = await this.#dhtRecords(nodeKey)
    if (fromDht !== undefined) return fromDht
    if (this.#recordsFallback === 'answers-from-the-dht-alone') return undefined
    return this.#recordsFallback.recordsFor(nodeKey)
  }

  async #dhtRecords(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    try {
      const key = dhtKeyForNodeKey(nodeKey)
      for await (const event of this.#query(this.#dht.get(key, this.#routing()))) {
        if (event.name !== 'VALUE') continue
        const records = decodeNodeRecords(event.value as Uint8Array<ArrayBuffer>)
        // Not a record at all, or a record about somebody else. Both are "keep looking".
        if (records === null) continue
        if (!(await this.#verify(nodeKey, records))) {
          this.unverifiedRecords += 1
          continue
        }
        return records
      }
    } catch {
      return undefined // timeout or empty table — the fallback is the answer
    }
    return undefined
  }

  #routing(): { readonly signal: AbortSignal } {
    return { signal: AbortSignal.timeout(this.#timeoutMs) }
  }

  /** Identity today; the seam where a query's events would be traced. */
  #query(events: AsyncIterable<QueryEvent>): AsyncIterable<QueryEvent> {
    return events
  }
}
