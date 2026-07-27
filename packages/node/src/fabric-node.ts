/**
 * A fabric node. There is one node class on this side, and this is it.
 *
 * Every part is behind a port, and this factory is the only place that knows which
 * concrete implementation is in use:
 *
 *   `Transport`  → libp2p over TCP and WebSockets, plus a circuit when it needs one
 *   `Blockstore` → the filesystem when given a directory, memory when not
 *   `Executor`   → the kernel's `WasmExecutor`
 *
 * A node is symmetric. It executes tasks, holds blocks, serves records, and relays
 * for peers that cannot be dialled — all of it, on every node. There is no
 * client/worker distinction in the code and no relay/compute one either, only in
 * what a given process happens to do.
 *
 * ## Why there is no second class
 *
 * There was one, for two phases, and the way it failed is the reason this comment is
 * long. `RelayNode` bound a socket and carried other peers' SDP exchanges. It
 * constructed no blockstore, no executor, no `RpcEndpoint`, and never called
 * `serveAgent` — so it could not run a task, though nothing about relaying prevents
 * it. Running the demo showed "2 compute peers of 3 connections": the third
 * connection was the relay, present, connected, perfectly able to compute, and
 * structurally excluded from doing so. The mechanism had already survived three
 * rounds of renaming — `backbone`/`edge` became other words while the two disjoint
 * capability sets stayed exactly where they were. Deleting the class is what removed
 * it; renaming it never would have.
 *
 * The standing rule this enforces: **all nodes have equal functionality, and the
 * only difference is discovery.** A browser binds no listening socket, so it cannot
 * be a seed a newcomer dials cold and must be found through a peer that can. Once
 * connected, peers are indistinguishable. If a decision keys on what kind of node
 * something is, it is wrong.
 *
 * ## Why relaying is derived and not configured
 *
 * The relay service is enabled from what this node *can do*, never from a flag
 * naming what it *is*. A node that has bound a real listening address can be dialled
 * cold, so it can carry a stranger's handshake. A node reachable only through
 * somebody else's circuit cannot carry anyone's, and advertising the service would
 * offer capacity that does not exist.
 *
 * An option would be a lie waiting to happen: any boolean can be set on a node with
 * no socket, and then "does this node relay?" has two answers that can disagree.
 * Derivation leaves one answer, read off the listen list, and it is the same answer
 * whether the caller thought about it or not. That is the difference between the rule
 * being true and the rule being asserted.
 *
 * ## What the relay tuning is for
 *
 * A browser peer is not dialable by anything. The only way two tabs reach each other
 * is for both to hold a reservation on a publicly reachable Circuit Relay v2 peer,
 * which then carries the WebRTC SDP exchange; once ICE completes the relay drops out
 * of the data path entirely.
 *
 * That last point is what the tuning below is *for*. libp2p's defaults exist to stop
 * a relay being abused as a free proxy: 2 minutes and 128 KiB per relayed
 * connection. Those are correct for signalling and fatal for anything else — which
 * is why the architecture treats a circuit as a signalling channel and fetches
 * artifacts by another route. Raising them here is about accommodating slow ICE on
 * bad networks, not about moving bulk data.
 *
 * Module set assembled from libp2p's own `packages/integration-tests`: TCP + noise +
 * yamux is the most-exercised path in the ecosystem. `identify` is not optional in
 * practice — relay discovery, AutoNAT, and DCUtR all depend on it. WebSockets is
 * present unconditionally because a browser cannot dial plain TCP, and a node
 * without that transport is unreachable from the tier this project exists for,
 * however good its address looks in a log.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { MemoryBlockstore, WasmExecutor, guardSovereignty } from '@o2/core'
import type { Blockstore, Executor, NodeSovereignty } from '@o2/core'
import { FetchingBlockstore, RpcBlockSource, RpcEndpoint, serveAgent } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { FsBlockstore } from './fs-blockstore.ts'
import {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  Libp2pTransport,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
} from '@o2/libp2p'
import type { ReservationWatcher } from './reservation-watch.ts'

export interface FabricNodeOptions {
  /**
   * Directory backing the persistent blockstore.
   *
   * Optional, and the fallback is `MemoryBlockstore`. Persistence is a deployment
   * choice — whether this process should survive its own restart — and not a kind of
   * node: a node with a memory store holds blocks, serves them to peers, and runs
   * tasks against them exactly as one with a directory does. Making it required was
   * the last thing forcing a caller who only wanted to relay to reach for a
   * different class.
   */
  readonly blockstoreDir?: string
  /**
   * This node's clearance to execute sovereign data — DATA-09's serving-side
   * gate (`guardSovereignty`, `@o2/core`), applied unconditionally to the
   * `Executor` this factory hands to `serveAgent` below.
   *
   * Optional, and the default is the safe one: cleared for nobody
   * (`canExecuteSovereign: false`). A node started with no `sovereignty` option
   * therefore refuses every sovereign-labelled task regardless of whose owner
   * id it names — `ownerId` only matters once `canExecuteSovereign` is `true`,
   * so the default's placeholder value is never consulted. This is a per-node
   * clearance, not a node class: every `FabricNode` has the identical executor,
   * transport, and relay capability regardless of this setting — see the
   * module comment's "why there is no second class".
   */
  readonly sovereignty?: NodeSovereignty
  /**
   * Multiaddrs to listen on. Port 0 asks the OS for a free port.
   *
   * Binding at least one non-`/p2p-circuit` address here is what makes this node
   * able to relay for others — see the module comment. Include a browser-dialable
   * one (`/ws` or `/wss`) if browsers are meant to reach it; nothing else in this
   * list is dialable from a tab.
   */
  readonly listen?: readonly string[]
  /** Overrides the RPC request timeout; mainly useful to keep tests quick. */
  readonly rpcTimeoutMs?: number
  /**
   * Relays to reserve a `/p2p-circuit` address on.
   *
   * Supplying any switches the node into the topology a browser peer is forced
   * into: reachable only through someone else. Adds the circuit-relay transport and
   * listens on `/p2p-circuit`.
   */
  readonly relayAddrs?: readonly string[]
  /** Observes relay reservation outcomes — see NET-05. */
  readonly reservationWatcher?: ReservationWatcher
  /** Concurrent reservations to accept from others. Defaults to libp2p's 15. */
  readonly maxReservations?: number
  readonly reservationTtlMs?: number
  readonly durationLimitMs?: number
  readonly dataLimitBytes?: bigint
  /**
   * Simultaneous inbound handshakes to permit.
   *
   * Defaults to `max(libp2p's 10, maxReservations)`. This is not a knob to leave
   * alone: a burst of browser tabs all joining at once is the normal case, and the
   * default of ten silently drops the excess *during* the noise handshake. Raising
   * `maxReservations` without raising this makes the extra capacity unreachable.
   */
  readonly maxIncomingPendingConnections?: number
  /**
   * Inbound connections per second to accept from one host.
   *
   * Defaults to `max(libp2p's 5, maxReservations)` because libp2p's default of five
   * is far too low for this fabric: it is a *per-host* rate limit, so every peer
   * behind one NAT — or every tab in a local test — shares the budget. See
   * `LIBP2P_INBOUND_CONNECTION_THRESHOLD`.
   */
  readonly inboundConnectionThreshold?: number
}

