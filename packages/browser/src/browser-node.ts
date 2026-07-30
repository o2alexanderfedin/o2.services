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
import {
  DEFAULT_MAX_CONCURRENT_TASKS,
  LocalCapacity,
  WasmExecutor,
  guardSovereignty,
} from '@o2/core'
import type { NodeSovereignty } from '@o2/core'
import { Libp2pTransport } from '@o2/libp2p'
import {
  CountingExecutor,
  EgressGuard,
  FetchingBlockstore,
  GovernedExecutor,
  registerSovereignInputs,
  RpcBlockSource,
  RpcEndpoint,
  serveAgent,
} from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { IdbBlockstore } from './idb-blockstore.ts'
import { VisibilityGovernor } from './visibility-governor.ts'
import { WorkerExecutor } from './worker-executor.ts'
import type { WorkerFactory } from './worker-executor.ts'

export interface BrowserNodeOptions {
  /** Relays to reserve on. At least one is required to be addressable at all. */
  readonly relayAddrs: readonly string[]
  /**
   * This node's clearance to execute sovereign data — DATA-09's serving-side
   * gate (`guardSovereignty`, `@o2/core`), applied unconditionally inside the
   * `Executor` this factory composes below, same as `fabric-node.ts`.
   *
   * Optional, and the default is the safe one: cleared for nobody
   * (`canExecuteSovereign: false`). A tab started with no `sovereignty` option
   * therefore refuses every sovereign-labelled task regardless of whose owner
   * id it names. Per-node clearance, not a node class — every `BrowserNode` has
   * the identical executor, transport, and relay-reservation behaviour
   * regardless of this setting, mirroring `fabric-node.ts`'s "why there is no
   * second class".
   */
  readonly sovereignty?: NodeSovereignty
  /** IndexedDB database name. Distinct names give one origin several independent nodes. */
  readonly blockstoreName?: string
  readonly rpcTimeoutMs?: number
  /**
   * Tasks this tab will run at once before it refuses an `exec` request with its
   * own words — SCHED-06.
   *
   * Defaults to `DEFAULT_MAX_CONCURRENT_TASKS` (`@o2/core`, which is the only place
   * that carries the value), mirroring `fabric-node.ts`. Per-node capacity, not a
   * node class: every `BrowserNode` has the identical executor, transport and
   * relay-reservation behaviour whatever this is set to.
   *
   * **This is not the duty cycle and must never be derived from it** — see the note
   * beside the `LocalCapacity` construction in `start`.
   */
  readonly maxConcurrentTasks?: number
  /**
   * Largest single inbound frame this tab will accumulate before it aborts the
   * stream — NET-08.
   *
   * Defaults to `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`). The first
   * `Libp2pTransportOptions` field this factory has ever passed, mirroring
   * `fabric-node.ts`; the send-side gate's own bounds are deliberately not exposed
   * here, for the reason given there.
   */
  readonly maxMessageBytes?: number
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
  /**
   * Wraps `transport` so every outbound RPC frame is recorded — DATA-05/DATA-06.
   *
   * A new field, not a type change to `transport` — mirrors `fabric-node.ts`.
   * `rpc` is constructed over this field, not over `transport`.
   */
  readonly egress: EgressGuard
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
   * This tab's execution admission control — SCHED-06.
   *
   * `admission.slots` is the declared limit and `admission.peakInFlight` says
   * whether it was ever **reached**. It does **not** say whether it *held*:
   * `LocalCapacity.offer()` returns its refusal before the reservation is taken, so
   * `peakInFlight <= slots` is arithmetic and cannot fail. The reading that can
   * falsify the bound is {@link executorPeakInFlight}.
   */
  readonly admission: LocalCapacity
  /** The instrument {@link executorPeakInFlight} reads. */
  readonly #counter: CountingExecutor
  /**
   * The thread tasks run on, when there is one.
   *
   * Null means execution is on the main thread, which is a materially different
   * node: a task in flight cannot then be interrupted, so `stop()` means "stop
   * taking work" rather than "stop working". Exposed so the difference is
   * checkable instead of assumed — see `offMainThread`.
   */
  readonly worker: WorkerExecutor | null
  /**
   * Peers whose work this node has run, and how much of it — BROW-04.
   *
   * The surface must say what is running *and for whom*. A `Task` is addressed
   * entirely by CID and names no requestor, so this is recorded where the answer
   * exists: at the point a peer dispatches.
   */
  readonly servedFor: Map<string, number> = new Map<string, number>()
  readonly #activityListeners = new Set<() => void>()

