/**
 * A complete fabric node inside a browser tab.
 *
 * Same composition as the Node one — `Transport`, `Blockstore`, `Executor` behind
 * ports — with only the concrete adapters differing:
 *
 *   `Transport`  → libp2p over WebRTC, signalled through a Circuit Relay v2 peer
 *   `Blockstore` → IndexedDB, wrapped in network fallback
 *   `Executor`   → the kernel's `WasmExecutor`, unchanged
 *
 * ## Why the transport list looks like this
 *
 * A browser cannot bind a listening socket, so:
 *
 *   - `webSockets()` exists only to *dial* the relay. It can never listen.
 *   - `circuitRelayTransport()` makes `/p2p-circuit` dialable and lets this node
 *     hold a reservation, which is the only way it becomes addressable at all.
 *   - `webRTC()` is the sole browser↔browser option. There is no alternative and no
 *     fallback.
 *
 * Listening on `['/p2p-circuit', '/webrtc']` is likewise not a choice — it is the
 * only combination a browser can offer. The relay carries the SDP exchange; once ICE
 * completes the data flows directly between tabs and the relay drops out, which is
 * what keeps the fabric's capacity independent of the backbone's bandwidth.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { WasmExecutor } from '@o2/core'
import { Libp2pTransport } from '@o2/libp2p'
import { FetchingBlockstore, GovernedExecutor, RpcBlockSource, RpcEndpoint, serveAgent } from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { IdbBlockstore } from './idb-blockstore.ts'
import { VisibilityGovernor } from './visibility-governor.ts'
import { WorkerExecutor } from './worker-executor.ts'
import type { WorkerFactory } from './worker-executor.ts'

export interface BrowserNodeOptions {
  /** Relays to reserve on. At least one is required to be addressable at all. */
  readonly relayAddrs: readonly string[]
  /** IndexedDB database name. Distinct names give one origin several independent nodes. */
  readonly blockstoreName?: string
  readonly rpcTimeoutMs?: number
  /**
   * Duty cycle to fall back to while the tab is hidden.
   *
   * BROW-03. Defaults to 0.1 — a backgrounded tab throttles hard but never stops, so
   * a task already in flight still finishes.
   */
  readonly backgroundDutyCycle?: number
  /**
   * Permit dialling loopback and private addresses.
   *
   * libp2p refuses them by default in a browser, which is right for the public
   * internet and wrong for a relay on `127.0.0.1`. Only enable for local testing.
   */
  readonly allowPrivateAddrs?: boolean
  /**
   * Builds the Worker that tasks execute on — BROW-04.
   *
   * Supplied rather than defaulted, because the `?worker` import that builds one
   * is Vite syntax and this class is also constructed by tests that have no
   * bundler. Omitting it is not a hidden downgrade: execution falls back to the
   * main thread and {@link BrowserNode.offMainThread} says so, so a page that
   * needs a stoppable node can assert the property rather than assume it.
   */
  readonly createWorker?: WorkerFactory
}

