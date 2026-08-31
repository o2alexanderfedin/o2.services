/**
 * The hosted tier's libp2p assembly — ARCHITECTURE step 6, and one deliverable with step 7.
 *
 * ## The shape: an init you can assert on, and one call you cannot
 *
 * `kadDHT({…})` answers an opaque factory. A config object holding constructed services is
 * therefore **not** locally assertable — a spec could read that `dht` is a function and
 * nothing else, so the four settings that decide whether the keyspace works at all would be
 * sealed inside a closure. So the settings are exported as **data** ({@link hostedDhtInit}),
 * asserted as data, and fed to `kadDHT()` by {@link hostedLibp2pConfig}. The same split
 * `hosted-object.ts` draws between `HostedNode` and the platform's base class: put every
 * claim on the side a test can reach.
 *
 * ## Why all four DHT settings are stated here rather than defaulted
 *
 * `CLAUDE.md` records the measurement in full and it cost two days: **a private DHT needs
 * four settings, not two.** `protocol` and `clientMode` alone produced a keyspace that was
 * inert in both directions —
 *
 * - `peerInfoMapper` defaults to `removePrivateAddressesMapper`, and `onPeerConnect` drops a
 *   peer left with no addresses, so behind a relay **no peer was ever added to a routing
 *   table**; a `put` yielded no events at all and `getClosestPeers` never returned
 * - `validators` without `selectors` makes a keyspace that accepts every write and throws
 *   `MissingSelectorError` on every read, which `DhtRecordIndex`'s catch presents as *"the
 *   DHT holds nothing"*
 *
 * Both are settings whose absence is silent, which is why {@link hostedDhtInit} exists as a
 * value with a spec on it rather than as an argument list at a call site.
 *
 * **`clientMode: false`, explicitly.** This node is the always-reachable bootstrap; it is the
 * one peer in the fabric that must serve records. The tree's standing rule is never to rely
 * on kad-dht's auto-promotion, which reads the *relay's* address class and so makes a node's
 * DHT role follow network topology with nothing in the code saying so.
 *
 * ## `announce` is required, and that is a measured requirement
 *
 * A Cloudflare object has no address it can discover — there is no interface to enumerate and
 * no port it bound. `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md`
 * §13 measured what happens without one: the relay server *"needs `addresses.announce` — with
 * nothing declared the server has no address to hand a client and every reservation comes
 * back empty."* A reservation that comes back empty is not an error anybody sees. So the
 * field has no default and an empty list is refused by construction.
 *
 * ## What only a deploy can settle, stated rather than implied
 *
 * That this configuration *dials and is dialled* is Group B and an owner act at the
 * Cloudflare boundary — it is reported open, not simulated. `wrangler --dry-run` proves the
 * bundle builds; nothing local proves the fabric joins. The inbound listener is not here
 * either: its four measured requirements belong to Phase 30 by the roadmap's own division,
 * and this file deliberately does not pre-empt them.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT, passthroughMapper } from '@libp2p/kad-dht'
import { keychain } from '@libp2p/keychain'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import {
  O2_KAD_PROTOCOL,
  O2_MAX_RESERVATIONS,
  O2_RECORD_NAMESPACE,
  PROVIDER_RECORD_VALIDITY_MS,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATION_TTL_MS,
  o2RecordSelector,
  o2RecordValidator,
  providerRecordPolicy,
} from '@o2/libp2p'
import { TrafficSplitCounter, trafficSplitMetrics } from '@o2/libp2p'
import type { ProviderRecordPolicy } from '@o2/libp2p'
import type { NodeIdentity } from '@o2/libp2p'
import type { PeerInfoMapper, Selectors, Validators } from '@libp2p/kad-dht'
import type { Libp2p, MultiaddrConnection, Upgrader } from '@libp2p/interface'
import type { Datastore } from 'interface-datastore'
import { DoDatastore } from './do-datastore.ts'
import { armExpirySweep } from './expiry-alarm.ts'
import type { ExpirySweep } from './expiry-alarm.ts'
import { hostedIdentity } from './hosted-identity.ts'
import type { DurableObjectAlarms, DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * The one component this tier needs a handle on that `Libp2p` does not expose.
 *
 * An inbound WebSocket has to be handed to `upgrader.upgradeInbound`, and `components` is not
 * on the public `Libp2p` surface — the ordinary route to it is to BE a transport, whose
 * listener has components injected. Writing a Cloudflare transport to reach one method would
 * be a large object for a small need, and libp2p already offers the smaller one: every service
 * factory is called with `components`. So this registers a service whose entire content is the
 * upgrader it was handed.
 *
 * It is a named export with a docblock rather than an inline lambda because it is the seam
 * between a public API and an internal one, and a seam nobody can find is a seam nobody
 * maintains.
 */