  /**
   * Subscribe to "this node is now doing something different".
   *
   * Pushed rather than polled for the reason measured in this phase: Chromium
   * throttles timers hard in a tab that is not in front, so a background tab
   * serving a peer's work would show a stale surface — or none — for as long as
   * nobody was looking at it, which is the case BROW-04 exists for.
   */
  onActivity(listener: () => void): () => void {
    this.#activityListeners.add(listener)
    return () => {
      this.#activityListeners.delete(listener)
    }
  }

  #announce(): void {
    for (const listener of this.#activityListeners) listener()
  }

  private constructor(parts: {
    libp2p: Libp2p
    transport: Libp2pTransport
    rpc: RpcEndpoint
    egress: EgressGuard
    blockstore: FetchingBlockstore
    store: IdbBlockstore
    executor: GovernedExecutor
    governor: VisibilityGovernor
    worker: WorkerExecutor | null
    admission: LocalCapacity
    counter: CountingExecutor
  }) {
    this.libp2p = parts.libp2p
    this.transport = parts.transport
    this.rpc = parts.rpc
    this.egress = parts.egress
    this.blockstore = parts.blockstore
    this.store = parts.store
    this.executor = parts.executor
    this.governor = parts.governor
    this.worker = parts.worker
    this.admission = parts.admission
    this.#counter = parts.counter
  }

  /**
   * The most `execute()` calls ever running at once inside this tab.
   *
   * SCHED-06's criterion 1 is read off this: it counts calls that *happened*, so it
   * can read any number, where `admission.peakInFlight` cannot exceed `slots` by
   * construction.
   *
   * Composed **inside** `GovernedExecutor` rather than outside it — see the note at
   * the construction. It therefore counts tasks actually running, not tasks parked
   * on the governor's serialization chain waiting for a slice.
   */
  get executorPeakInFlight(): number {
    return this.#counter.peakInFlight
  }