export class BrowserNode {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  readonly rpc: RpcEndpoint
  /** IndexedDB plus network fallback — what the executor reads from. */
  readonly blockstore: FetchingBlockstore
  readonly store: IdbBlockstore
  /**
   * Governed: throttles with tab visibility.
   *
   * Typed as the concrete `GovernedExecutor` rather than the `Executor` port so the
   * always-visible surface (BROW-04) can read `executed` and `dutyCycle`. It still
   * satisfies the port everywhere one is wanted.
   */
  readonly executor: GovernedExecutor
  readonly governor: VisibilityGovernor
  /**
   * The thread tasks run on, when there is one.
   *
   * Null means execution is on the main thread, which is a materially different
   * node: a task in flight cannot then be interrupted, so `stop()` means "stop
   * taking work" rather than "stop working". Exposed so the difference is
   * checkable instead of assumed — see `offMainThread`.
   */
  readonly worker: WorkerExecutor | null

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    blockstore: FetchingBlockstore
    store: IdbBlockstore
    executor: GovernedExecutor
    governor: VisibilityGovernor
    worker: WorkerExecutor | null
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.executor = parts.executor
    this.governor = parts.governor
    this.worker = parts.worker
  }

  /**
   * Whether compute happens off the main thread — BROW-04.
   *
   * Only then does stopping drop CPU to zero at the moment of the click rather
   * than at the end of whatever was already running.
   */
  get offMainThread(): boolean {
    return this.worker !== null
  }

  static async start(options: BrowserNodeOptions): Promise<BrowserNode> {
    const store = await IdbBlockstore.open(options.blockstoreName ?? 'o2-blocks')

    const libp2p = await createLibp2p({
      // The only listen set a browser can offer.
      addresses: { listen: ['/p2p-circuit', '/webrtc'] },
      transports: [webSockets(), webRTC(), circuitRelayTransport()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: { identify: identify(), identifyPush: identifyPush() },
      ...(options.allowPrivateAddrs === true
        ? { connectionGater: { denyDialMultiaddr: async () => false } }
        : {}),
    })

    // Connecting to a relay is what triggers the reservation that makes this tab
    // addressable. Without at least one, nothing can ever reach it.
    for (const address of options.relayAddrs) {
      await libp2p.dial(multiaddr(address))
    }

    const transport = await Libp2pTransport.start(libp2p)
    const rpc = new RpcEndpoint(
      transport,
      options.rpcTimeoutMs === undefined ? {} : { timeoutMs: options.rpcTimeoutMs },
    )
    const blockstore = new FetchingBlockstore(store, new RpcBlockSource(rpc, () => transport.peers))
    // BROW-03: every task this tab runs — its own and other peers' — is paced by
    // the visibility governor. Wrapping here rather than at the submit site means a
    // backgrounded tab throttles work it is *serving*, which is the case that
    // actually affects a visitor.
    const governor = new VisibilityGovernor(
      options.backgroundDutyCycle === undefined
        ? {}
        : { backgroundDutyCycle: options.backgroundDutyCycle },
    )
    const nodeId = libp2p.peerId.toString()
    // BROW-04: when a Worker factory is available, tasks run on a thread that can
    // be killed. Without one the kernel executor runs inline, which is correct for
    // tests and is reported honestly rather than silently.
    const worker =
      options.createWorker === undefined
        ? null
        : new WorkerExecutor({ nodeId, blockstore, createWorker: options.createWorker })
    const executor = new GovernedExecutor(
      worker ?? new WasmExecutor({ nodeId, blockstore }),
      governor,
    )
    serveAgent({ rpc, executor, blockstore })

    return new BrowserNode({ libp2p, transport, rpc, blockstore, store, executor, governor, worker })
  }

  get peerId(): string {
    return this.libp2p.peerId.toString()
  }

  get multiaddrs(): readonly string[] {
    return this.libp2p.getMultiaddrs().map((ma) => ma.toString())
  }

  /**
   * The `/webrtc` addresses another tab can dial.
   *
   * Empty until a relay reservation exists, because a browser's WebRTC address is
   * expressed relative to the relay that will carry its SDP exchange.
   */
  get webrtcAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/webrtc'))
  }

  get circuitAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/p2p-circuit'))
  }

  async dial(address: string): Promise<string> {
    const connection = await this.libp2p.dial(multiaddr(address))
    return connection.remotePeer.toString()
  }

  /**
   * Stop everything — BROW-04's "one click provably drops CPU to zero".
   *
   * The thread dies first. Closing the connections before killing it would leave
   * a window in which the node is unreachable but still burning cycles, which is
   * the worst of both and exactly what a visitor pressing Stop does not want.
   */
  async stop(): Promise<void> {
    this.worker?.terminate()
    this.rpc.close()
    await this.transport.stop()
    await this.libp2p.stop()
    this.governor.stop()
    this.store.close()
  }
}