/**
 * What a node knows about the reservations it is holding for others, by name rather
 * than by symptom.
 *
 * Every field is read from the live reservation store. There is deliberately no
 * lifetime "granted total": `@libp2p/circuit-relay-v2@4.2.9` declares a
 * `relay:reservation` event in its type definitions but **never dispatches it** —
 * the name appears only in `.d.ts` files, and `CircuitRelayServer` emits nothing at
 * all. A counter built on it would silently read zero forever, which is the exact
 * failure mode NET-05 exists to eliminate. `relaying.node.test.ts` pins that
 * finding, so if a later release starts emitting, the test tells us.
 *
 * A node that bound no listening address relays for nobody: its limit is zero and
 * `atCapacity` is trivially true, because there is no capacity for it to be under.
 * That is the right answer to "should I try to reserve here?" and it needs no
 * separate flag to read.
 */
export interface RelayCapacity {
  readonly granted: number
  readonly limit: number
  readonly remaining: number
  readonly atCapacity: boolean
}

interface RelayService {
  readonly reservations: {
    readonly size: number
    keys(): IterableIterator<{ toString(): string }>
  }
}

function hasReservations(value: unknown): value is RelayService {
  if (value === null || typeof value !== 'object') return false
  const candidate = (value as { reservations?: unknown }).reservations
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { size?: unknown }).size === 'number' &&
    typeof (candidate as { keys?: unknown }).keys === 'function'
  )
}

