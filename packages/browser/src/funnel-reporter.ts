/**
 * The six stages, instrumented on the visitor's side — RUN-04.
 *
 * ## Why this goes over plain HTTP and not over the fabric
 *
 * `BROW-02` already gossips a coarse start outcome peer to peer, and `@o2/net`'s
 * `start-report.ts` says in its own header why that channel cannot carry a funnel: *"A node
 * blocked from starting usually cannot reach a peer, and a node that cannot reach a peer cannot
 * say so."* A measurement whose entire subject is **where visitors fall out** must not ride the
 * channel that falls out with them — the reports it would lose are exactly the ones it exists
 * to take. So this sends over HTTP, and the terminal report goes by `navigator.sendBeacon`,
 * which is the only send that survives a page unloading.
 *
 * ## THE ENDPOINT HAS NO DEFAULT AND NO LITERAL, AND THAT IS A SCOPE FENCE
 *
 * If this module ever *defaulted* its endpoint to a deployed collector, then every end-to-end
 * run in this repository would post to the owner's live Durable Object — money spent and a
 * store polluted, by a test suite. So the endpoint is never written down here: it is either
 * **configured** by `?funnel=` on the URL, or **derived from the relay this visit started
 * with**, and with neither the reporter is **inert** and every method is a no-op returning
 * `false`. `funnel-reporter.node.test.ts` reads this file's own source and asserts it carries
 * no origin literal — not even a scheme joined to a host — so the rule is mechanical rather
 * than remembered. That is why {@link funnelEndpointFromRelay} assembles its scheme from a
 * variable instead of writing one.
 *
 * **AMENDED 2026-09-03, and the amendment is why the derivation exists.** Until then the only
 * route was `?funnel=`, and the bare link is the one that circulates in a group chat. The
 * deployed relay recorded 6 615 inbound hop streams and 1 298 080 bytes on the first real run
 * — browsers that really connected — and the funnel recorded **zero on all six stages**. The
 * fence was not wrong; it was resting on the absence of a branch, and an absent branch cannot
 * tell a test arrangement apart from a published page. It now rests on the relay instead, which
 * is the same fence held by construction: a local relay derives a local target, so a test run
 * still cannot reach anything anybody pays for.
 *
 * ## Ports, not globals
 *
 * A send port and a clock port, in `consent.ts`'s shape and for its stated reason: *"a module
 * that reads browser globals when it is loaded cannot be imported by a Node test at all."*
 * Nothing here touches a global at import time, which is what lets the behavioural cases run in
 * the `node` lane and the browser lane from one file.
 *
 * ## What is held in memory, and why that is not a cross-session identifier
 *
 * A visit's already-sent set and its furthest stage live in module-free instance state. They
 * die with the tab. Nothing is written to storage, nothing is sent that could join two visits,
 * and the collector adds no key per visit either — `funnel-collector.e2e.test.ts` reads that
 * second half against the store.
 *
 * ## The arming point is one value, and it is the intersection of two legal readings
 *
 * See {@link FUNNEL_ARMING}.
 */

// The relay address is parsed with the library rather than by hand: `@multiformats/multiaddr`
// is already a dependency of this package and is already imported by `browser-node.ts`, and it
// is what knows that the legacy `/wss` shorthand and the modern `/tls/ws` pair mean one thing.
import { multiaddr } from '@multiformats/multiaddr'
import { FUNNEL_STAGES } from '@o2/net'
import type {
  FunnelConnectionClass,
  FunnelNetworkClass,
  FunnelPopulation,
  FunnelReport,
  FunnelStage,
} from '@o2/net'

/**
 * When the reporter starts counting.
 *
 * **`'at-consent'` while `.planning/REQUIREMENTS.md` § Open questions item 3 is pending, and
 * that is NOT a choice between the two readings — it is their intersection.** The consent
 * reading permits only consent-armed collection; the legitimate-interest reading permits
 * consent-armed collection *and* page-load-armed collection. So this value is lawful under
 * either ruling and a ruling can only ever widen it. Collecting under the wrong basis is the
 * irreversible error; not collecting yet is the reversible one.
 *
 * The question is settled by legal review and not by engineering judgement, and nothing in this
 * repository states a basis — `disclosure-four-elements.node.test.ts` holds an absence guard
 * that says so.
 *
 * **What it costs, which is real and must be published beside any figure taken under it:** the
 * funnel measures a **self-selected opted-in subset**. Stage one is sent at the same moment as
 * stage two, so their counts are equal by construction and the first drop-off — how many
 * visitors arrive and never consent — is not measurable at all.
 */