export interface InboundUpgradeService {
  upgradeInbound: (connection: MultiaddrConnection, signal?: AbortSignal) => Promise<void>
}

/**
 * How long an inbound upgrade may take before it is abandoned.
 *
 * `UpgraderOptions` extends `Required<AbortOptions>`, so a signal is not optional and there is
 * no "no timeout" spelling to fall into by omission. The number is chosen against what this
 * platform charges for: **billing here is the duration a socket is held, not the messages it
 * carries**, so an upgrade that never completes is an object kept resident and paid for by a
 * peer that has gone away. Thirty seconds is far above a Noise handshake measured at 26 ms on
 * this platform (consult §8) and far below anything an operator would call a leak.
 */
export const INBOUND_UPGRADE_TIMEOUT_MS = 30_000

export function inboundUpgradeService(): (components: { upgrader: Upgrader }) => InboundUpgradeService {
  return (components) => ({
    upgradeInbound: async (connection, signal) =>
      components.upgrader.upgradeInbound(connection, {
        signal: signal ?? AbortSignal.timeout(INBOUND_UPGRADE_TIMEOUT_MS),
      }),
  })
}

/** Thrown when the assembly is given no address to announce — see the file header. */
export class NoAnnouncedAddressError extends Error {
  override readonly name: string = 'NoAnnouncedAddressError'

  constructor() {
    super(
      'the hosted assembly needs at least one announced multiaddr — a Durable Object cannot ' +
        'discover its own address, and a circuit relay with nothing announced hands every ' +
        'client an empty reservation (measured, consult §13) without raising anything',
    )
  }
}

/** What {@link hostedLibp2pConfig} needs. */
export interface HostedLibp2pInit {
  /** This object's stable identity, from its own Durable Object storage. */
  readonly identity: NodeIdentity
  /** The store libp2p persists through — an `ExpirySweep`-holding one, so records are admitted. */
  readonly datastore: Datastore
  /**
   * The addresses to announce, e.g. `/dns4/<worker-host>/tcp/443/tls/ws`. Never empty.
   *
   * Not derived here: the hostname a deployment answers on is a property of that deployment,
   * and a default would be a guess that presents as an empty reservation.
   */
  readonly announce: readonly string[]
  /** The clock the record validator reads. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Provider-record lifetime. Defaults to the fabric's own, never the library's 48 h. */
  readonly providerRecordValidityMs?: number
  /** Reservation slots this relay grants. Defaults to {@link O2_MAX_RESERVATIONS}. */
  readonly maxReservations?: number
  /**
   * NET-14's two counters — the peer-to-peer / relayed split.
   *
   * **Required, with no default, and the requirement is an ordering rather than a
   * preference.** The split has to be reporting *before* this relay accepts its first
   * browser reservation, because a hosted tier becoming load-bearing while every document
   * still says peer-to-peer is the median outcome for hosted-relay systems and is invisible
   * from inside. A defaulted counter would let an assembly be written that runs the relay
   * and counts nothing, which is exactly the arrangement the ordering exists to forbid.
   */
  readonly traffic: TrafficSplitCounter
}

/**
 * The four settings a private keyspace needs, as data.
 *
 * Returned rather than held as a `const` because `validators` closes over a clock, and a
 * validator holding a clock captured at module load is a validator that ages with the
 * isolate rather than with the request.
 */
export interface HostedDhtInit {
  readonly protocol: string
  readonly clientMode: boolean
  readonly peerInfoMapper: PeerInfoMapper
  readonly reprovide: ProviderRecordPolicy
  readonly validators: Validators
  readonly selectors: Selectors
}