export class FabricNode {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  readonly rpc: RpcEndpoint
  /** Local blocks plus network fallback. This is what the executor reads from. */
  readonly blockstore: FetchingBlockstore
  /**
   * The local tier, without network fallback.
   *
   * Typed as the port, not as the adapter: nothing outside this file needs to know
   * whether the blocks are on disk or in a heap, and a caller that could ask would
   * be one kind-check away from behaving differently on the answer.
   */
  readonly store: Blockstore
  readonly executor: Executor
  readonly #limit: number
  readonly #pending: number
  readonly #inboundPerSecond: number

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    blockstore: FetchingBlockstore
    store: Blockstore
    executor: Executor
    limit: number
    pending: number
    inboundPerSecond: number
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.executor = parts.executor
    this.#limit = parts.limit
    this.#pending = parts.pending
    this.#inboundPerSecond = parts.inboundPerSecond
  }

  static async start(options: FabricNodeOptions = {}): Promise<FabricNode> {
    const store: Blockstore =
      options.blockstoreDir === undefined
        ? new MemoryBlockstore()
        : await FsBlockstore.open(options.blockstoreDir)
    const relayAddrs = options.relayAddrs ?? []
    const viaRelay = relayAddrs.length > 0

    const listen = [
      ...(options.listen ?? (viaRelay ? [] : ['/ip4/127.0.0.1/tcp/0'])),
      // Asks libp2p to reserve on any relay it connects to.
      ...(viaRelay ? ['/p2p-circuit'] : []),
    ]

    // The whole of the relay/compute distinction, reduced to one predicate over the
    // addresses this node actually asked to bind. `/p2p-circuit` does not count: it
    // is not an address, it is a request for one, granted by somebody else and
    // revocable by them. A node holding only that cannot carry a stranger's
    // handshake and must not claim it can.
    const canRelay = listen.some((address) => !address.includes('/p2p-circuit'))

    // Zero when this node cannot relay, so every number downstream — the inbound
    // limits, `capacity` — falls out of the same fact rather than being decided
    // twice.
    const limit = canRelay ? (options.maxReservations ?? RELAY_MAX_RESERVATIONS) : 0
    // Coupled deliberately — see the options' documentation.
    const pending =
      options.maxIncomingPendingConnections ??
      Math.max(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS, limit)
    const inboundPerSecond =
      options.inboundConnectionThreshold ??
      Math.max(LIBP2P_INBOUND_CONNECTION_THRESHOLD, limit)

    const libp2p = await createLibp2p({
      addresses: { listen },
      transports: viaRelay
        ? [tcp(), webSockets(), circuitRelayTransport()]
        : [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionManager: {
        maxIncomingPendingConnections: pending,
        // Per *host*, so a burst of tabs from one machine — or of volunteers behind
        // one NAT — would otherwise be rejected mid-handshake.
        inboundConnectionThreshold: inboundPerSecond,
      },
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        ...(canRelay
          ? {
              relay: circuitRelayServer({
                reservations: {
                  maxReservations: limit,
                  reservationTtl: options.reservationTtlMs ?? RELAY_MAX_RESERVATION_TTL_MS,
                  defaultDurationLimit: options.durationLimitMs ?? RELAY_DURATION_LIMIT_MS,
                  defaultDataLimit: options.dataLimitBytes ?? RELAY_DATA_LIMIT_BYTES,
                },
              }),
            }
          : {}),
      },
      ...(options.reservationWatcher === undefined
        ? {}
        : { logger: options.reservationWatcher.logger }),
    })

    // Connecting is what triggers the reservation; the `/p2p-circuit` listen entry
    // above is what makes libp2p ask for one.
    for (const address of relayAddrs) {
      await libp2p.dial(multiaddr(address))
    }

    const transport = await Libp2pTransport.start(libp2p)
    const rpc = new RpcEndpoint(
      transport,
      options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs },
    )

    // Blocks this node lacks are pulled from whichever peers are connected. The
    // peer list is a thunk, so a peer that connects later is usable immediately.
    const blockstore = new FetchingBlockstore(store, new RpcBlockSource(rpc, () => transport.peers))

    // The node's own peer id is its executor id, so a disagreement names the
    // machine that produced the dissenting result.
    //
    // DATA-09: guarded unconditionally, with no opt-in required to get the
    // refusal — `options.sovereignty` defaults to cleared-for-nobody (see
    // `FabricNodeOptions.sovereignty`'s doc). Wrapped once, here, rather than
    // only at the `serveAgent` call below, so a caller that dispatches through
    // `node.executor` directly — bypassing RPC entirely — gets the identical
    // refusal a remote dispatch would.
    const executor = guardSovereignty(
      new WasmExecutor({ nodeId: libp2p.peerId.toString(), blockstore }),
      options.sovereignty ?? { ownerId: '', canExecuteSovereign: false },
    )

    const node = new FabricNode({
      libp2p,
      transport,
      rpc,
      blockstore,
      store,
      executor,
      limit,
      pending,
      inboundPerSecond,
    })

    // Unconditional, and that is the point: there is no construction path through
    // this factory that yields a node which will not compute. A node that relays
    // reaches this line by the same route as one that does not.
    //
    // `reservations` is a thunk over the node, which is why the node is constructed
    // first — the same ordering `BrowserNode.start` uses for `onDispatch`, and for
    // the same reason: the handler has to close over an object that does not exist
    // until the constructor returns.
    //
    // Without it this answered `[]` forever. `reservedPeerIds` held exactly the
    // right data and nothing asked it, so `findReservedPeers` — documented in the
    // demo as *the only route on a static host* — got a real answer containing
    // nobody. That produces `{asked: true, dialed: [], failed: []}`: nothing
    // attempted, nothing failed, no error to notice. The same signature as the
    // two-device defect found on hardware, one tier down. The LAN demo hid it,
    // because `SeedServer` reads `reservedPeerIds` in-process and never asks over
    // the wire.
    serveAgent({
      rpc,
      executor,
      blockstore,
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      capacity: 'accepts-every-offer',
      reservations: () => node.reservedPeerIds,
      ledger: 'keeps-no-ledger',
      onDispatch: 'reports-no-dispatch',
    })

    return node
  }

  get peerId(): string {
    return this.libp2p.peerId.toString()
  }

  /** Addresses a peer can dial to reach this node. */
  get multiaddrs(): readonly string[] {
    return this.libp2p.getMultiaddrs().map((ma) => ma.toString())
  }

  /**
   * The relayed subset — the only kind of address a browser peer ever has.
   *
   * Empty until a relay has granted a reservation, which is why callers wait on it
   * rather than reading it immediately after `start`.
   */
  get circuitAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/p2p-circuit'))
  }

  /** The browser-dialable subset. A browser cannot use anything else. */
  get browserDialableAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/ws') || ma.includes('/wss'))
  }

  /**
   * Whether this node is carrying circuits for other peers.
   *
   * Read off the live service rather than off a remembered flag, so it cannot drift
   * from what libp2p is actually doing. Callers use it to describe a node, never to
   * decide what to ask it for: every node answers the same requests.
   */
  get relays(): boolean {
    return hasReservations(this.libp2p.services['relay'])
  }

  /** Simultaneous inbound handshakes this node will accept. */
  get maxIncomingPendingConnections(): number {
    return this.#pending
  }

  /** Inbound connections per second this node accepts from one host. */
  get inboundConnectionThreshold(): number {
    return this.#inboundPerSecond
  }

  /**
   * Current reservation capacity, reported by name.
   *
   * NET-05: a relay at capacity must say so. Without this, a node that cannot
   * reserve sees only "no circuit address appeared", which is indistinguishable
   * from the relay being unreachable — and the two need completely different
   * responses (try another relay vs. wait and retry).
   */
  get capacity(): RelayCapacity {
    const service: unknown = this.libp2p.services['relay']
    const granted = hasReservations(service) ? service.reservations.size : 0
    return {
      granted,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - granted),
      atCapacity: granted >= this.#limit,
    }
  }

  /**
   * Peer ids currently holding a reservation here.
   *
   * This is the whole of the rendezvous a LAN demo needs. Two browsers on the same
   * relay are mutually dialable the moment each knows the other exists, and neither
   * can announce itself — a browser binds no listening socket, which is the *only*
   * difference between nodes in this fabric. A node that relays already holds the
   * list as a consequence of doing its job; publishing it adds no state and no
   * authority.
   *
   * Read from the live store on demand, for the same reason `capacity` is: libp2p
   * declares a `relay:reservation` event and never dispatches it.
   */
  get reservedPeerIds(): readonly string[] {
    const service: unknown = this.libp2p.services['relay']
    if (!hasReservations(service)) return []
    return [...service.reservations.keys()].map((peer) => peer.toString())
  }

  /** Dial a peer and return its peer id. */
  async dial(address: string): Promise<string> {
    const connection = await this.libp2p.dial(multiaddr(address))
    return connection.remotePeer.toString()
  }

  async stop(): Promise<void> {
    this.rpc.close()
    await this.transport.stop()
    await this.libp2p.stop()
  }
}
