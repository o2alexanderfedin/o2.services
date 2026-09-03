/**
 * RUN-02's client half — the tab reads its own flag, and decides locally.
 *
 * ## Where the endpoint comes from, and why there is no second knob
 *
 * The object a tab polls is **the object it already dials**. `switchEndpointFor` derives an
 * HTTP origin from the relay multiaddr the page was given, so a page told
 * `?relay=/ip4/127.0.0.1/tcp/8802/ws/p2p/…` polls `http://127.0.0.1:8802`, and a page on the
 * deployed relay polls the deployed Worker. There is no `?switch=` and no build flag, because
 * a second source for one address is a second thing to keep in agreement and the one that
 * drifted would be the one nobody tested — `browser-id.ts`'s rule, applied to an address.
 *
 * It answers `null` for a multiaddr it cannot read rather than guessing. A guessed origin is a
 * request to somewhere nobody chose, which on a page that has just been given consent is
 * exactly the kind of request P10 exists to prevent.
 *
 * ## A failed read NEVER halts, and that is a requirement rather than a fallback
 *
 * `halted()` is `false` before the first successful read and holds **the last value it read**
 * across a failure. An operator's silence is not a stop order. A fabric that halted whenever a
 * poll failed would be a fabric that one dropped request, one flaky network, one Worker
 * restart takes down — and it would fail in the direction where nobody is computing, which is
 * the direction this project cannot afford.
 *
 * ## Ports in, no globals at module scope
 *
 * `consent.ts`'s rule, in its own words: *"Nothing touches `localStorage` at import time — a
 * module that reads browser globals when it is loaded cannot be imported by a Node test at
 * all."* The poller takes a fetch port and a clock port, so it runs in the `node` lane with no
 * DOM and in the `browser` lane against the real thing.
 *
 * ## Not in the barrel
 *
 * `computing-indicator.ts`'s stated precedent: the demo's `window.o2` hop is not traced by
 * `reachability-guard.node.test.ts`, so a barrel entry would add an exported-but-statically-
 * unreachable symbol in front of that guard for no benefit. `demo/main.ts` imports this by
 * relative path.
 *
 * ## When the poll starts
 *
 * **After consent, never before.** `built-bundle.e2e.test.ts`'s P10 asserts that every request
 * the page makes before consent carries the page's own origin, over the whole request set. A
 * poll running at page load would break it — and P10 is right: a visitor who has not opted in
 * has not agreed to talk to anybody. The construction site is inside the consent-gated start
 * path for that reason, and starting it earlier is planted and watched reddening P10.
 */

import { ADMITTING, isHaltedFor } from '@o2/libp2p'
import type { AdmissionDirective } from '@o2/libp2p'

/**
 * How often a tab asks its object whether it has been told to stop.
 *
 * ## The arithmetic, because an interval chosen without it is an interval nobody costed
 *
 * `N` tabs polling every `P` milliseconds is `N / (P / 1000)` requests per second arriving at
 * one Durable Object. At **30 000 ms** and a **300-tab** cohort — the recruitment target Phase
 * 39 is sized for — that is `300 / 30` = **10 requests per second**, or about **864 000
 * requests per day**, every one of them a Durable Object invocation on the tier Phase 29 put a
 * $15/month budget alert behind.
 *
 * At 5 000 ms the same cohort is 60 req/s and 5.2 million a day, which is six times the cost
 * for a window six times shorter — and the window is not what this control is *for*. The
 * roadmap's own sequencing is *"a Durable Object broadcast layered on **only if** the
 * sub-minute window proves unacceptable in practice"*, and 30 s is comfortably sub-minute.
 *
 * The figure is deliberately below 60 000 ms so that the poll is not itself the reason the
 * window approaches the ~60 s Workers KV number open question 2 is about. What that question
 * asks and what this answers are different mechanisms — see `propagation-window.ts`.
 */
export const ADMISSION_POLL_INTERVAL_MS = 30_000

