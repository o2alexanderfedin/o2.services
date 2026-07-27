/**
 * Whether a node started, and what stopped it — BROW-02.
 *
 * The requirement is that the *percentage* of visitors whose node failed to start
 * is reported, segmented by browser, "so blocking is visible rather than silent".
 * The word doing the work is **silent**: an extension blocklist, a WASM policy, or
 * a storage partition does not announce itself. It shows up as fewer volunteers
 * than expected, which is indistinguishable from fewer volunteers.
 *
 * ## The blind spot is part of the report, not a caveat beside it
 *
 * A node that cannot reach a peer cannot report that it cannot reach a peer. So the
 * reported population is never the visited population, and the gap is *exactly* the
 * blocklist cliff this measurement exists to expose. {@link StartReport} therefore
 * carries its blind spots as a field, and {@link describeStartReport} renders them
 * in the same block as the numbers — the same move `@o2/bench` makes for excluded
 * benchmark configurations, and for the same reason: a figure that vanishes between
 * the method and the result is indistinguishable, to a reader, from one removed
 * because it was inconvenient.
 *
 * ## Why a cause and not a boolean
 *
 * A bare failure count cannot tell a blocklist from a broken relay, and those want
 * opposite responses. Every failure names one of {@link START_FAILURES}.
 *
 * ## Why the browser label is coarse
 *
 * Family and major version, from a fixed set. The metric needs to see a cliff, not
 * a person — a finer label would be a fingerprint, and a fingerprint is precisely
 * what the disclosure promises not to take.
 *
 * Pure module.
 */

/**
 * Every way starting can fail, enumerated.
 *
 * `other` exists so an unforeseen failure is counted rather than dropped; a report
 * where `other` dominates is itself the finding that this list is incomplete.
 */
export const START_FAILURES = [
  'wasm-unavailable',
  'webrtc-unavailable',
  'storage-denied',
  'crypto-unavailable',
  'no-relay-reachable',
  'other',
] as const

export type StartFailure = (typeof START_FAILURES)[number]

export type StartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'failed'; readonly cause: StartFailure }

export interface StartOutcome {
  /** Coarse family and major version, e.g. `chromium 141`. Never a full UA string. */
  readonly browser: string
  readonly result: StartResult
}

/**
 * Below this many reports from one browser, a percentage is noise.
 *
 * Reported rather than suppressed: a rate over four samples is still the only
 * evidence there is, and hiding it loses the early signal a cliff arrives as.
 */
export const MIN_REPORTS_FOR_RATE = 10

export interface CauseCount {
  readonly cause: StartFailure
  readonly count: number
}

export interface BrowserTally {
  readonly browser: string
  readonly attempts: number
  readonly failed: number
  /** failed / attempts, in [0, 1]. */
  readonly failureRate: number
  /** False below {@link MIN_REPORTS_FOR_RATE}. The rate is still published. */
  readonly reliable: boolean
  /** Descending by count, then by cause name so the order is deterministic. */
  readonly causes: readonly CauseCount[]
}

/**
 * Something this report cannot see.
 *
 * `unreportable` is structural and always present — there is no configuration in
 * which a start report can observe the nodes that failed before they could report.
 */
export type BlindSpot =
  | { readonly kind: 'unreportable'; readonly note: string }
  | { readonly kind: 'declined'; readonly count: number; readonly note: string }

export interface StartReport {
  readonly reported: number
  readonly failed: number
  readonly byBrowser: readonly BrowserTally[]
  /** Never empty. See the module comment. */
  readonly blindSpots: readonly BlindSpot[]
}

/**
 * The blind spot no deployment can remove.
 *
 * Exported so a test can assert its presence by identity rather than by matching
 * prose that a later edit would quietly change.
 */
export const STRUCTURAL_BLIND_SPOT: BlindSpot = {
  kind: 'unreportable',
  note:
    'a node that could not reach a peer could not report that it could not reach a peer — ' +
    'these numbers cannot see the visitors they most need to count',
}

export interface StartReportOptions {
  /**
   * Visitors who consented to compute but not to reporting.
   *
   * Counted where the page can count them — locally, at the moment of the choice.
   * It is a second blind spot, and naming it is the price of having made reporting
   * genuinely optional rather than nominally so.
   */
  readonly declined?: number
}

