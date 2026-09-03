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
 * store polluted, by a test suite. So the endpoint is **configuration**: it arrives from
 * `?funnel=` on the URL, and with nothing configured the reporter is **inert** and every method
 * is a no-op returning `false`. That is the production default.
 * `funnel-reporter.node.test.ts` reads this file's own source and asserts it carries no origin
 * literal, so the rule is mechanical rather than remembered.
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
  /** Absent means inert. There is no default and there must not be one. */
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
  readonly #send: FunnelSendPort | null
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
   * A reporter built with no send port is inert, which is what a page with no `?funnel=`
   * parameter gets. Exposed so a caller can log the state rather than infer it from a `false`
   * that could equally mean "already sent".
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
   */
  arm(): boolean {
    if (this.#armed) return false
    this.#armed = true
    let flushed = false
    for (const report of this.#held.splice(0)) flushed = this.#post(report) || flushed
    return flushed
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

  /** Send it, or hold it until arming. */
  #offer(report: FunnelReport): boolean {
    if (!this.#armed) {
      this.#held.push(report)
      return false
    }
    return this.#post(report)
  }

  #post(report: FunnelReport): boolean {
    const send = this.#send
    if (send === null) return false
    return send.send(JSON.stringify(report))
  }
}

/**
 * Where the collector is, taken from the page's own URL.
 *
 * **There is no default and no fallback**, which is the scope fence in one function: absent
 * `?funnel=`, this answers `null`, the reporter is inert, and no test run in this repository
 * can post to anything anybody pays for. See this module's header.
 *
 * Anything that is not a parseable absolute URL answers `null` rather than being sent to. A
 * relative value would resolve against whatever origin the page happens to be on, which for a
 * page served from a static host is a request to that host — a wrong destination that would
 * look like a working configuration.
 */
export function funnelEndpointFrom(search: string): string | null {
  let configured: string | null
  try {
    configured = new URLSearchParams(search).get('funnel')
  } catch {
    return null
  }
  if (configured === null || configured === '') return null
  try {
    const url = new URL(configured)
    // Path and query are dropped: what is configured is an ORIGIN, and the route below it is
    // this project's to name rather than a caller's.
    return `${url.origin}/funnel`
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