export const FUNNEL_ARMING: 'at-consent' | 'at-page-load' = 'at-consent'

/** Which visitors the counts are over, under {@link FUNNEL_ARMING}. */
export const FUNNEL_PENDING_POPULATION: FunnelPopulation = 'opted-in-only'

/** Where a report goes. `send` answers whether the platform accepted it for delivery. */
export interface FunnelSendPort {
  send(body: string): boolean
}

/** The clock, as narrowly as this module needs one: an hour of the day, in UTC. */
export interface FunnelClockPort {
  /** An integer 0-23. An hour is not a timestamp and this port cannot supply one. */
  hourBucket(): number
}

/** How a reporter is built. Every field absent means an inert reporter. */
export interface FunnelReporterOptions {
  /**
   * Absent means inert. There is no default and there must not be one.
   *
   * Absent is also **not final**: {@link FunnelReporter.target} installs one later, for a page
   * that learns where its collector is only after it has learned its relay.
   */
  readonly send?: FunnelSendPort
  readonly clock?: FunnelClockPort
  /** The device's own coarse reading of its connection. */
  readonly networkClass?: FunnelNetworkClass
  readonly population?: FunnelPopulation
}

/** The stage a visit that got all the way through has reached. No terminal report follows it. */
const COMPLETED_STAGE: FunnelStage = 'first-task'

/**
 * One visit's progress through the six stages.
 *
 * Every method answers whether anything was sent, so a caller can tell "inert" from "sent" from
 * "already sent" without reading state back off the object.
 */
export class FunnelReporter {
  /**
   * Not `readonly`: {@link target} installs one late. See that method for why a page cannot
   * always know where its collector is at the moment this object is built.
   */
  #send: FunnelSendPort | null
  readonly #clock: FunnelClockPort | null
  readonly #networkClass: FunnelNetworkClass
  readonly #population: FunnelPopulation
  /** Stages already reported this visit. In memory only; it dies with the tab. */
  readonly #sent = new Set<FunnelStage>()
  /** Reports composed before arming, held so their hour is the hour they happened. */
  readonly #held: FunnelReport[] = []
  #armed: boolean
  #furthest: FunnelStage | null = null
  #terminalSent = false

  constructor(options: FunnelReporterOptions = {}) {
    this.#send = options.send ?? null
    this.#clock = options.clock ?? null
    this.#networkClass = options.networkClass ?? 'unknown'
    this.#population = options.population ?? FUNNEL_PENDING_POPULATION
    // Armed from the start only under the reading that permits it. Under the pending default
    // the reporter holds until `arm()` — see `FUNNEL_ARMING`.
    this.#armed = FUNNEL_ARMING === 'at-page-load'
  }

  /**
   * True when this reporter can send anything at all.
   *
   * A reporter built with no send port is inert, and stays inert until {@link target} supplies
   * one — so on a page with neither a `?funnel=` parameter nor a derivable relay this is `false`
   * for the whole visit. Exposed so a caller can log the state rather than infer it from a
   * `false` that could equally mean "already sent".
   */
  get active(): boolean {
    return this.#send !== null && this.#clock !== null
  }

  /** The furthest stage this visit reached, or `null`. In memory only. */
  get furthest(): FunnelStage | null {
    return this.#furthest
  }