function tally(browser: string, outcomes: readonly StartOutcome[]): BrowserTally {
  const failures = outcomes.filter(
    (outcome): outcome is StartOutcome & { result: { kind: 'failed'; cause: StartFailure } } =>
      outcome.result.kind === 'failed',
  )
  const counts = new Map<StartFailure, number>()
  for (const failure of failures) {
    counts.set(failure.result.cause, (counts.get(failure.result.cause) ?? 0) + 1)
  }
  return {
    browser,
    attempts: outcomes.length,
    failed: failures.length,
    failureRate: outcomes.length === 0 ? 0 : failures.length / outcomes.length,
    reliable: outcomes.length >= MIN_REPORTS_FOR_RATE,
    causes: [...counts]
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause)),
  }
}

/**
 * Aggregate reported outcomes.
 *
 * There is deliberately no way to obtain the tallies without the blind spots: they
 * are fields of the same value, so a caller cannot render one and forget the other
 * any more than `CoveredAggregate` lets a caller read a result without its coverage.
 */
export function startReport(
  outcomes: readonly StartOutcome[],
  options: StartReportOptions = {},
): StartReport {
  const byBrowser = new Map<string, StartOutcome[]>()
  for (const outcome of outcomes) {
    const bucket = byBrowser.get(outcome.browser)
    if (bucket === undefined) byBrowser.set(outcome.browser, [outcome])
    else bucket.push(outcome)
  }

  const declined = options.declined ?? 0
  const blindSpots: BlindSpot[] = [STRUCTURAL_BLIND_SPOT]
  if (declined > 0) {
    blindSpots.push({
      kind: 'declined',
      count: declined,
      note: 'visitors who agreed to compute but not to be counted',
    })
  }

  return {
    reported: outcomes.length,
    failed: outcomes.filter((outcome) => outcome.result.kind === 'failed').length,
    byBrowser: [...byBrowser]
      // Most-attempted first, then alphabetical — deterministic regardless of the
      // order reports happened to arrive in.
      .map(([browser, bucket]) => tally(browser, bucket))
      .sort((a, b) => b.attempts - a.attempts || a.browser.localeCompare(b.browser)),
    blindSpots,
  }
}

/**
 * One (browser, result) pair and how many times it was seen.
 *
 * The compact form that travels between nodes. Note what is *not* here: the
 * failure rates, the reliability flags, and the blind spots. Those are derived by
 * whoever renders the report, which means a peer cannot transmit a report with its
 * blind spots removed — there is no field in which to omit them.
 */
export interface OutcomeCount {
  readonly browser: string
  readonly result: 'started' | StartFailure
  readonly count: number
}

const resultOf = (outcome: StartOutcome): 'started' | StartFailure =>
  outcome.result.kind === 'started' ? 'started' : outcome.result.cause

/** Expand compact counts back into outcomes, so one aggregation path serves both. */
export function expandCounts(counts: readonly OutcomeCount[]): readonly StartOutcome[] {
  const outcomes: StartOutcome[] = []
  for (const entry of counts) {
    const result: StartResult =
      entry.result === 'started' ? { kind: 'started' } : { kind: 'failed', cause: entry.result }
    for (let i = 0; i < entry.count; i++) outcomes.push({ browser: entry.browser, result })
  }
  return outcomes
}

/**
 * What one node has been told about start outcomes.
 *
 * Any node may hold one — a browser tab that took a report from a peer aggregates
 * exactly as a listening server does. That is not a concession; it is the standing
 * rule that all nodes have equal functionality and only discovery differs.
 *
 * Deliberately in-memory and unauthenticated. A peer can inflate its own counts,
 * which matters for a public metric and is stated here rather than implied: this
 * measures whether *browsers* block the node, and it is not evidence about peers.
 */
export class StartOutcomeLedger {
  /**
   * Keyed for lookup, but the key is never parsed back.
   *
   * The first version of this stored bare numbers and split `"chromium 141 started"`
   * on its first space, producing the browser `chromium` with the result
   * `141 started`. Holding the parts beside the count removes the round trip rather
   * than fixing it — a decomposition that is never performed cannot be performed
   * wrongly.
   */
  readonly #counts = new Map<string, OutcomeCount>()
  #declined = 0

