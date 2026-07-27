/**
 * A complete Node.js fabric node, assembled from adapters.
 *
 * Every part is behind a port, and this factory is the only place that knows which
 * concrete implementation is in use:
 *
 *   `Transport`  → libp2p over TCP
 *   `Blockstore` → filesystem, wrapped in network fallback
 *   `Executor`   → the kernel's `WasmExecutor`
 *
 * A node is symmetric. It serves task dispatches and block requests, and it can
 * submit jobs of its own — there is no client/worker distinction in the code, only
 * in what a given process happens to do.
 *
 * Module set assembled from libp2p's own `packages/integration-tests`: TCP + noise
 * + yamux is the most-exercised path in the ecosystem. `identify` is not optional
 * in practice — relay discovery, AutoNAT, and DCUtR all depend on it.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { WasmExecutor } from '@o2/core'
import type { Executor } from '@o2/core'
import { FetchingBlockstore, RpcBlockSource, RpcEndpoint, serveAgent } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { FsBlockstore } from './fs-blockstore.ts'
import { Libp2pTransport } from '@o2/libp2p'
import type { ReservationWatcher } from './reservation-watch.ts'

export interface FabricNodeOptions {
  /** Directory backing the persistent blockstore. */
  readonly blockstoreDir: string
  /** Multiaddrs to listen on. Port 0 asks the OS for a free port. */
  readonly listen?: readonly string[]
  /** Overrides the RPC request timeout; mainly useful to keep tests quick. */
  readonly rpcTimeoutMs?: number
  /**
   * Relays to reserve a `/p2p-circuit` address on.
   *
   * Supplying any switches the node into the topology a browser peer is forced
   * into: reachable only through a relay. Adds WebSockets (to dial the relay) and
   * the circuit-relay transport, and listens on `/p2p-circuit`.
   */
  readonly relayAddrs?: readonly string[]
  /** Observes relay reservation outcomes — see NET-05. */
  readonly reservationWatcher?: ReservationWatcher
}

export class FabricNode {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  readonly rpc: RpcEndpoint
  /** Local blocks plus network fallback. This is what the executor reads from. */
  readonly blockstore: FetchingBlockstore
  /** The persistent tier, without network fallback. */
  readonly store: FsBlockstore
  readonly executor: Executor

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    blockstore: FetchingBlockstore
    store: FsBlockstore
    executor: Executor
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.executor = parts.executor
  }

  static async start(options: FabricNodeOptions): Promise<FabricNode> {
    const store = await FsBlockstore.open(options.blockstoreDir)
    const relayAddrs = options.relayAddrs ?? []
    const viaRelay = relayAddrs.length > 0

    const libp2p = await createLibp2p({
      addresses: {
        listen: [
          ...(options.listen ?? (viaRelay ? [] : ['/ip4/127.0.0.1/tcp/0'])),
          // Asks libp2p to reserve on any relay it connects to.
          ...(viaRelay ? ['/p2p-circuit'] : []),
        ],
      },
      // WebSockets in both branches, not only the relay one. A browser cannot dial
      // plain TCP, so a node without this transport is unreachable from the tier
      // this project exists for — however good its address looks in a log.
      transports: viaRelay
        ? [tcp(), webSockets(), circuitRelayTransport()]
        : [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
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
    const executor = new WasmExecutor({ nodeId: libp2p.peerId.toString(), blockstore })
    serveAgent({ rpc, executor, blockstore })

    return new FabricNode({ libp2p, transport, rpc, blockstore, store, executor })
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