  /**
   * Start sending, and flush anything held.
   *
   * **The held reports keep the hour they happened**, not the hour they were flushed. A visitor
   * who opens the page at 23:58 and consents at 00:01 belongs to hour 23 for stage one, and
   * filing them under hour 0 would put a smear into the one question the hour bucket exists to
   * answer.
   *
   * **Arming with no send port does not discard the hold, and that is the repair of 2026-09-03.**
   * The demo arms at consent and only learns its relay when it starts, so an arm that flushed
   * into a null port would drop stages one and two — the two stages a funnel most needs — and
   * would do it invisibly. They stay held until {@link target}, still carrying the hour they
   * happened.
   */
  arm(): boolean {
    if (this.#armed) return false
    this.#armed = true
    return this.#flush()
  }

  /**
   * Install the send port, once, for a page that could not know one when it was constructed.
   *
   * **This moves WHERE an already-consented report goes. It does not move WHETHER one is made.**
   * A visit that has not armed sends nothing when this is called: the hold is released by the
   * conjunction of armed *and* targeted, in either order, and never by this call alone.
   *
   * First install wins, which is where the precedence in {@link funnelEndpointFrom} is enforced
   * a second time at the wiring: a page that named `?funnel=` already holds a port, so a later
   * relay-derived call is a no-op rather than a redirection.
   *
   * Answers whether anything was flushed by it.
   */
  target(send: FunnelSendPort): boolean {
    if (this.#send !== null) return false
    this.#send = send
    return this.#flush()
  }

  /**
   * Record that this visit reached a stage. At most once per stage per visit.
   *
   * Re-entering a stage sends nothing: a stage that double-counts makes every ratio in the
   * funnel wrong in a way no reader of the numbers can see.
   */
  enter(stage: FunnelStage, connectionClass?: FunnelConnectionClass): boolean {
    if (this.#sent.has(stage)) return false
    this.#sent.add(stage)
    if (this.#isFurther(stage)) this.#furthest = stage
    return this.#offer({
      stage,
      kind: 'entered',
      hourBucket: this.#hour(),
      population: this.#population,
      networkClass: this.#networkClass,
      ...(connectionClass === undefined ? {} : { connectionClass }),
    })
  }

  /**
   * The terminal report — where this visit stopped.
   *
   * Called from `pagehide`. Sends nothing if the visit reached {@link COMPLETED_STAGE}, because
   * a visit that finished did not stall; sends nothing if it never reached a stage at all; and
   * sends at most once, because `pagehide` can fire more than once for one visit.
   */
  stalled(): boolean {
    if (this.#terminalSent) return false
    const at = this.#furthest
    if (at === null || at === COMPLETED_STAGE) return false
    this.#terminalSent = true
    return this.#offer({
      stage: at,
      kind: 'stalled',
      hourBucket: this.#hour(),
      population: this.#population,
      networkClass: this.#networkClass,
    })
  }

  #isFurther(stage: FunnelStage): boolean {
    if (this.#furthest === null) return true
    return FUNNEL_STAGES.indexOf(stage) > FUNNEL_STAGES.indexOf(this.#furthest)
  }

  #hour(): number {
    return this.#clock?.hourBucket() ?? 0
  }

  /**
   * Send it, or hold it until this reporter is both armed and targeted.
   *
   * The hold is bounded by construction and needs no eviction: `enter` is once-per-stage and
   * `stalled` is once-per-visit, so at most seven reports can ever be in it.
   */
  #offer(report: FunnelReport): boolean {
    if (!this.#armed || this.#send === null) {
      this.#held.push(report)
      return false
    }
    return this.#post(report)
  }

  /** Release the hold, in composition order, if both conditions are now met. */
  #flush(): boolean {
    if (!this.#armed || this.#send === null) return false
    let flushed = false
    for (const report of this.#held.splice(0)) flushed = this.#post(report) || flushed
    return flushed
  }

  #post(report: FunnelReport): boolean {
    const send = this.#send
    if (send === null) return false
    return send.send(JSON.stringify(report))
  }
}

/**
 * Where the collector is: the page's own URL first, then the relay this visit started with.
 *
 * ## Precedence, in one sentence
 *
 * An explicit `?funnel=` wins; otherwise the first relay address that yields an origin wins;
 * otherwise `null`, and the reporter is inert exactly as before.
 *
 * ## THE FENCE IS NOT REMOVED — IT IS RE-FOUNDED, AND THAT COST A REAL RUN
 *
 * This function used to end at the first paragraph, and said so: *"there is no default and no
 * fallback, which is the scope fence in one function"*. **The fence was right and its
 * foundation was not.** It rested on the ABSENCE of a branch, and an absence cannot tell a
 * test arrangement apart from a published page — it only ever answers `null` to both. What
 * that cost is measured: on the first real run, from a link posted to a group chat, the
 * deployed relay recorded 6 615 inbound hop streams and 1 298 080 bytes, and the funnel
 * recorded **zero on every one of its six stages**. The link that circulates is the bare one,
 * so the reporter was inert for the entire run and the milestone's headline number was never
 * taken.
 *
 * The fence now rests on the relay, which holds it **by construction rather than by a missing
 * branch**: a test arrangement bootstraps off a local relay, so the derived target is local and
 * nothing anybody pays for is reachable from it; a published page bootstraps off the deployed
 * node, so the target is that node. There is still no literal origin in this file and there
 * must never be one, and there is still no fall back to the page's own origin — a relative
 * value would resolve against whatever static host served the page, which is a wrong
 * destination that would look like a working configuration.
 *
 * @param search the page's query string, e.g. `location.search`
 * @param relayAddrs the relay multiaddrs this visit actually started with, in order
 */