  #add(browser: string, result: 'started' | StartFailure, by: number): void {
    const key = `${browser}\u0000${result}`
    const existing = this.#counts.get(key)
    this.#counts.set(
      key,
      existing === undefined
        ? { browser, result, count: by }
        : { browser, result, count: existing.count + by },
    )
  }

  record(outcome: StartOutcome): void {
    this.#add(outcome.browser, resultOf(outcome), 1)
  }

  /** Visitors who consented to compute but not to be counted. */
  decline(times = 1): void {
    if (Number.isInteger(times) && times > 0) this.#declined += times
  }

  get declined(): number {
    return this.#declined
  }

  /**
   * Fold in reports known to be **distinct** from what is already held.
   *
   * Summing is right for a node ingesting one visitor's report at a time: two
   * visitors are two visitors.
   *
   * Non-integer and non-positive counts are dropped rather than trusted. This is
   * wire input, and a negative count would let one peer erase another's evidence.
   */
  mergeDisjoint(counts: readonly OutcomeCount[], declined = 0): void {
    for (const entry of counts) {
      if (!Number.isInteger(entry.count) || entry.count <= 0) continue
      this.#add(entry.browser, entry.result, entry.count)
    }
    this.decline(declined)
  }

  /**
   * Fold in a view that **overlaps** what is already held, taking the larger.
   *
   * This is the one a requestor needs, and getting it wrong is silent. Ask eight
   * peers for their counts and every peer answers with the same population seen
   * from a different angle — including, usually, this node's own report, which it
   * just published to them. Summing those would multiply the whole metric by
   * roughly the number of peers asked, and the result would still look like a
   * plausible percentage, because inflating every row equally leaves the *rates*
   * unchanged and only the `n` wrong. A rate whose sample size is a fiction is
   * exactly the kind of number this project has committed to not publishing.
   *
   * The maximum is a lower bound: never more than someone genuinely observed.
   */
  mergeOverlapping(counts: readonly OutcomeCount[], declined = 0): void {
    for (const entry of counts) {
      if (!Number.isInteger(entry.count) || entry.count <= 0) continue
      const key = `${entry.browser}\u0000${entry.result}`
      const existing = this.#counts.get(key)
      if (existing === undefined || entry.count > existing.count) {
        this.#counts.set(key, { browser: entry.browser, result: entry.result, count: entry.count })
      }
    }
    if (Number.isInteger(declined) && declined > this.#declined) this.#declined = declined
  }

  counts(): readonly OutcomeCount[] {
    return [...this.#counts.values()].sort(
      (a, b) => a.browser.localeCompare(b.browser) || a.result.localeCompare(b.result),
    )
  }

  report(): StartReport {
    return startReport(expandCounts(this.counts()), { declined: this.#declined })
  }
}

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`

/**
 * Render a report as text.
 *
 * The blind spots are inside the string rather than in surrounding prose, so they
 * survive being copied — the same rule `describe` in `@o2/bench` follows, learned
 * from the fact that a caveat kept next to a number gets separated from it the
 * first time somebody quotes the number.
 */
export function describeStartReport(report: StartReport): string {
  const lines: string[] = []
  lines.push(
    report.reported === 0
      ? 'no start outcomes reported'
      : `${report.failed} of ${report.reported} reported starts failed (${percent(
          report.reported === 0 ? 0 : report.failed / report.reported,
        )})`,
  )
  for (const browser of report.byBrowser) {
    lines.push(
      `  ${browser.browser}: ${percent(browser.failureRate)} failed ` +
        `(n=${browser.attempts}${browser.reliable ? '' : ', unreliable'})` +
        (browser.causes.length === 0
          ? ''
          : ` — ${browser.causes.map((c) => `${c.cause} ${c.count}`).join(', ')}`),
    )
  }
  for (const spot of report.blindSpots) {
    lines.push(
      spot.kind === 'declined'
        ? `  not counted: ${spot.count} — ${spot.note}`
        : `  not counted: ${spot.note}`,
    )
  }
  return lines.join('\n')
}