export function hostedDhtInit(
  now: () => number = Date.now,
  providerRecordValidityMs?: number,
): HostedDhtInit {
  return {
    protocol: O2_KAD_PROTOCOL,
    // The hosted node serves records. Never left unset — see the file header.
    clientMode: false,
    // Membership of this keyspace is decided by a certificate, not by address class.
    peerInfoMapper: passthroughMapper,
    reprovide: providerRecordPolicy(providerRecordValidityMs ?? PROVIDER_RECORD_VALIDITY_MS),
    validators: { [O2_RECORD_NAMESPACE]: o2RecordValidator(now) },
    selectors: { [O2_RECORD_NAMESPACE]: o2RecordSelector },
  }
}

/**
 * The whole `createLibp2p` argument, as a plain object.
 *
 * Separated from the `createLibp2p` call so that a spec can read every decision this tier
 * makes without a network stack existing. The one thing it cannot read is what `kadDHT()`
 * and the other factories did with their arguments, which is why {@link hostedDhtInit} is
 * exported beside it.
 */
export interface HostedRelayInit {
  readonly maxReservations: number
  readonly reservationTtl: number
  readonly defaultDurationLimit: number
  /** `bigint`, following the library's own signature — the relay counts bytes as 64-bit. */
  readonly defaultDataLimit: bigint
}

/**
 * The relay's capacity settings, as data.
 *
 * Separate from the `circuitRelayServer()` call for {@link hostedDhtInit}'s reason: a
 * factory's arguments are unreadable once it has been called, and these four decide how many
 * peers this tier can carry.
 */
export function hostedRelayInit(maxReservations?: number): HostedRelayInit {
  return {
    maxReservations: maxReservations ?? O2_MAX_RESERVATIONS,
    reservationTtl: RELAY_MAX_RESERVATION_TTL_MS,
    defaultDurationLimit: RELAY_DURATION_LIMIT_MS,
    defaultDataLimit: RELAY_DATA_LIMIT_BYTES,
  }
}

/** The addresses this node listens on and announces — see the header on why `listen` is empty. */
export interface HostedAddresses {
  readonly listen: readonly string[]
  readonly announce: readonly string[]
}

/**
 * The addresses, as data, with the empty-`announce` refusal on this side of the platform.
 *
 * The refusal lives here rather than in {@link createHostedLibp2p} so that it is provable
 * without a network stack: the measured failure it prevents — every reservation coming back
 * empty — is silent, so the check that prevents it must be one a spec can watch fail.
 */
export function hostedAddresses(announce: readonly string[]): HostedAddresses {
  if (announce.length === 0) throw new NoAnnouncedAddressError()
  return {
    // Nothing to listen on: workerd binds no socket, and inbound arrives as an upgraded
    // request rather than as an accepted connection. Phase 30 owns that half.
    listen: [],
    announce: [...announce],
  }
}

/**
 * Construct the node.
 *
 * The one function here a spec cannot fully read, and it is deliberately the thinnest:
 * every decision it makes is one of the three `…Init` values above, each of which has a
 * spec of its own. What is left is the wiring, and wiring is what a deploy checks.
 */
/**
 * The inbound limits, and why leaving them at their defaults is a defect on THIS tier.
 *
 * **NET-11, and it was measured rather than reasoned.** libp2p's `inboundConnectionThreshold`
 * defaults to **5 connections per second per remote host**
 * (`libp2p/dist/src/connection-manager/constants.defaults.js`), and the limiter keys on
 * `config.host` derived from the connection's `remoteAddr`
 * (`connection-manager/index.js`, `inboundConnectionRateLimiter.consume(config.host, 1)`).
 *
 * Eight libp2p peers dialling the locally-run object together were admitted **four** and
 * refused four, each with `EncryptionFailedError: The operation was aborted due to timeout`
 * — the shape a rate-limited handshake takes, because the refusal happens before Noise
 * completes and the dialler sees a stall rather than a rejection.
 *
 * On an ordinary node that default is a sensible anti-abuse bound. **On this tier it is a
 * ceiling on the entire fabric**, and the reason is the same one criterion 3 exists for:
 * every connection's `remoteAddr` is derived from `CF-Connecting-IP`, so a *correct*
 * derivation gives distinct hosts and a *broken* one gives every peer the same host — at
 * which point five per second is the global admission rate. The defect is silent in both
 * directions: nothing logs above `log()`, and the dialler's error names encryption.
 *
 * **The numbers are the platform's own, not invented here.** A Durable Object is a single
 * isolate with no per-host abuse surface of its own — requests reach it through Cloudflare's
 * edge, which does the rate limiting this bound duplicates — so the values are set high
 * enough that the per-host bound stops being the fabric's admission rate, and left finite so
 * a genuine flood still meets a wall.
 */