/** How long a poll waits before giving up. A slow read is a failed read; it is not a halt. */
export const ADMISSION_POLL_TIMEOUT_MS = 5_000

/**
 * The HTTP origin of the object a relay multiaddr names, or `null`.
 *
 * Two forms are read, which are the two this fabric produces:
 *   `/ip4/127.0.0.1/tcp/8802/ws/p2p/<peer>`      → `http://127.0.0.1:8802`
 *   `/dns4/host.example/tcp/443/tls/ws/p2p/<peer>` → `https://host.example`
 *
 * `tls` is what decides the scheme, not the port: a `/tls/ws` relay is reached over `https`
 * whatever port it names, and a plain `/ws` one over `http`. Reading the port instead would
 * get a local `wrangler dev` on 8787 wrong in one direction and a non-standard TLS port wrong
 * in the other.
 *
 * The port is omitted from the origin when it is the scheme's default, so the string this
 * produces is one a reader would have written and one that matches an `Origin` header.
 */
export function switchEndpointFor(relayAddr: string): string | null {
  const parts = relayAddr.split('/').filter((part) => part !== '')
  const hostIndex = parts.findIndex((part) => part === 'ip4' || part === 'ip6' || part === 'dns4' || part === 'dns6' || part === 'dns')
  if (hostIndex === -1) return null
  const host = parts[hostIndex + 1]
  if (host === undefined || host === '') return null

  const tcpIndex = parts.findIndex((part) => part === 'tcp')
  const port = tcpIndex === -1 ? undefined : parts[tcpIndex + 1]
  if (port === undefined || !/^\d+$/u.test(port)) return null

  // A relay this fabric can reach from a browser is a WebSocket relay. Anything else is an
  // address this function has no origin for, and saying so is better than inventing one.
  if (!parts.includes('ws') && !parts.includes('wss')) return null

  const secure = parts.includes('tls') || parts.includes('wss')
  const scheme = secure ? 'https' : 'http'
  const bracketed = parts[hostIndex] === 'ip6' ? `[${host}]` : host
  const isDefaultPort = (secure && port === '443') || (!secure && port === '80')
  return isDefaultPort ? `${scheme}://${bracketed}` : `${scheme}://${bracketed}:${port}`
}

/** What the poller needs from the outside world. Two ports, nothing else. */
export interface KillSwitchPorts {
  /** The origin to poll — {@link switchEndpointFor}'s answer. */
  readonly endpoint: string
  /** This page's own client version, or `null` when its build stamp could not be read. */
  readonly clientVersion: string | null
  /** How this tab reaches the network. `globalThis.fetch` in a page; a fake in a spec. */
  readonly fetch: (input: string, init?: { signal?: AbortSignal }) => Promise<{
    readonly ok: boolean
    json(): Promise<unknown>
  }>
  /** Wall clock. Injected so the first-halt moment is the poller's own reading. */
  readonly now?: () => number
  /** Overrides {@link ADMISSION_POLL_INTERVAL_MS}. See {@link KillSwitch.start}. */
  readonly intervalMs?: number
}

/**
 * A tab's reading of whether it has been told to stop.
 *
 * {@link KillSwitch.halted} is what `AgentOptions.paused` calls, so it is **synchronous and
 * cheap** — `agent.ts` consults `paused` on every request of four kinds, and a predicate that
 * awaited a network read there would put a round trip on the fabric's hot path. The network
 * happens on a timer; the predicate reads a field.
 */
export class KillSwitch {
  readonly #ports: KillSwitchPorts
  readonly #now: () => number
  readonly #intervalMs: number
  #directive: AdmissionDirective = ADMITTING
  #timer: ReturnType<typeof setInterval> | undefined
  #firstHaltedAt: number | null = null
  #reads = 0
  #failures = 0

  constructor(ports: KillSwitchPorts) {
    this.#ports = ports
    this.#now = ports.now ?? Date.now
    this.#intervalMs = ports.intervalMs ?? ADMISSION_POLL_INTERVAL_MS
  }