export function funnelEndpointFrom(
  search: string,
  relayAddrs: readonly string[] = [],
): string | null {
  let configured: string | null
  try {
    configured = new URLSearchParams(search).get('funnel')
  } catch {
    return null
  }
  if (configured !== null && configured !== '') {
    try {
      const url = new URL(configured)
      // Path and query are dropped: what is configured is an ORIGIN, and the route below it is
      // this project's to name rather than a caller's.
      return `${url.origin}/funnel`
    } catch {
      // A configured value that will not parse is refused rather than falling through to the
      // relay. Somebody named a destination and got it wrong; silently sending somewhere else
      // would hide the mistake behind a working funnel.
      return null
    }
  }
  for (const addr of relayAddrs) {
    const derived = funnelEndpointFromRelay(addr)
    if (derived !== null) return derived
  }
  return null
}

/**
 * The collector's origin, derived from the address of the relay a tab bootstrapped through.
 *
 * The relay is the one host this visit is already talking to and the one host this project
 * deploys, so it is the only thing on a bare page that names the right destination without a
 * literal being written down. What it derives:
 *
 * - `/dns4/<host>/tcp/443/tls/ws/...` -> `https://<host>/funnel`
 * - `/dns6/...` and `/dnsaddr/...` likewise, and the legacy `/wss` shorthand is the same thing
 * - a TLS port that is not 443 is kept: `https://<host>:<port>/funnel`
 * - `/ip4/127.0.0.1/tcp/8796/ws/...` -> `http://127.0.0.1:8796/funnel`
 * - anything else, including a `/p2p-circuit` address, an address with no websocket component
 *   and an address that will not parse at all -> `null`. It does not guess.
 *
 * **The insecure scheme is reachable only from an insecure relay, and that is the whole reason
 * it exists.** A plain `/ws` relay is what a test arrangement has — a loopback listener with no
 * certificate — and a published page cannot reach one anyway, because a browser on an HTTPS
 * page refuses mixed content. So `http` here is not a weakening of the deployed path; it is the
 * only scheme a local relay can answer on, and deriving it is what lets a test assert this
 * function's behaviour against something it can actually run.
 *
 * The scheme is assembled from a variable rather than written as a literal so that this module
 * still carries no `scheme://host` text of any kind — `funnel-reporter.node.test.ts` scans for
 * exactly that, and a derived origin must not weaken a scan that exists to keep a default out.
 */
export function funnelEndpointFromRelay(relayAddr: string): string | null {
  let components: { readonly name: string; readonly value?: string }[]
  try {
    components = multiaddr(relayAddr).getComponents()
  } catch {
    return null
  }
  let host: string | null = null
  let port: string | null = null
  let websocket = false
  let secure = false
  for (const { name, value } of components) {
    // A circuit address names the relay AND a peer behind it, so its host is not the host that
    // serves anything. Refused outright rather than read for its first hop.
    if (name === 'p2p-circuit') return null
    if (name === 'dns4' || name === 'dns6' || name === 'dnsaddr' || name === 'ip4') {
      host = value ?? null
    } else if (name === 'tcp') {
      port = value ?? null
    } else if (name === 'wss') {
      // The legacy shorthand: one component meaning both of the two below.
      websocket = true
      secure = true
    } else if (name === 'tls') {
      secure = true
    } else if (name === 'ws') {
      websocket = true
    }
  }
  // A websocket component is required rather than assumed. `/ip4/1.2.3.4/tcp/4001` is a peer
  // this browser cannot dial and a host nothing says serves HTTP, and `/udp/.../webrtc-direct`
  // names a UDP port that is not an HTTP one. Both answer `null` by this test and not by a
  // special case.
  if (host === null || host === '' || port === null || !websocket) return null
  const scheme = secure ? 'https' : 'http'
  try {
    // Through `URL` rather than string-joined, for two reasons in one line: it rejects a host
    // that is not one, and its `origin` drops a port that is the scheme's default — which is
    // what makes 443 disappear and 8443 stay without either being written here.
    return `${new URL(`${scheme}://${host}:${port}`).origin}/funnel`
  } catch {
    return null
  }
}

