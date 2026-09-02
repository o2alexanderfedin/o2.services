/**
 * The hosted tier's deployed entry point — the module wrangler builds and Cloudflare runs.
 *
 * ## Why this file is an entry point in the reachability sense, not just in wrangler's
 *
 * `packages/node/src/reachability.ts` walks the call graph from a list of **modules the
 * fabric is entered through**, and states the rule it applies: the three runnable modules it
 * leaves out are defensible because *"adding them changes no barrel verdict"*. That reading
 * is false for this file, which is the whole point of it — a deployed Worker is definitionally
 * a way the fabric is entered, and it is the only caller `@o2/cloudflare`'s barrel has. The
 * 2026-08-08 owner ruling that excluded `tools/aot/bench-lifted.ts` drew exactly this line:
 * that file is *"a benchmark driver, not a way the fabric is entered."* This one is the other
 * side of it.
 *
 * ## What it is allowed to answer, and why the list is this short
 *
 * `GET /self` and nothing else. Every route is a surface, and this tier's surfaces are not
 * this phase's subject — Phase 30 owns the inbound listener, Phase 31 the record store, Phase
 * 32 the relay. A route added here "while we are in the file" would be a capability shipped
 * without the phase that measures it, which is the shape `descoped is not satisfied` names.
 *
 * ## AMENDED 2026-09-02 BY PHASE 37 — the list is now `/self` and `/funnel`
 *
 * The sentence above was correct when it was written and it is kept rather than deleted,
 * because this repository retires a premise by dating it. What it forbids is a route added by
 * a phase that does not measure the capability; what it does not forbid is the phase that
 * does. **Phase 37 owns the connectivity funnel** — `RUN-04` and `RUN-05`, the six named
 * stages and the frozen telemetry schema — so `/funnel` is a surface shipped WITH the phase
 * that measures it, which is the case the original sentence was drawing a line against rather
 * than the case it was refusing.
 *
 * Two routes, `POST /funnel` and `GET /funnel`, and nothing else moves: `GET /self`'s response
 * shape is unchanged, `SERVED_BY` is still a constant, and no route anywhere derives an object
 * name from a request. The next phase that wants a route here is in the same position this one
 * was, and this block is not a licence it can cite.
 *
 * ## What it does NOT do — SUPERSEDED 2026-08-26 BY PHASE 30
 *
 * This block said the object *"does not upgrade a WebSocket"* and *"does not construct the
 * libp2p node"*, with a stated reason: until Phase 30's listener existed a running node could
 * not be dialled, and an uncalled `fabric()` method on the deployed class would have been the
 * *"wired is not used"* shape `CLAUDE.md` records being caught three times on the DHT. Both
 * are now false — {@link BootstrapObject.fetch} upgrades a socket and the node is built on the
 * first inbound connection and not before. The reading is kept rather than deleted because the
 * bundle measurements that went with it are what settled a question:
 *
 * With only `alarm()` reaching `hosted-libp2p.ts`, the emitted worker was **583.94 KiB** with
 * `noise` x43 while `kadDHT` and `circuitRelayServer` were **0**. That is what proved esbuild
 * shakes per SYMBOL and not per module — this block had predicted the opposite and the build
 * corrected it. With the listener wired the same build emits **1 867.80 KiB, 405.69 KiB
 * gzipped**, `kadDHT` x11 and `circuitRelayServer` x3.
 *
 * **`diffieHellman` and `node:crypto` are still 0 against that much larger subject.** So open
 * question 1's answer — wrangler honours the package's legacy top-level `browser` field and
 * bundles the pure-JS path — now rests on a bundle carrying the whole stack rather than a
 * corner of it, and `hosted-tier-deploy.node.test.ts`'s case reads it live.
 *
 * What the object still does NOT do is dial out, and Phase 29 criteria 1 and 2 remain owner
 * acts at the Cloudflare boundary.
 *
 */

