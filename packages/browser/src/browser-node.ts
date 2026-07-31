/**
 * A complete fabric node inside a browser tab.
 *
 * Same composition as the Node one — `Transport`, `Blockstore`, `Executor` behind
 * ports — with only the concrete adapters differing:
 *
 *   `Transport`  → libp2p over WebRTC, signalled through a Circuit Relay v2 peer
 *   `Blockstore` → IndexedDB, wrapped in network fallback
 *   `Executor`   → the kernel's `WasmExecutor`, on a thread this tab can kill
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
  SignedNameResolver,
  guardModuleProvenance,
  guardSovereignty,
} from '@o2/core'
import type { Executor, NodeSovereignty, PublicKeyHex } from '@o2/core'
import { Libp2pTransport } from '@o2/libp2p'
import {
  CountingExecutor,
  EgressGuard,
  FetchingBlockstore,
  GovernedExecutor,
  RpcBlockSource,
  RpcEndpoint,
  serveAgent,
} from '@o2/net'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { IdbBlockstore } from './idb-blockstore.ts'
import { VisibilityGovernor } from './visibility-governor.ts'
import { browserWorkerExecutor } from './worker-executor.ts'
import type { WorkerExecutor } from '@o2/core'
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
  /**
   * The build authorities this tab will run a module for — DET-03, DATA-08.
   *
   * **Mirrors `FabricNodeOptions.trustAnchors` exactly** (`packages/node/src/fabric-node.ts`),
   * which carries the long form of this reasoning; the two docs are meant to be read
   * together, the way the `sovereignty` docs on either side already are. Same type, same
   * three admitted values, same requiredness — because a browser node is not a lesser
   * node, and "the tab is only the demo" is precisely the reasoning that would put the
   * hole here rather than in the Node tier.
   *
   * An anchor is the public half of a signing key, pinned in advance. A CID proves the
   * bytes are the bytes that were hashed and says nothing about who meant them to run; a
   * `NameRecord` signed by one of these keys says that, and `guardModuleProvenance`
   * (`@o2/core`) refuses any task whose module did not arrive with one — before the
   * module's bytes are fetched, let alone instantiated.
   *
   * **Required, with no `?` and no default.** `.planning/PROJECT.md`'s Key Decision —
   * *an optional hook with a silent default is a hole* — and the same convention
   * `createWorker` above adopted for the same reason. Whichever default were chosen here,
   * a tab would get it without anyone deciding.
   *
   * Three values and what each admits:
   *
   * - **`[pub, …]`** — this tab runs a module exactly when a record signed by one of
   *   these keys names its CID.
   * - **`[]`** — this tab trusts nobody, and therefore refuses every module. That is the
   *   safe reading of an empty set and it is deliberately **not** special-cased into
   *   meaning something friendlier: a caller who wanted the escape hatch has a word for
   *   it, and an empty array is not that word.
   * - **`'runs-unsigned-artifacts'`** — no guard is composed at all and this tab reverts
   *   to resolving bare CIDs, as every node did before this phase. Written down at the
   *   call site rather than reached by omission precisely because it is the one value
   *   that turns DET-03 off, and a value that turns a guarantee off must cost somebody a
   *   decision.
   *
   * **The `TabApi` surface above this one is deliberately stricter and admits no
   * opt-out at all** — `start` takes an optional anchor *list* that defaults to the
   * demo's own committed authority, and `runJob` requires a record. There is no value a
   * page or a harness can pass through `window.o2` that yields a tab resolving bare
   * CIDs. The escape hatch belongs to whoever constructs a node in TypeScript and has
   * written down that they want one; it is not part of the tab's contract. See
   * `tab-api.ts`.
   *
   * Per-node **configuration**, not a node kind. Every `BrowserNode` has the identical
   * executor, transport and relay-reservation behaviour whatever is passed here —
   * exactly as `sovereignty` does — and nothing anywhere branches on what kind of node
   * something is.
   */
  readonly trustAnchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts'
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
   * Builds the Worker that tasks execute on — BROW-04, SCHED-06.
   *
   * Required, and injected rather than defaulted. Those are two separate facts and
   * only the second follows from the bundler: `?worker` is Vite syntax
   * (`worker-factory.ts`), so the *spelling* of a thread belongs to whatever bundles
   * the page. *Having* one is not the page's choice. A guest `run()` is a synchronous
   * call, so on this tab's main thread the wall-clock deadline cannot fire — the timer
   * is queued on the loop the guest is holding — and there is no thread to terminate.
   * The bound is not weaker there, it is absent, and a 52-byte `loop br 0` from any
   * peer wedged the tab permanently, `stop()` included.
   *
   * This was optional until SCHED-06, justified by "tests that have no bundler". No
   * such test was ever written: `BrowserNode.start` needs a real `indexedDB` and a
   * relay to dial, so `demo/main.ts` is the only construction site there has ever
   * been — and it already passed a factory. The escape hatch was cut for a caller that
   * does not exist, and it was the only thing between an untrusted peer's module and
   * this tab's main thread.
   */
  readonly createWorker: WorkerFactory
  /**
   * How long one task may hold this tab's thread before it is killed — SCHED-06.
   *
   * Defaults to `DEFAULT_TASK_DEADLINE_MS` (`@o2/core`, the only place the value
   * lives). An option rather than only a constant for the same reason
   * `maxConcurrentTasks` is one: a test that wants to observe the bound has to be
   * able to make it certain rather than hope for it. Per-node, and not a node class —
   * nothing anywhere branches on it.
   */
  readonly taskDeadlineMs?: number
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
   * The thread tasks run on.
   *
   * Never absent — {@link BrowserNodeOptions.createWorker} is required, so "a tab
   * computing with nothing able to interrupt it" has no spelling. Same move
   * `EgressHold` made against "release a hold you never took". `stop()` kills this,
   * which is what makes "one click drops CPU to zero" a property of the platform
   * rather than of this code behaving.
   */
  readonly worker: WorkerExecutor
  /**
   * Peers whose work this node has run, and how much of it — BROW-04.
   *
   * The surface must say what is running *and for whom*. A `Task` is addressed
   * entirely by CID and names no requestor, so this is recorded where the answer
   * exists: at the point this node begins running it, which is the only point at
   * which both facts are known.
   *
   * Requests this node turned away are not here. They stay legible through
   * {@link admission} — `slots`, `inFlight`, `peakInFlight` — which is what a
   * refusal is a fact about.
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
    worker: WorkerExecutor
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
   * Join the fabric, or leave the tab as it was found.
   *
   * Same split as `FabricNode.start`, and this half is where it matters most:
   * `demo/main.ts` catches a rejected start, classifies it for the UI, and the user
   * can press the button again. Every failed retry used to strand a whole libp2p
   * node plus an open IndexedDB connection, so an unreachable — or hostile — relay
   * was a remotely triggered way to exhaust a visitor's tab.
   *
   * The blockstore is opened *before* `createLibp2p`, which is exactly why a
   * hand-written catch after the node gets it wrong. Releases run newest-first, so
   * acquisition order is the only order anybody has to think about.
   *
   * **Measured on this factory, in Chromium, Firefox and WebKit** —
   * `start-unwind.browser.test.ts`. It stood unmeasured for two milestones behind
   * "needs a real `indexedDB` and a relay to dial", which was true of the Node project
   * and never of the browser one: the `browser` project has a real `indexedDB`, and an
   * undialable relay address is a failure that costs nothing to arrange. What the
   * three cases read is the *effect* of the unwind rather than the rejection — an
   * `indexedDB.deleteDatabase` that is not blocked (the store was closed) and no
   * surviving `ConnectionMonitor` heartbeat (libp2p was stopped), both from outside,
   * because a rejected `start` hands its caller no object to interrogate. Asserting
   * only that `start` rejects would pass just as happily with this whole `catch`
   * deleted.
   *
   * Running it against that deletion is how the numbers above stopped being a claim:
   * three failed attempts left three live libp2p nodes and a blocked delete, in all
   * three engines. The `visibilitychange` release below was found the same way, and
   * did not exist until it was.
   */
  static async start(options: BrowserNodeOptions): Promise<BrowserNode> {
    const undo: (() => Promise<void> | void)[] = []
    try {
      return await BrowserNode.#compose(options, undo)
    } catch (cause) {
      for (const release of undo.reverse()) {
        try {
          await release()
        } catch {
          // Nothing to do about it, and reporting it would report the wrong failure.
        }
      }
      throw cause
    }
  }

  static async #compose(
    options: BrowserNodeOptions,
    undo: (() => Promise<void> | void)[],
  ): Promise<BrowserNode> {
    const store = await IdbBlockstore.open(options.blockstoreName ?? 'o2-blocks')
    undo.push(() => store.close())

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
    undo.push(() => libp2p.stop())

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
    // DET-03/DATA-08: resolved once, here, beside where `sovereignty` is resolved once
    // and for the identical stated reason — two independently defaulted copies could
    // drift. Mirrors `fabric-node.ts`, which builds the same wrapper from the same
    // option; the placement argument is below, at the composition.
    const anchors = options.trustAnchors
    const provenance =
      anchors === 'runs-unsigned-artifacts'
        ? (inner: Executor): Executor => inner
        : (inner: Executor): Executor =>
            guardModuleProvenance(inner, {
              resolver: new SignedNameResolver(anchors),
              // A thunk, never a captured number — see `ModuleProvenance.now`. A tab that
              // read the clock here would keep running an expired record for as long as
              // it stayed open, which for a tab is potentially days.
              now: () => Date.now(),
            })
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
    // BROW-02: the third acquisition, and the one that survives its own node. The
    // governor's constructor takes a `visibilitychange` listener on the *document* —
    // a resource that outlives every object this factory built, because the page does.
    // A `start` that failed after this line therefore left a listener nobody had a
    // handle to remove, and `demo/main.ts` lets a visitor press Start again after a
    // failure, so they accumulate one per attempt. Measured in Chromium, Firefox and
    // WebKit before this line existed — `start-unwind.browser.test.ts`, which reads it
    // from `document` rather than from the node.
    undo.push(() => governor.stop())
    const nodeId = libp2p.peerId.toString()
    // BROW-04, SCHED-06: tasks run on a thread this tab can kill, unconditionally.
    // There is no other arrangement — see `BrowserNodeOptions.createWorker`.
    const worker = browserWorkerExecutor({
      nodeId,
      blockstore,
      createWorker: options.createWorker,
      ...(options.taskDeadlineMs === undefined ? {} : { deadlineMs: options.taskDeadlineMs }),
    })
    // DATA-09: guarded unconditionally, with no opt-in required to get the
    // refusal — `options.sovereignty` defaults to cleared-for-nobody (see
    // `BrowserNodeOptions.sovereignty`'s doc). Wrapped *inside* the governor
    // rather than around it, so `this.executor` stays exactly a
    // `GovernedExecutor` (BROW-04's `.executed`/`.dutyCycle` surface,
    // unaffected by what runs underneath) while every path that reaches
    // `.execute` — a remote dispatch via `serveAgent` below, and a page's own
    // local self-dispatch (`includeSelf`, `demo/main.ts`) alike — passes
    // through the identical guard.
    //
    // DATA-05/DATA-06 no longer appear in this chain, mirroring `fabric-node.ts`: a
    // sovereign task's input is declared by `serveAgent`, which is also the layer that
    // gives the hold back once the reply frame has settled. `store` (the local-only
    // `IdbBlockstore`) is still the registration blockstore and is handed to
    // `serveAgent` below, never `blockstore` (network fallback). A page's own
    // self-dispatch therefore declares nothing — and no longer takes a hold nothing
    // gave back; the demo's self-dispatch goes through `submitJobWithEgress`, which
    // holds for the job's lifetime.
    //
    // SCHED-06: `CountingExecutor` sits **inside** `GovernedExecutor`, not outside
    // it, and the deviation from `fabric-node.ts`'s outermost composition is
    // deliberate on two counts. `this.executor` must stay exactly a
    // `GovernedExecutor` for BROW-04's `.executed`/`.dutyCycle` surface — the same
    // constraint the sovereignty comment above is written around — and a counter
    // outside the governor would count tasks *parked on its serialization chain* as
    // in flight, which is precisely not what "how many tasks is this tab running at
    // once" means. Inside, it counts tasks actually running.
    //
    // DET-03/DATA-08: `provenance` is the **innermost** layer, with nothing between it
    // and the executor that reaches `WebAssembly.instantiate`. That is what makes
    // "refused before instantiation" true by construction rather than by inspecting
    // whatever happens to be layered above it this month — the same argument
    // `fabric-node.ts` gives at its own composition, and the same ordering.
    //
    // Sovereignty stays **outside** it, also mirroring `fabric-node.ts`: a tab that may
    // not decrypt an owner's data should say *that*, whatever module was named. The
    // clearance answer is about this node; the provenance answer is about the
    // dispatcher's record and would bury it.
    //
    // **It wraps `worker`, and `worker` is the only arm there is.** 14-04's plan
    // described this line as a null-coalescing pair whose second arm built a main-thread
    // executor directly, and instructed that the guard wrap the pair as a whole so
    // neither arm escaped. That expression no longer exists: `createWorker` became
    // required and the main-thread fallback was deleted outright (see
    // `BrowserNodeOptions.createWorker`), so there is exactly one executor here and it is
    // the one that resolves. The instruction's *point* — guard the executor that reaches
    // instantiation rather than something sitting near it — is what this line satisfies;
    // there is no second arm left to miss. Were a fallback ever reintroduced, the guard
    // would have to move to the whole expression rather than to one branch of it.
    //
    // The wording above avoids spelling that construction out, and deliberately:
    // `browser-node-contract.node.test.ts` counts the constructor call as raw text across
    // this whole file, comments included, and requires zero. Its own comment says "zero
    // *constructions*, not zero mentions" — the intent is right and the instrument cannot
    // tell the two apart, so this file does not put the text where it would be counted.
    // The same rule `trust-anchors.node.test.ts` writes down for its own matchers.
    const counter = new CountingExecutor(guardSovereignty(provenance(worker), sovereignty))
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
      // DATA-05: the same guard `rpc` is built over, plus the local-only tier that
      // says which payloads are sovereign — so a sovereign task's input is guarded
      // for exactly as long as its reply frame takes to settle, and a dispatch that
      // declared nothing gives nothing back.
      egress: { guard: egress, sovereignInputs: store },
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
      // **Unmeasured on this factory, and that is the honest report.** The reason is
      // no longer the one that stood here — "needs a real `indexedDB` and a relay to
      // dial, so it runs in neither vitest project" was retired by
      // `start-unwind.browser.test.ts`, which starts this factory to success in three
      // engines. What is missing now is narrower and is the whole of it: nothing
      // drives a *refusal* through this hook, so the number this node would answer
      // an over-committed requestor with has never been read. The behaviour is proved
      // on `FabricNode` (`packages/node/src/admission.node.test.ts`) and only
      // *composed* here. A grep confirming this line does not stand in for running it
      // — that is exactly the substitution 13-VERIFICATION-2.md recorded the cost of.
      // WIRE-03, Phase 19 builds the harness that would measure it.
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
    this.worker.terminate()
    this.rpc.close()
    await this.transport.stop()
    await this.libp2p.stop()
    this.governor.stop()
    this.store.close()
  }
}