  /** Whether this tab should refuse new work. Synchronous; see the class doc. */
  halted(): boolean {
    return isHaltedFor(this.#directive, this.#ports.clientVersion)
  }

  /** The last directive read, so a page can render the operator's note beside the state. */
  get directive(): AdmissionDirective {
    return this.#directive
  }

  /**
   * When this tab FIRST observed the halt, by its own clock, or `null`.
   *
   * Recorded here rather than inferred by a harness polling the page, because a harness poll
   * measures the harness's poll. Phase 36's propagation window is `max(observed) - t0` over a
   * population, and every one of those observations has to be the tab's own.
   *
   * Never reset by a later admitting directive: it is the moment this tab first saw *this*
   * page's halt, and a switch flipped back would otherwise erase the number that was being
   * measured.
   */
  get firstHaltedAt(): number | null {
    return this.#firstHaltedAt
  }

  /** How many polls have completed and how many failed. For a status reading, not a decision. */
  get counts(): { readonly reads: number; readonly failures: number } {
    return { reads: this.#reads, failures: this.#failures }
  }

  /**
   * Read once, now.
   *
   * Never throws. Every failure — a refused connection, a non-200, a body that is not a
   * directive — leaves the last known value in place and increments `failures`. See the file
   * header: an operator's silence is not a stop order.
   */
  async poll(): Promise<void> {
    try {
      const response = await this.#ports.fetch(`${this.#ports.endpoint}/self`, {
        signal: AbortSignal.timeout(ADMISSION_POLL_TIMEOUT_MS),
      })
      if (!response.ok) {
        this.#failures += 1
        return
      }
      const body: unknown = await response.json()
      const directive = readAdmission(body)
      if (directive === null) {
        this.#failures += 1
        return
      }
      this.#directive = directive
      this.#reads += 1
      if (this.#firstHaltedAt === null && this.halted()) this.#firstHaltedAt = this.#now()
    } catch {
      this.#failures += 1
    }
  }

  /**
   * Start polling.
   *
   * **Call this after consent and not before** — see the file header. One immediate read so a
   * tab that joins a halted region does not spend a whole interval admitting work it should
   * not, then the timer.
   *
   * `intervalMs` is configuration and not a test bypass, and the distinction is checkable: a
   * visitor could set it, the production default applies when it is absent, and nothing is
   * skipped at any value — a shorter interval polls more, it does not poll differently.
   */
  start(): void {
    if (this.#timer !== undefined) return
    void this.poll()
    this.#timer = setInterval(() => void this.poll(), this.#intervalMs)
  }

  /** Stop polling. Idempotent, so a page that stops twice is not an error. */
  stop(): void {
    if (this.#timer === undefined) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }
}

/**
 * Read `/self`'s `admission` field, or `null`.
 *
 * Narrowed at the boundary rather than cast, for the reason every reader of this route in this
 * repository gives: a route that stopped reporting the field would otherwise present as
 * `undefined` inside `isHaltedFor` and read as *not halted* — which is the right answer for the
 * wrong reason, and would hide the field going missing for as long as nobody was halted.
 */
function readAdmission(body: unknown): AdmissionDirective | null {
  if (typeof body !== 'object' || body === null || !('admission' in body)) return null
  const admission = body.admission
  if (typeof admission !== 'object' || admission === null) return null
  if (!('halted' in admission) || typeof admission.halted !== 'boolean') return null
  if (!('versions' in admission)) return null
  const versions = admission.versions
  if (
    versions !== 'all' &&
    !(Array.isArray(versions) && versions.every((entry) => typeof entry === 'string'))
  ) {
    return null
  }
  const region = 'region' in admission ? admission.region : null
  const since = 'since' in admission ? admission.since : null
  const note = 'note' in admission ? admission.note : ''
  return {
    region: typeof region === 'string' ? region : null,
    halted: admission.halted,
    versions: versions === 'all' ? 'all' : [...versions],
    since: typeof since === 'number' ? since : null,
    note: typeof note === 'string' ? note : '',
  }
}