// FOR ITS SIDE EFFECT, and it must be the FIRST import in this file.
//
// `workerd-shims.ts` installs the two globals js-libp2p cannot construct without and that
// workerd does not provide. It was written, tested and imported by NOTHING — measured on the
// emitted bundle 2026-08-27, `MinimalBroadcastChannel` appeared ZERO times — so the first
// inbound dial on the deployed node threw `ReferenceError: BroadcastChannel is not defined`,
// read out of `wrangler tail`. Its own specs passed throughout, because they call
// `installWorkerdShims` directly; a module that is correct and unreached is indistinguishable
// from one that is absent.
//
// A NAMED import would not do: nothing here calls into the module, so it would tree-shake away
// and reopen the gap with this file looking unchanged. FIRST, because ES modules evaluate in
// import order and `hosted-libp2p.ts` constructs the stack that needs these globals.
import './workerd-shims.ts'
import { HOSTED_OBJECT_NAMES, HostedNode, stubFor } from './hosted-object.ts'
import type { HostedObjectName, HostedObjectNamespace } from './hosted-object.ts'
import {
  HibernatableSockets,
  NoInboundUpgradeServiceError,
  acceptInboundSocket,
  isInboundUpgradeTarget,
} from './hibernatable-socket.ts'
import { RelayServiceLog, TrafficSplitCounter } from '@o2/libp2p'
import { announcedAddresses, createHostedFabric, hostedExpirySweep } from './hosted-libp2p.ts'
import { readRelayServiceJournal, writeRelayServiceJournal } from './relay-service-journal.ts'
import {
  ADMISSION_KEY_HEADER,
  authoriseWrite,
  narrowRegion,
  parseDirective,
  readDirective,
  refuseMisaddressed,
  writeDirective,
} from './admission-flag.ts'
import {
  accrueFunnelReport,
  emptyFunnelJournal,
  readFunnelJournal,
  writeFunnelJournal,
} from './funnel-journal.ts'
import { MAX_FUNNEL_BODY_BYTES, funnelDimensionsFrom } from './funnel-collector.ts'
import { parseFunnelReport } from '@o2/net'
import type { FunnelPopulation, FunnelTotals } from '@o2/net'
import type { HibernationCapableState } from './hibernatable-socket.ts'
import type { HostedFabric } from './hosted-libp2p.ts'
import type { CloudflareWebSocket } from './websocket-connection.ts'
import type { DurableObjectAlarms, DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * The two members of the platform's object state that this tier uses.
 *
 * Declared here rather than imported from `@cloudflare/workers-types`, on
 * `durable-object-storage.d.ts`'s stated discipline: an interface declared as narrowly as it
 * is used is one a fixture can implement completely, and a complete fake is the only kind
 * that can honestly claim to model the platform.
 */
export interface HostedObjectState {
  /**
   * Both halves of the platform's storage API, because this object uses both.
   *
   * The real `state.storage` carries them together; they are declared apart
   * (`durable-object-storage.d.ts`) so that `DoDatastore`'s fixture is not made to arm
   * alarms it never touches. An intersection here is what says this object needs both.
   */
  readonly storage: DurableObjectStorage & DurableObjectAlarms
}

/**
 * The object state, which carries the hibernation API beside the storage.
 *
 * `acceptWebSocket` and `getWebSockets` live on the state itself rather than on `state.storage`
 * — declared through {@link HibernationCapableState} so that the two-method slice has one
 * definition and the fixture that implements it completely is the same one the adapter's spec
 * uses.
 */
export interface HostedObjectStateWithSockets extends HostedObjectState, HibernationCapableState {}

/** The bindings this Worker is deployed with. One namespace, because there is one object. */
export interface HostedEnv {
  readonly BOOTSTRAP: HostedObjectNamespace<HostedStub>
  /**
   * Comma-separated multiaddrs this node announces, from `wrangler.jsonc`'s `vars`.
   *
   * **From the deployment and never from the request.** See `announcedAddresses` for why a
   * `Host` header cannot be the source, and `hostedLibp2pConfig` for what an unannounced relay
   * was measured doing — handing every client an empty reservation, silently.
   */
  readonly ANNOUNCE_MULTIADDRS?: string
  /**
   * The build this deployment is running, injected by `scripts/deploy-hosted.sh`.
   *
   * **Deliberately NOT in `wrangler.jsonc`, unlike the key above.** The repository has exactly
   * one version — the root `package.json`'s — and every second copy of a version is a copy that
   * drifts. The script reads that one and passes it as `--var O2_VERSION:<v>`; measured
   * 2026-08-27, `--var` MERGES with the file's `vars` rather than replacing them, so
   * `ANNOUNCE_MULTIADDRS` survives the injection. That mattered: replacement would have left the
   * relay announcing nothing, which consult §13 measured as handing every client an empty
   * reservation SILENTLY.
   *
   * Optional because a local `wrangler dev` injects nothing, and absence answers with a sentinel
   * rather than a missing field — see {@link BootstrapObject.fetch}. A LIVE deploy cannot leave
   * it absent: the script reads `/self` back and rolls the deploy back unless the version it
   * injected is the version that answers.
   */
  readonly O2_VERSION?: string
  /**
   * Which of the three objects this deployment is, from `--var O2_REGION:<name>`.
   *
   * **From the deployment and never from the request**, on `ANNOUNCE_MULTIADDRS`'s stated
   * model and for a sharper reason: the region is what a halt is addressed to, so a region
   * a caller could choose would be a slice a caller could escape. `SERVED_BY` already refuses
   * to take an object name from a query string for the same class of reason.
   *
   * Optional because a local `wrangler dev` injects nothing and because an object may be
   * deployed before Phase 33 sites it. An object with no label reports `region: null` and
   * refuses every region-addressed write — see `refuseMisaddressed`. A value outside the
   * closed set is treated as absent, with a log line, rather than silently accepted.
   */
  readonly O2_REGION?: string
  /**
   * The operator's key for `POST /admission`, from `wrangler secret put O2_ADMISSION_KEY`.
   *
   * **From the deployment and never from the request**, and never from `wrangler.jsonc` —
   * that file is tracked, and a key in it is a key in the history. A secret is the only
   * binding here that is not a `var` for exactly that reason.
   *
   * Optional, and absence **refuses every write** rather than admitting them. See
   * `authoriseWrite`: an object with no operator key has no operator, and the failure points
   * toward the fabric continuing to work rather than toward anyone being able to stop it.
   */
  readonly O2_ADMISSION_KEY?: string
}

/**
 * What `GET /self` reports when the deployment injected no version.
 *
 * A word, not an empty string and not an omitted field: a build that cannot name itself has to
 * say so in a form nothing can mistake for a release number. Semver has no such string, so a
 * reader comparing this against a tag gets an unmissable mismatch instead of a plausible one.
 */
const UNVERSIONED = 'unversioned'

/**
 * The two platform globals the upgrade path needs, declared as narrowly as it uses them.
 *
 * `WebSocketPair` is a constructor returning `{0: client, 1: server}`, and a 101 response
 * carries the client half in an init field no standard `ResponseInit` declares. Both exist only
 * in workerd, which is why they are declared here rather than imported and why the two lines
 * that touch them are the only ones in this package no spec can execute.
 */
interface WorkerdGlobals {
  WebSocketPair?: new () => Record<string, CloudflareWebSocket>
}

/** Thrown when this code is running somewhere that is not workerd. */
class NoWebSocketPairError extends Error {
  override readonly name: string = 'NoWebSocketPairError'

  constructor() {
    super(
      'WebSocketPair is absent from this global scope — the inbound listener is workerd-only ' +
        'and there is no portable substitute for it',
    )
  }
}

/**
 * `ResponseInit` plus the field workerd adds for a 101.
 *
 * Declared rather than asserted: the standard type has no `webSocket` member, and widening the
 * value with an assertion would hide the fact that this line depends on a platform extension.
 * A declaration says which extension, in one place a reader can check against the docs.
 */
interface UpgradeResponseInit extends ResponseInit {
  webSocket: CloudflareWebSocket
}

/** What a stub can be asked. `fetch` is the platform's own stub surface. */
export interface HostedStub {
  fetch: (request: Request) => Promise<Response>
}

/**
 * The deployed Durable Object.
 *
 * The class the platform instantiates; every claim worth asserting locally is on
 * {@link HostedNode}, which this holds rather than extends. That split is deliberate — a class
 * extending the platform's own base cannot be constructed in a Node test, so anything put
 * inside it would be unreachable by any spec, and unreachable code in a phase about guards is
 * the thing to avoid rather than the thing to explain.
 */
export class BootstrapObject {
  readonly #node: HostedNode
  readonly #state: HostedObjectStateWithSockets
  readonly #env: HostedEnv
  /**
   * The sockets this INSTANCE holds. Empty on a revived object, which is how a frame for a
   * session that did not survive is detected — see `hibernatable-socket.ts`.
   */
  readonly #sockets = new HibernatableSockets()
  /**
   * A value fixed at construction, so criterion 2's readings can see a construction boundary.
   *
   * **Without it the runbook's four readings cannot tell the case the criterion is about from
   * the case that proves nothing.** If the object was never evicted between two readings, the
   * PeerId is trivially identical — one live instance answered twice — and the evidence table
   * fills in completely having tested nothing. The default makes that the LIKELY outcome, not
   * an unlucky one: `@chainsafe/libp2p-yamux@8.0.1` defaults `keepAliveInterval: 30_000`
   * (`hibernatable-socket.ts:17-22`), so a held connection wakes this object every thirty
   * seconds and an object under a live connection does not hibernate at all.
   *
   * **Not the 1012 path, deliberately.** `HibernatableSockets` carries a stronger signal — a
   * frame on a socket this instance has no session for is closed with
   * `CLOSED_AFTER_HIBERNATION`, the connection itself reporting the discontinuity. It is not
   * used for this because whether workerd accepts 1012 as a close code is UNVERIFIED in that
   * file's own docblock (`:46-47`), and evidence resting on an unverified platform behaviour
   * is evidence the owner discovers is broken after the deploy that was to use it. This rests
   * on nothing platform-specific.
   *
   * **It says a construction happened, never why.** Eviction and redeploy are indistinguishable
   * here and are meant to be — what they have in common is the whole mechanism the criterion
   * rests on, which is why `hosted-identity.test.ts` tests the same boundary one level down.
   */
  readonly #instance = crypto.randomUUID()
  /**
   * NET-14's two counters, held by the OBJECT rather than by the fabric.
   *
   * The fabric is built lazily on the first inbound upgrade, and `GET /self` deliberately
   * does not build one — so a counter reachable only through the fabric would make reporting
   * the split either impossible before the first connection or expensive on every read.
   * Holding it here means the split is readable **from before the relay carries anything**,
   * which is criterion 3's ordering claim, and reads as two zeroed columns rather than as a
   * missing field.
   */
  readonly #traffic = new TrafficSplitCounter()
  /**
   * What this node has done as a relay — held beside the split, and for one reason more.
   *
   * The split's counters are **per-instance and hold no history**, which on 2026-08-30 made a
   * question about this very object unanswerable: *did a browser reserve on this relay, and
   * when?* An evicted instance answers as if nothing had. So this log is restored from the
   * object's own storage before it is read and banked back to it when a connection closes,
   * and `relay-service-journal.ts` refuses any write that would shorten the history.
   *
   * Held by the OBJECT rather than by the fabric for the reason `#traffic` is: `GET /self`
   * deliberately builds no libp2p node, and a log reachable only through the fabric could not
   * be reported before the first connection — which is precisely the window the question was
   * about.
   */
  readonly #relayLog = new RelayServiceLog()
  #relayRestored: Promise<RelayServiceLog> | undefined
  /** Memo for {@link BootstrapObject.regionOnce}. `undefined` is *not yet read*; `null` is *no region*. */
  #region: HostedObjectName | null | undefined
  /**
   * Whether storage already holds a `firstInboundHopStreamAt`.
   *
   * **This exists because banking only on close has a hole at exactly the boundary the
   * journal was built to survive.** The hibernation API's whole purpose is that the platform
   * evicts this object *while its sockets stay open* — that path never reaches
   * {@link webSocketClose}. So a browser could reserve, set the marker in memory, and have the
   * instance evicted with nothing written; the next frame arrives on a fresh object whose log
   * is empty, and the one datum the log exists for is gone. Worse, a reservation that is never
   * closed would never bank at all.
   *
   * A frame is therefore a banking opportunity — {@link webSocketMessage} is an async handler
   * the platform awaits — but writing on every frame would put a storage write on the hot
   * path. This flag makes it **one write, ever**: a boolean test per frame, and the write only
   * while the in-memory marker is one storage does not have.
   *
   * It says nothing about the four counters or the byte total, which still bank on close only.
   * Those are cumulative and a lost instance costs a partial count; the marker is a fact about
   * the past and losing it loses the answer.
   */
  #markerBanked = false
  /**
   * RUN-04's counters, held by the OBJECT rather than by the fabric.
   *
   * The reason `#traffic` and `#relayLog` are here applies unchanged: the fabric is built
   * lazily on the first inbound upgrade, and `GET /funnel` must answer before any libp2p node
   * exists — a funnel whose whole subject is visitors who never connected cannot be reachable
   * only through a connection.
   *
   * Held as the PROMISE, exactly as `#relayLogOnce` is, so two concurrent requests cannot each
   * restore from storage and then each bank a record built on the same starting point. That is
   * not a hypothetical here: a beacon arrives on page unload, and unloads arrive in bursts.
   */
  #funnelRestored: Promise<FunnelTotals> | undefined
  #fabric: Promise<HostedFabric> | undefined

  constructor(state: HostedObjectStateWithSockets, env: HostedEnv) {
    this.#state = state
    this.#env = env
    this.#node = new HostedNode(state.storage)
  }

  /**
   * The libp2p node, built on the first inbound upgrade and not before.
   *
   * A Durable Object is constructed for every request that reaches it, including `GET /self`,
   * which is answered out of storage alone. Building a network stack for those would be a cost
   * with no reader. Held as the PROMISE rather than the resolved value so that two concurrent
   * upgrades cannot each start one.
   */
  #fabricOnce(): Promise<HostedFabric> {
    this.#fabric ??= this.#relayLogOnce().then(async (relayLog) =>
      createHostedFabric({
        storage: this.#state.storage,
        alarms: this.#state.storage,
        announce: announcedAddresses(this.#env.ANNOUNCE_MULTIADDRS),
        traffic: this.#traffic,
        relayLog,
      }),
    )
    return this.#fabric
  }

  /**
   * The relay log with this object's stored history already in it.
   *
   * **The restore is awaited before the fabric is built, not alongside it.** A log that starts
   * observing before it has been restored is not wrong — `RelayServiceLog.restore` is additive
   * precisely so a late restore cannot lose an early observation — but it would be un-bankable
   * in the window between: `restored` is false, so a close arriving in that window would skip
   * the write. Ordering it first removes the window instead of tolerating it.
   *
   * Held as the PROMISE, like `#fabric`, so two concurrent requests cannot each restore and
   * double every stored total.
   */
  #relayLogOnce(): Promise<RelayServiceLog> {
    this.#relayRestored ??= readRelayServiceJournal(this.#node.store).then((banked) => {
      this.#relayLog.restore(banked)
      // Storage already has one, so the frame path has nothing to write.
      if (banked.firstInboundHopStreamAt !== undefined) this.#markerBanked = true
      return this.#relayLog
    })
    return this.#relayRestored
  }

  /**
   * Which region this object serves, narrowed against the closed set **exactly once**.
   *
   * A value outside `HOSTED_OBJECT_NAMES` becomes `null` and says so in the log. A deployment
   * that mistyped the label then has an object that reports `region: null` and refuses every
   * region-addressed write — loud, and recoverable by fixing the `--var`. Accepting the string
   * as written would give it a label that exists nowhere else: every read would look correct
   * and no write addressed to any real region would ever land, silently.
   *
   * Read lazily rather than at construction because a Durable Object is constructed for every
   * request that reaches it, and a log line per request for a deployment that is fine is noise.
   */
  #regionOnce(): HostedObjectName | null {
    if (this.#region === undefined) {
      const label = this.#env.O2_REGION
      this.#region = narrowRegion(label)
      if (label !== undefined && this.#region === null) {
        console.warn(
          `O2_REGION is ${JSON.stringify(label)}, which is not one of ` +
            `${HOSTED_OBJECT_NAMES.join(', ')} — this object reports no region and refuses ` +
            'every region-addressed write',
        )
      }
    }
    return this.#region
  }

  /**
   * Write the relay log back to storage, so it outlives this instance.
   *
   * **Skipped on an unrestored log, and the skip is a courtesy rather than the safeguard.**
   * What makes the dangerous case impossible is `writeRelayServiceJournal` refusing a total
   * lower than the stored one; this check just means the ordinary path — an alarm on a fresh
   * instance, which `alarm()` documents as the only kind an alarm ever fires on — does not
   * have to raise and catch to do nothing.
   */
  async #bankRelayLog(): Promise<void> {
    if (!this.#relayLog.restored) return
    const written = await writeRelayServiceJournal(this.#node.store, this.#relayLog.report())
    if (written.firstInboundHopStreamAt !== undefined) this.#markerBanked = true
  }

  /**
   * The banked funnel record, restored from this object's own storage.
   *
   * Held as the PROMISE for `#relayLogOnce`'s reason, one member up. The restored value is the
   * starting point every accrual is applied to, so a request that skipped the restore would
   * offer totals lower than the stored ones — which `writeFunnelJournal` refuses by name
   * rather than accepting as a truncation.
   */
  #funnelOnce(): Promise<FunnelTotals> {
    this.#funnelRestored ??= readFunnelJournal(this.#node.store, FUNNEL_POPULATION_PENDING_RULING)
    return this.#funnelRestored
  }

  /**
   * `GET /funnel` — the whole banked record, and criterion 1's *"readable while the fabric is
   * running"*.
   *
   * A fresh object answers six honest zeros, the population and the schema digest. Never a
   * missing field and never an estimate: `#traffic`'s own comment is the precedent — *"Two
   * zeroed columns is a reading; a missing field is not."*
   *
   * The digest travels with the counts so a reader can see the schema did not move between two
   * readings, which is `37-RUNBOOK.md` step 5's evidence and is the freeze's other half: the
   * suite catches a schema change in the tree, and this catches one between two deployments.
   */
  async #readFunnel(): Promise<Response> {
    const totals = await this.#funnelOnce()
    return Response.json(totals, { headers: FUNNEL_CORS_HEADERS })
  }

  /**
   * `POST /funnel` — one report from one visit, banked.
   *
   * **The body is read as text and parsed here, deliberately.** `navigator.sendBeacon` is the
   * only send that survives a page unloading, which is exactly when a `stalledAt` report has to
   * leave, and a beacon sent as `text/plain` is a CORS-safelisted request that needs no
   * preflight at all. Requiring `application/json` would make every beacon a preflighted
   * request, and a preflight cannot be sent from a page that is already unloading — the reports
   * this route exists for are precisely the ones that would be lost.
   *
   * A beacon reads no response, so nothing here can report a refusal to the sender. That is the
   * accepted cost and it is why the parse refuses rather than defaults: an unparseable body
   * stores nothing and answers 400 for the benefit of a `fetch` caller and a human with `curl`.
   */
  async #bankFunnel(request: Request): Promise<Response> {
    const body = await request.text()
    if (body.length > MAX_FUNNEL_BODY_BYTES) {
      return new Response('report too large', { status: 413, headers: FUNNEL_CORS_HEADERS })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return new Response('not a report', { status: 400, headers: FUNNEL_CORS_HEADERS })
    }
    const report = parseFunnelReport(parsed)
    if (report === null) {
      return new Response('not a report', { status: 400, headers: FUNNEL_CORS_HEADERS })
    }

    // The country comes off the REQUEST, never out of the body. A visitor cannot choose which
    // country their visit is filed under; see `funnel-collector.ts`.
    const dimensions = funnelDimensionsFrom(request)

    // **Accrue and bank are ONE link in the promise chain, and the ordering is the whole of
    // this method's correctness.** Written first as "accrue, set the memo, then write", which
    // is wrong twice. (1) A write that throws — a rollback refusal, a record past the ceiling —
    // left the memo holding counts that storage had refused, so `GET /funnel` reported numbers
    // the next eviction would erase, which is the exact failure the journal exists to prevent.
    // (2) Two reports arriving together both accrued from the same base, so the second offered
    // a total below what the first had banked, `writeFunnelJournal` refused it by name, and the
    // memo was then permanently below storage — **every later report on that instance refused,
    // until an eviction repaired it**. That is not a remote case: a terminal report leaves on
    // `pagehide`, and unloads arrive in bursts.
    //
    // Chaining off the previous promise serialises the reports and means the memo only ever
    // holds what storage confirmed. On a refusal it falls back to the state before the attempt.
    const attempt = this.#funnelOnce().then(async (totals) => {
      const banked = accrueFunnelReport(totals, report, dimensions)
      await writeFunnelJournal(this.#node.store, banked, FUNNEL_POPULATION_PENDING_RULING)
      return banked
    })
    // **On a refusal the memo becomes a fresh READ, not the base the attempt started from.** A
    // refusal is storage saying this instance's idea of the record is wrong — it is what an
    // alarm on a fresh instance, or any second writer, leaves behind. Falling back to the stale
    // base would keep `GET /funnel` under-reporting and would refuse every later report for the
    // same reason, so the instance would stay poisoned until an eviction repaired it. Re-reading
    // makes the refusal self-healing. If the re-read itself throws the store is malformed, which
    // is a genuine fault and stays one.
    this.#funnelRestored = attempt.catch(async () =>
      readFunnelJournal(this.#node.store, FUNNEL_POPULATION_PENDING_RULING),
    )
    try {
      await attempt
    } catch {
      // A beacon reads no response, so this status is for a `fetch` caller and for a human
      // with `curl`. What matters is that the report is dropped rather than half-applied.
      return new Response('the funnel refused this report', {
        status: 500,
        headers: FUNNEL_CORS_HEADERS,
      })
    }
    return new Response(null, { status: 204, headers: FUNNEL_CORS_HEADERS })
  }

  /**
   * True while this instance knows something storage does not, and it is the marker.
   *
   * See {@link #markerBanked} for why a frame is where this is asked. Read off `report()`
   * rather than kept as a second flag beside the log: two places recording the same fact are
   * two places that can disagree, and the log is the one that observes it.
   */
  #markerIsOnlyInMemory(): boolean {
    if (this.#markerBanked || !this.#relayLog.restored) return false
    return this.#relayLog.report().firstInboundHopStreamAt !== undefined
  }

  /**
   * A frame on an adopted socket — the hibernation API's delivery path.
   *
   * Adopted sockets do not carry event listeners; the platform calls this instead, which is
   * what makes them survive past the six minutes §17 measured a plain `accept()` socket being
   * aborted at.
   */
  async webSocketMessage(socket: CloudflareWebSocket, message: ArrayBuffer | string): Promise<void> {
    this.#sockets.message(socket, message)
    // The first frame after someone starts using this node as a relay is where the marker
    // becomes durable. One boolean per frame; one write for the life of the object. Without
    // it a reservation on a socket that is hibernated rather than closed is observed and then
    // lost — see `#markerBanked`.
    if (this.#markerIsOnlyInMemory()) await this.#bankRelayLog()
  }

  /**
   * A socket closing — and the moment the relay log is durable again.
   *
   * Banked here rather than from inside the log's own close handling: this is an **async
   * handler the platform awaits**, so a storage write started here completes, whereas one
   * started from a synchronous listener inside `RelayServiceLog` would race the isolate being
   * torn down. It is also the last point at which anything is guaranteed to run — an evicted
   * object gets no notice at all.
   */
  async webSocketClose(socket: CloudflareWebSocket): Promise<void> {
    this.#sockets.close(socket)
    await this.#bankRelayLog()
  }

  async webSocketError(socket: CloudflareWebSocket, error: unknown): Promise<void> {
    this.#sockets.error(socket, error instanceof Error ? error : new Error(String(error)))
  }

  /**
   * The Durable Object alarm — ARCHITECTURE step 7 arriving on the platform's own timer.
   *
   * **Nothing is memoised across this call and that is the design.** Cloudflare evicts the
   * instance that armed an alarm and constructs a fresh one to handle it, so an
   * `ExpirySweep` captured at assembly time would be gone by the time it was needed.
   * `hostedExpirySweep` arms from nothing on every call, which makes the schedule
   * self-repairing rather than dependent on a construction that happened once.
   *
   * It does **not** construct libp2p. Sweeping needs a datastore, an alarm surface and this
   * node's own peer id; waking a network stack to delete expired rows would make the
   * cheapest thing this object does the most expensive one.
   *
   * That an alarm survives eviction and fires on a fresh instance is the one claim here no
   * local run settles — ARCHITECTURE's *"request, fire, evict, re-read from a new
   * instance"* is an owner act at the Cloudflare boundary and is reported open.
   */
  async alarm(): Promise<void> {
    const sweep = await hostedExpirySweep({
      storage: this.#state.storage,
      alarms: this.#state.storage,
    })
    await sweep.run()
  }

  /**
   * `GET /self` — the node's own stable name.
   *
   * This is the reading criterion 2 is settled by: an owner dialling the deployed object
   * twice, days apart and across an eviction, must see one PeerId. The value returned here
   * comes from the seed in this object's storage, so the answer is the store's and not the
   * isolate's — which is the whole difference between a Durable Object and the plain Worker
   * that returned three different PeerIds to three consecutive requests.
   *
   * **Four fields, and the third is what makes the first one mean anything.** `instance` is
   * fixed at construction, so two readings carrying one `peerId` and two `instance` values are
   * an identity that crossed a construction boundary, while two readings carrying one of each
   * are the same live object answering twice — which the criterion is not about. See
   * `#instance`. It is a field on the one route this object serves and **not a second route**:
   * every route is a surface, and this tier's surfaces are not.
   *
   * **The fourth, `version`, is the deployment's and not the store's** — which is exactly the
   * axis `peerId` is not. `instance` says a construction happened and never why; `version` says
   * which build the construction was of, so a redeploy and an eviction stop being
   * indistinguishable to a reader who has both. It also closes the gap that prompted it: before
   * this field, nothing anywhere read the release tag and a running node could not be asked what
   * it was built from.
   *
   * `/self` alone still does not satisfy criterion 2, which says *dials, completes identify,
   * and gets the same PeerId* — three things, and only an outside dial carries the middle one.
   */
  /**
   * `POST /admission` — the operator writes this object's directive.
   *
   * ## Why this tier grew a second route, enumerated
   *
   * `GET /self`'s docblock states this file's default in its own words: *"It is a field on the
   * one route this object serves and **not a second route**: every route is a surface, and this
   * tier's surfaces are not."* That default is right and this route owes it an argument. Three
   * reasons, none of them taste:
   *
   * 1. **`wrangler` has no surface that writes Durable Object storage remotely.** There is no
   *    command that reaches into a deployed object and sets a value. The write has to arrive as
   *    a request, because a request is the only thing that reaches a Durable Object at all.
   * 2. **A write cannot be a field on a `GET`.** The directive is read on `/self` as a field,
   *    which is the pattern; setting it is not a reading and cannot be one.
   * 3. **Carrying it over libp2p would cost far more surface than it saved.** It would make the
   *    operator a peer, and need a new protocol, a key-distribution story and a signed record —
   *    for one boolean. One authenticated route is the smaller surface, not the larger one.
   *
   * ## No CORS header on this route, anywhere, including the refusals
   *
   * `GET /self` answers `Access-Control-Allow-Origin: *` because its body is already public and
   * the tab that reads it is on another origin by construction. This route answers **no** CORS
   * header at all — so a cross-origin page sending a bespoke header and a JSON body triggers a
   * preflight, the preflight is unanswered, and the browser blocks the request **before the key
   * check runs**. No page on any origin can reach this surface.
   *
   * **That is a second line and not the boundary.** The boundary is the key, which is what a
   * `curl`, a script or a harness meets — none of them is a browser and none of them is
   * preflighted. Adding `Access-Control-Allow-Origin` here would remove the outer line while
   * leaving the real one standing; it would also be the change somebody makes to "fix" a
   * blocked fetch in a console. Both readings are taken separately in
   * `kill-switch-volunteer.e2e.test.ts`, labelled with what each proves, because they are not
   * substitutes for one another.
   *
   * ## The order of the two checks, and why the region one is first
   *
   * The key is checked first, then the region. A request that presents no key learns nothing
   * about which region this object serves — the refusal it gets names no label. Reversing them
   * would turn this route into an unauthenticated way to enumerate the fabric's siting.
   */
  async #writeAdmission(request: Request): Promise<Response> {
    const authorisation = authoriseWrite({
      configuredKey: this.#env.O2_ADMISSION_KEY,
      presentedKey: request.headers.get(ADMISSION_KEY_HEADER),
    })
    if (!authorisation.allowed) {
      return new Response(authorisation.reason, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response('not a directive', { status: 400 })
    }
    const directive = parseDirective(body)
    if (directive === null) {
      return new Response('not a directive', { status: 400 })
    }

    const refusal = refuseMisaddressed(directive, this.#regionOnce())
    if (refusal !== null) {
      return new Response(refusal.reason, { status: 409 })
    }

    return Response.json(await writeDirective(this.#node.store, directive))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') return this.#upgrade(request)
    const path = new URL(request.url).pathname
    // RUN-04's two routes. See the AMENDED block in this file's header for why the route list
    // opened here and why that is not a licence the next phase can cite.
    if (path === '/funnel') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: FUNNEL_CORS_HEADERS })
      }
      if (request.method === 'POST') return this.#bankFunnel(request)
      if (request.method === 'GET') return this.#readFunnel()
      return new Response('method not allowed', { status: 405, headers: FUNNEL_CORS_HEADERS })
    }
    // RUN-02's ONE write surface. See `#writeAdmission` for why this tier grew a route at
    // all, enumerated rather than asserted, and why nothing under it carries a CORS header.
    if (path === '/admission') {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 })
      }
      return this.#writeAdmission(request)
    }
    if (path !== '/self') {
      return new Response('not found', { status: 404 })
    }
    const identity = await this.#node.identity()
    // Restored before it is reported, so the answer is this NODE's history and not this
    // instance's. That difference is the whole of why the log exists.
    const relayLog = await this.#relayLogOnce()
    return Response.json({
      peerId: identity.peerId,
      nodeKey: identity.nodeKey,
      instance: this.#instance,
      version: this.#env.O2_VERSION ?? UNVERSIONED,
      // NET-14 — the peer-to-peer / relayed split, reported as a FIELD on the one route this
      // object serves and not as a second one, for the reason `instance` is a field: every
      // route is a surface, and this tier's surfaces are not. `version` is the precedent.
      //
      // **Reporting starts before the relay carries anything**, which is the ordering
      // criterion 3 is about rather than a dashboard added later. Two zeroed columns is a
      // reading; a missing field is not.
      traffic: this.#traffic.report(),
      // What this node has done as a relay — a THIRD reading beside the split's two columns,
      // never folded into them. `traffic.direct.bytes` already contains the payload this
      // relay forwards, because the connection to a reserving peer is itself direct; the
      // figure here counts that same payload at a different question. Reporting them side by
      // side is honest, and subtracting one from the other is not arithmetic that means
      // anything — see `relay-service-log.ts`.
      //
      // Unlike `traffic`, this one **survives eviction**, which is what lets a reader ask
      // when this relay first carried someone rather than only whether it is carrying anyone
      // now.
      relayService: relayLog.report(),
      // RUN-02 — whether this object is telling its region's tabs to stop, and which slice
      // of them. A FIELD on the one route this object serves, for the reason `instance`,
      // `version`, `traffic` and `relayService` are fields: every route is a surface. The
      // *write* could not be a field on a `GET`, which is why this phase adds a route and
      // owes that an argument — it is written at `#writeAdmission`, enumerated.
      //
      // Reported from before anything is stored, as `ADMITTING` with this object's own
      // region label. A missing field would make "nobody has been told to stop" and "this
      // object does not know about halts" the same reading.
      admission: await readDirective(this.#node.store, this.#regionOnce()),
    }, { headers: SELF_CORS_HEADERS })
  }

  /**
   * The inbound listener — Phase 30.
   *
   * Everything that decides anything is in `acceptInboundSocket`: the `CF-Connecting-IP`
   * refusal, the adoption through the hibernation API, and the upgrade that must not be
   * awaited. What is left here is constructing the pair and returning the 101.
   *
   * **CORRECTED 2026-08-30 — this docblock said the pair and the 101 are "the two untestable
   * lines… which no local run can execute". Both halves are false, and the correction is the
   * whole of Phase 30's testability.** `wrangler dev` runs the real workerd runtime locally
   * with no account and `CLOUDFLARE_API_TOKEN` blanked: it creates a genuine Durable Object,
   * `WebSocketPair` — the global said to be unreachable — is present, and a raw upgrade
   * request is answered `HTTP/1.1 101 Switching Protocols` with an RFC 6455 accept value that
   * verifies. The claim was reasonable when written, because nothing in the `node` lane can
   * construct a `WebSocketPair` and the deployed object was the only workerd anyone had
   * reached; what it missed is that a local workerd is still workerd. Measured by
   * `inbound-listener.e2e.test.ts`, which drives eight concurrent distinct clients through
   * exactly these lines.
   */
  async #upgrade(request: Request): Promise<Response> {
    const fabric = await this.#fabricOnce()
    // The member is declared optional so that the scope narrows in one step, which is the
    // shape `workerd-shims.ts` uses for `globalThis` and the reason it needs no double cast.
    const { WebSocketPair } = globalThis as WorkerdGlobals
    if (WebSocketPair === undefined) throw new NoWebSocketPairError()
    const pair = new WebSocketPair()
    const client = pair['0']
    const server = pair['1']
    if (client === undefined || server === undefined) {
      return new Response('the platform returned no socket pair', { status: 500 })
    }

    const upgrade = fabric.libp2p.services['inbound']
    if (!isInboundUpgradeTarget(upgrade)) throw new NoInboundUpgradeServiceError()

    acceptInboundSocket({
      sockets: this.#sockets,
      state: this.#state,
      socket: server,
      request,
      upgrade,
      log: fabric.libp2p.logger.forComponent('o2:cloudflare:inbound'),
    })

    // 101, with the client half handed back through an init field only workerd declares.
    const init: UpgradeResponseInit = { status: 101, webSocket: client }
    return new Response(null, init)
  }
}

