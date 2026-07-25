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
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { multiaddr } from '@multiformats/multiaddr'
import { WasmExecutor } from '@o2/core'
import type { Executor } from '@o2/core'
import { FetchingBlockstore, RpcBlockSource, RpcEndpoint, serveAgent } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { FsBlockstore } from './fs-blockstore.ts'
import { Libp2pTransport } from './libp2p-transport.ts'

export interface FabricNodeOptions {
  /** Directory backing the persistent blockstore. */
  readonly blockstoreDir: string
  /** Multiaddrs to listen on. Port 0 asks the OS for a free port. */
  readonly listen?: readonly string[]
  /** Overrides the RPC request timeout; mainly useful to keep tests quick. */
  readonly rpcTimeoutMs?: number
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

    const libp2p = await createLibp2p({
      addresses: { listen: [...(options.listen ?? ['/ip4/127.0.0.1/tcp/0'])] },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
      },
    })

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