export function hostedConnectionManagerInit(): {
  readonly inboundConnectionThreshold: number
  readonly maxIncomingPendingConnections: number
} {
  return {
    inboundConnectionThreshold: HOSTED_INBOUND_THRESHOLD,
    maxIncomingPendingConnections: HOSTED_MAX_PENDING_INBOUND,
  }
}

/** Per-host inbound connections per second. The library default of 5 is the defect NET-11 names. */
export const HOSTED_INBOUND_THRESHOLD = 256

/** Inbound handshakes in flight at once. The library default is 10. */
export const HOSTED_MAX_PENDING_INBOUND = 128

export async function createHostedLibp2p(init: HostedLibp2pInit): Promise<Libp2p> {
  const now = init.now ?? Date.now
  const addresses = hostedAddresses(init.announce)

  return createLibp2p({
    privateKey: init.identity.privateKey,
    datastore: init.datastore,
    // NET-14. `libp2p/dist/src/upgrader.js:140` calls `trackMultiaddrConnection` on every
    // upgrade in both directions, which is the one seam every transport passes through.
    metrics: () => trafficSplitMetrics(init.traffic),
    addresses: { listen: [...addresses.listen], announce: [...addresses.announce] },
    connectionManager: hostedConnectionManagerInit(),
    transports: [
      // Dial-only here, which is what a browser needs at the other end of it.
      webSockets(),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping(),
      // Required by anything that persists a key, and the reason the hosted PeerId survives
      // an eviction at all — the keychain reads and writes `components.datastore`, which is
      // this object's storage.
      keychain: keychain(),
      dht: kadDHT(hostedDhtInit(now, init.providerRecordValidityMs)),
      // The role this tier exists for: an always-reachable relay for peers that cannot be
      // dialled. Measured running on a Durable Object — neither a browser nor Node — in
      // consult §13, which is what retired the library's "will not work in browsers" note
      // as a statement about hosts rather than about this code.
      relay: circuitRelayServer({ reservations: hostedRelayInit(init.maxReservations) }),
      // The seam to `components.upgrader` — see `inboundUpgradeService`. Phase 30's listener
      // is the only caller and it cannot reach the upgrader any other way without this tier
      // becoming a libp2p transport.
      inbound: inboundUpgradeService(),
    },
  })
}

/**
 * ## The assembly, and how the 6-and-7 cycle is broken
 *
 * There looks to be a circle here: the admitting store needs an `ExpirySweep`, and the sweep
 * needs the store it sweeps. There is not one, and the reason is a property of `DoDatastore`
 * rather than an arrangement — **only `put` is guarded.** `delete` and the `_all`/`_allKeys`
 * queries the sweep runs on are unguarded, so the sweep works perfectly well through a plain
 * store while the admitting one is what libp2p *writes* through. Two `DoDatastore` instances
 * over one `DurableObjectStorage`, which is safe because the class holds no in-memory state —
 * it has exactly one field, `#storage` — and that was read before this shape was chosen
 * rather than assumed.
 *
 * **The alarm handler therefore does not construct libp2p.** Sweeping needs a datastore, an
 * alarm surface and this node's own peer id, and nothing else; waking a whole network stack
 * to delete expired rows would make the cheapest thing this object does the most expensive.
 */

/** What both {@link hostedExpirySweep} and {@link createHostedFabric} need from the platform. */
export interface HostedFabricInit {
  readonly storage: DurableObjectStorage
  readonly alarms: DurableObjectAlarms
  /** Announced addresses; only {@link createHostedFabric} reads it. */
  readonly announce?: readonly string[]
  readonly now?: () => number
  readonly providerRecordValidityMs?: number
  readonly maxReservations?: number
  /** NET-14's counters. Defaults to a fresh one, because an assembly always has exactly one. */
  readonly traffic?: TrafficSplitCounter
}