/**
 * The population the funnel's counts are over WHILE THE RULING IS PENDING.
 *
 * `.planning/REQUIREMENTS.md` § Open questions item 3 — consent versus legitimate interest —
 * is **contested across sources and is settled by legal review, not by engineering judgement**.
 * Until it is settled the reporter is armed at consent, so the counts reaching this object are
 * over visitors who turned the report on and nobody else.
 *
 * `'opted-in-only'` is not a choice between the two readings — it is their **intersection**.
 * The consent reading permits only consent-armed collection; the legitimate-interest reading
 * permits consent-armed collection *and* page-load-armed collection. So this value is lawful
 * under either ruling, and a ruling can only ever widen it. Collecting under the wrong basis is
 * the irreversible error; not collecting yet is the reversible one.
 *
 * It is stored beside the counts and echoed in every read because **a count whose population is
 * not on the same page as the count is a count that will be quoted wrong** — under this value
 * the funnel measures a self-selected subset, so stage one equals stage two by construction and
 * the first drop-off is not measurable at all.
 */
const FUNNEL_POPULATION_PENDING_RULING: FunnelPopulation = 'opted-in-only'

/**
 * What `/funnel` answers a cross-origin caller.
 *
 * **The demo page is served from a different origin from this Worker in every arrangement that
 * will ever exist** — a Vite dev server locally, GitHub Pages in production — so this is not
 * decoration, it is whether the route works at all.
 *
 * `*` rather than a named origin, and the reason is that a narrower value here would be
 * security theatre rather than security. The endpoint is a public, unauthenticated counter that
 * accepts anonymous integers: there is no credential to protect, `Access-Control-Allow-
 * Credentials` is deliberately absent, and an origin allow-list would be trivially bypassed by
 * anything that is not a browser while breaking the one arrangement this project actually needs
 * — a static page on one origin reporting to a Worker on another. `start-report.ts` records the
 * same acceptance for the same reason: *"Counts are unauthenticated: a peer can inflate its
 * own."* What that costs is written beside the figures rather than mitigated here.
 *
 * The preflight headers are answered anyway, even though the reporter's own send is a
 * CORS-safelisted `text/plain` beacon that needs no preflight. A `fetch` caller — a harness, a
 * human with `curl`, an operator reading the counts from a dashboard on another origin — is
 * preflighted, and refusing them would make the route unreadable from anywhere but this Worker.
 */