/**
 * A send port over `navigator.sendBeacon`, falling back to `fetch` with `keepalive`.
 *
 * **`text/plain`, and that is load-bearing rather than lazy.** It is a CORS-safelisted content
 * type, so the request needs no preflight — and a preflight cannot be sent from a page that is
 * already unloading, which is exactly when the terminal report has to leave. `worker.ts`'s
 * `#bankFunnel` reads the body as text for the same reason and says so.
 *
 * The fallback exists because `sendBeacon` is absent in some embedded contexts and returns
 * `false` when the browser's queue is full; `keepalive` on `fetch` has the same "outlives the
 * document" property and a smaller guarantee. Neither reads a response — a beacon cannot, and
 * the collector's answer is not something a visitor's page has any use for.
 */
export function beaconSendPort(
  endpoint: string,
  globals: BeaconGlobals = globalThis as BeaconGlobals,
): FunnelSendPort {
  return {
    send(body: string): boolean {
      const beacon = globals.navigator?.sendBeacon
      if (typeof beacon === 'function') {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
        if (beacon.call(globals.navigator, endpoint, blob)) return true
      }
      const send = globals.fetch
      if (typeof send !== 'function') return false
      void send(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        keepalive: true,
      }).catch(() => {
        // A funnel that threw into a visitor's console would be an instrument making itself
        // visible to the thing it measures. A dropped report is a dropped report.
      })
      return true
    },
  }
}

/** The globals {@link beaconSendPort} reaches for, declared so a spec can supply them. */
export interface BeaconGlobals {
  readonly navigator?: { sendBeacon?: (url: string, data?: BodyInit) => boolean }
  readonly fetch?: typeof fetch
}

/** A clock port over the real clock. UTC hour, and nothing finer is representable. */
export function utcHourPort(): FunnelClockPort {
  return {
    hourBucket: (): number => new Date().getUTCHours(),
  }
}

/**
 * The device's own coarse reading of its connection, mapped onto the schema's closed list.
 *
 * `navigator.connection.effectiveType` answers `slow-2g`, `2g`, `3g` or `4g` — a *speed* rather
 * than a *medium* — and `type` answers `wifi`, `cellular`, `ethernet` and others but is
 * implemented almost nowhere. Both are read, `type` first, and anything outside the closed list
 * becomes `unknown`. A value that arrived unmapped would be refused by the collector anyway;
 * mapping here means the honest answer is sent rather than the report being dropped.
 *
 * Safari and Firefox implement neither, so `unknown` is the expected answer on both and is not
 * a failure. That is why `unknown` is a member of the list rather than an error value.
 */
export function readNetworkClass(globals: NetworkGlobals = globalThis as NetworkGlobals): FunnelNetworkClass {
  const connection = globals.navigator?.connection
  if (connection === undefined || connection === null) return 'unknown'
  const medium = connection.type
  if (medium === 'wifi' || medium === 'cellular' || medium === 'ethernet') return medium
  const speed = connection.effectiveType
  // A speed is not a medium, so the only honest mapping is the one that says so: any of the
  // cellular generations is `cellular`, and `4g` is not — a fast connection on a laptop
  // reports `4g` over wifi and calling that cellular would put a fingerprint in the wrong bucket.
  if (speed === 'slow-2g' || speed === '2g' || speed === '3g') return 'cellular'
  return 'unknown'
}

/** The globals {@link readNetworkClass} reaches for, declared so a spec can supply them. */
export interface NetworkGlobals {
  readonly navigator?: {
    readonly connection?: { readonly type?: string; readonly effectiveType?: string } | null
  }
}