/**
 * Arm this object's sweep — the whole of what the alarm handler needs.
 *
 * Deliberately callable on a **fresh** instance with nothing else set up, because that is the
 * only kind of instance an alarm ever fires on: Cloudflare evicts the object that armed it
 * and constructs a new one to handle it. Every call re-arms if the alarm is missing, so the
 * schedule repairs itself on any path that reaches this function.
 */
export async function hostedExpirySweep(init: HostedFabricInit): Promise<ExpirySweep> {
  const sweptStore = new DoDatastore(init.storage)
  const identity = await hostedIdentity(sweptStore)
  return armExpirySweep({
    datastore: sweptStore,
    alarms: init.alarms,
    selfPeerId: identity.peerId,
    ...(init.now === undefined ? {} : { now: init.now }),
    ...(init.providerRecordValidityMs === undefined
      ? {}
      : { validityMs: init.providerRecordValidityMs }),
  })
}

/** A running hosted node and the sweep that keeps its store bounded. */
export interface HostedFabric {
  readonly libp2p: Libp2p
  readonly sweep: ExpirySweep
  readonly identity: NodeIdentity
  /** NET-14's two counters, reading the connections this node actually holds. */
  readonly traffic: TrafficSplitCounter
  /**
   * **The very store handed to libp2p** — not one equal to it.
   *
   * Exposed because a spec that built its own `new DoDatastore(storage, fabric.sweep)` and
   * asserted that *that* admitted records would prove nothing about this function: it would
   * be asserting the constructor it just called. Measured, not reasoned — the check was
   * written that way first and a plant that handed libp2p an unswept store **stayed green**.
   * Reading the store back off the result is what closes it.
   */
  readonly datastore: DoDatastore
}

/**
 * Steps 6 and 7 together — the only way to get a record-accepting hosted node.
 *
 * There is no argument order here that produces a node whose store admits records without an
 * armed alarm, because the store is constructed *from* the sweep. That is the local proof of
 * ARCHITECTURE's *"no safe intermediate state where 6 exists alone"*: not a rule to remember
 * but a value that cannot be obtained the other way round.
 */
export async function createHostedFabric(init: HostedFabricInit): Promise<HostedFabric> {
  const sweep = await hostedExpirySweep(init)
  const identity = await hostedIdentity(new DoDatastore(init.storage))
  // The admitting store, and it admits because a sweep exists — not because a flag says so.
  // Bound to a name so that the one handed to libp2p and the one reported back are the same
  // object; two constructions would let the report be true of a store nothing writes through.
  const datastore = new DoDatastore(init.storage, sweep)
  const traffic = init.traffic ?? new TrafficSplitCounter()
  const libp2p = await createHostedLibp2p({
    identity,
    datastore,
    traffic,
    announce: init.announce ?? [],
    ...(init.now === undefined ? {} : { now: init.now }),
    ...(init.providerRecordValidityMs === undefined
      ? {}
      : { providerRecordValidityMs: init.providerRecordValidityMs }),
    ...(init.maxReservations === undefined ? {} : { maxReservations: init.maxReservations }),
  })
  return { libp2p, sweep, identity, datastore, traffic }
}

/**
 * The announced addresses, read from deploy configuration.
 *
 * **Never from the request.** A `Host` header is visitor-controlled, and deriving the identity
 * this node publishes from visitor input is the same class of defect Phase 29 criterion 6
 * closed for object names: it would let a caller decide what the fabric is told to dial. The
 * value belongs to the deployment, so it comes from `wrangler.jsonc`'s `vars`.
 *
 * Comma-separated because a `vars` entry is a string and this tier announces one address per
 * transport it can be reached on. Empty entries are dropped rather than passed through — an
 * empty multiaddr is not an address and `hostedAddresses` would refuse the list for the wrong
 * reason, reporting "nothing announced" about a list that had something in it.
 */
export function announcedAddresses(configured: string | undefined): readonly string[] {
  if (configured === undefined) return []
  return configured
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}