/**
 * What `GET /self` answers so a page on another origin can read it.
 *
 * **Origin `*`, and the body is why that costs nothing.** `/self` carries `peerId`, `nodeKey`,
 * `instance`, `version`, `traffic`, `relayService` and `admission` — every one of which a node
 * that announces itself already publishes, and none of which is a secret this header would be
 * protecting. The tab that needs it is on another origin *by construction*: the client is a
 * static page and the object is a Worker, and they cannot share one.
 *
 * Only `GET` and `OPTIONS`, and no `Access-Control-Allow-Headers` for the admission key —
 * `POST /admission` is deliberately not reachable from any page, and listing its header here
 * would be the first half of making it so.
 */
const SELF_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const FUNNEL_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-O2-Network-Class',
  'Access-Control-Max-Age': '86400',
}

/**
 * Which object a request is served by.
 *
 * **A constant, never derived from the request.** Criterion 6's subject is precisely that a
 * visitor cannot cause an object to be created, and an object is created by its first `get()`.
 * A `?region=` parameter here would be the defect, and it would be invisible: the request
 * would succeed, the object would exist, and its siting would be permanent.
 *
 * Choosing which of the three regions a given request belongs to is Phase 33's subject and is
 * not answered by taking the visitor's word for it.
 */
const SERVED_BY: HostedObjectName = 'bootstrap-us'

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    return stubFor(env.BOOTSTRAP, SERVED_BY).fetch(request)
  },
}