  /** Calls currently inside the inner executor. */
  get executorInFlight(): number {
    return this.#counter.inFlight
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

    // NET-08: the first `Libp2pTransportOptions` this factory has ever passed — the
    // option surface existed and no node reached it. Key omitted rather than set to
    // an explicit `undefined`, because `exactOptionalPropertyTypes` makes those
    // different types; the same idiom threads `rpcTimeoutMs` below.
    const transport = await Libp2pTransport.start(
      libp2p,
      options.maxMessageBytes === undefined ? {} : { maxMessageBytes: options.maxMessageBytes },
    )
    // Resolved once, here, so the identical value feeds both `egress`'s ownerId
    // and `guardSovereignty`'s clearance check below — mirrors `fabric-node.ts`.
    const sovereignty = options.sovereignty ?? { ownerId: '', canExecuteSovereign: false }
    // DATA-05/DATA-06: every outbound RPC frame is recorded by construction —
    // `rpc` is built over this guard, not over the raw `transport`, below.
    const egress = new EgressGuard(transport, sovereignty.ownerId)
    const rpc = new RpcEndpoint(
      egress,
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
    // DATA-09: guarded unconditionally, with no opt-in required to get the
    // refusal — `options.sovereignty` defaults to cleared-for-nobody (see
    // `BrowserNodeOptions.sovereignty`'s doc). Wrapped *inside* the governor
    // rather than around it, so `this.executor` stays exactly a
    // `GovernedExecutor` (BROW-04's `.executed`/`.dutyCycle` surface,
    // unaffected by what runs underneath) while every path that reaches
    // `.execute` — a remote dispatch via `serveAgent` below, and a page's own
    // local self-dispatch (`includeSelf`, `demo/main.ts`) alike — passes
    // through the identical guard. Registration is equally unconditional,
    // composed outside guardSovereignty and inside GovernedExecutor — DATA-05/
    // DATA-06: a sovereign task's input is declared to this node's own tap
    // before it runs. `store` (the local-only `IdbBlockstore`) is the
    // registration blockstore, not `blockstore` (network fallback), mirroring
    // `fabric-node.ts`.
    //
    // SCHED-06: `CountingExecutor` sits **inside** `GovernedExecutor`, not outside
    // it, and the deviation from `fabric-node.ts`'s outermost composition is
    // deliberate on two counts. `this.executor` must stay exactly a
    // `GovernedExecutor` for BROW-04's `.executed`/`.dutyCycle` surface — the same
    // constraint the sovereignty comment above is written around — and a counter
    // outside the governor would count tasks *parked on its serialization chain* as
    // in flight, which is precisely not what "how many tasks is this tab running at
    // once" means. Inside, it counts tasks actually running.
    const counter = new CountingExecutor(
      registerSovereignInputs(
        guardSovereignty(worker ?? new WasmExecutor({ nodeId, blockstore }), sovereignty),
        { blockstore: store, guard: egress },
      ),
    )
    const executor = new GovernedExecutor(counter, governor)
    // SCHED-06 — this tab's own admission control, handed to `serveAgent` below.
    //
    // **The visibility duty cycle is deliberately not passed as `dutyCycle`.** It is
    // the obvious next line and it is wrong: this tab already paces every task
    // through `GovernedExecutor`, and two independent throttles on one path produce
    // a number nobody can predict — a backgrounded tab would both run tasks slower
    // *and* refuse them earlier, from two mechanisms neither of which knows about
    // the other. The slot count is what this tab will hold at once; the governor is
    // how fast it runs them. They are different questions and only one of them is
    // this object's.
    //
    // Constructed after `libp2p` because the node id comes from it, and thrown
    // straight out of `start` when the option is nonsense: `LocalCapacity`'s own
    // `RangeError` guard is reached rather than bypassed by a clamp.
    const admission = new LocalCapacity({
      nodeId,
      maxConcurrent: options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS,
    })
    const node = new BrowserNode({
      libp2p,
      transport,
      rpc,
      egress,
      blockstore,
      store,
      executor,
      governor,
      worker,
      admission,
      counter,
    })
    serveAgent({
      rpc,
      executor,
      blockstore,
      // DATA-05: the same guard `rpc` is built over, so a sovereign task's
      // registration is released once its reply frame has settled rather than
      // held for the life of the tab.
      egress,
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      // SCHED-06. This hook answered "accepts everything" for the whole of two
      // milestones, so `serveAgent`'s `exec` branch ran `executor.execute` with
      // nothing counting what was in flight — a probe measured 800 simultaneous
      // executions and zero refusals. `LocalCapacity` existed the entire time and
      // was constructed nowhere outside two test files. `ARCHITECTURE.md` §7.2 said
      // *an over-committed node just says no, and the requestor resamples*; only
      // the half that resamples had shipped.
      //
      // **Unmeasured on this factory, and that is the honest report.**
      // `BrowserNode.start` needs a real `indexedDB` and a relay to dial, so it runs
      // in neither vitest project; the behaviour is proved on `FabricNode`
      // (`packages/node/src/admission.node.test.ts`) and only *composed* here. A
      // grep confirming this line does not stand in for running it — that is exactly
      // the substitution 13-VERIFICATION-2.md recorded the cost of. WIRE-03,
      // Phase 19 builds the harness that would measure it.
      capacity: admission,
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: (from) => {
        node.servedFor.set(from, (node.servedFor.get(from) ?? 0) + 1)
        node.#announce()
      },
    })
    return node
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
