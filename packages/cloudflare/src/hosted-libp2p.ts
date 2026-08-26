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
import type { ProviderRecordPolicy } from '@o2/libp2p'
import type { NodeIdentity } from '@o2/libp2p'
import type { PeerInfoMapper, Selectors, Validators } from '@libp2p/kad-dht'
import type { Libp2p } from '@libp2p/interface'
import type { Datastore } from 'interface-datastore'
import { DoDatastore } from './do-datastore.ts'
import { armExpirySweep } from './expiry-alarm.ts'
import type { ExpirySweep } from './expiry-alarm.ts'
import { hostedIdentity } from './hosted-identity.ts'
import type { DurableObjectAlarms, DurableObjectStorage } from './durable-object-storage.d.ts'

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
export async function createHostedLibp2p(init: HostedLibp2pInit): Promise<Libp2p> {
  const now = init.now ?? Date.now
  const addresses = hostedAddresses(init.announce)

  return createLibp2p({
    privateKey: init.identity.privateKey,
    datastore: init.datastore,
    addresses: { listen: [...addresses.listen], announce: [...addresses.announce] },
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
  const libp2p = await createHostedLibp2p({
    identity,
    datastore,
    announce: init.announce ?? [],
    ...(init.now === undefined ? {} : { now: init.now }),
    ...(init.providerRecordValidityMs === undefined
      ? {}
      : { providerRecordValidityMs: init.providerRecordValidityMs }),
    ...(init.maxReservations === undefined ? {} : { maxReservations: init.maxReservations }),
  })
  return { libp2p, sweep, identity, datastore }
}
