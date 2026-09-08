/**
 * What a stage of invitations is expected to cost, and whether the reading taken afterwards
 * says the next stage may be sent. `RUN-07`, Phase 39 criterion 3.
 *
 * Plain ESM, zero dependencies, and the only platform import is `node:process` for the CLI
 * arm at the bottom — so `packages/node/src/stage-budget.node.test.ts` imports the two
 * functions and gets arithmetic with no environment attached.
 *
 * ## The reading this file is built on
 *
 * **Durable Object requests are the binding cost, not Workers requests.** On 2026-09-03 the
 * account read **1 100 232 Durable Object requests against 1 000 000 included, on day 3 of the
 * period**, while Workers invocations over the same day were **1 966**. Two meters, three orders
 * of magnitude apart, and only the first one binds. Every WebSocket message counts as a Durable
 * Object request, so the driver is protocol chattiness per connection and **not visitor count**.
 * Object duration sat at 1 %, so hibernation works and duration is not the term to watch.
 *
 * The free tier's 100 000/day cap took the hosted node down mid-day: `HTTP 429`, `error code:
 * 1027`, refused at the edge with the Worker script never running, so no log of this project's
 * records it. **A spending alert would not have caught it** — that is a control on money and
 * this was a control on requests, and the two failure modes are disjoint. The account is now on
 * the Workers Paid plan, $5/month. Recorded in
 * `.planning/debug/2026-09-03-the-free-tier-request-cap-took-the-hosted-tier-down.md`.
 *
 * ## Why an absent input is a throw and never a default
 *
 * A default would let an unpriced stage be sent while looking priced, and the rule this phase
 * works to is that **a stage that cannot state its expected request cost is a stage that must
 * not be sent**. So `estimateStageRequests` refuses rather than assuming, and refusing is the
 * default behaviour rather than the exceptional one. `stageVerdict` refuses on the same terms.
 * The CLI arm at the bottom is the only layer that supplies values, and it supplies the named
 * constants below explicitly.
 *
 * ## `REQUESTS_PER_RESERVATION` is an order-of-magnitude driver, corrected by measurement
 *
 * It is not a precision constant and must not be read as one. It comes from dividing one day's
 * account total by one run's reservation count, so it carries every other request that day as
 * well. **The whole point of `stageVerdict`'s tolerance arm is that this number gets corrected
 * by the reading taken after each stage** rather than being trusted into the next one. That arm
 * is the correction; without it the second stage inherits the first stage's error silently.
 *
 * **The estimate's error is signed in both directions, which is why only a measurement settles
 * it.** Stated rather than left to be discovered:
 *
 * - The reservation term is a **floor**. It treats one join as one reservation, and a
 *   reservation is renewed, so a long session is many reservations. A cohort that stays online
 *   costs more than this says.
 * - The two per-visit terms are **ceilings**. `visits === invites` assumes everybody invited
 *   opens the link, and `FUNNEL_POSTS_PER_VISIT` is the maximum a visit can ever post, which
 *   only a visit reaching every stage actually pays.
 * - The page's `GET /self` kill-switch poll is **not a separate term**, deliberately. It is
 *   already inside the 165: that figure was derived from a whole day's account total, which
 *   included every poll made that day. Adding it again would double-count it.
 *
 * So the estimate is neither an upper nor a lower bound. It is an order of magnitude, and the
 * tolerance arm is the instrument that tells you which way it was wrong.
 */
import process from 'node:process'

/**
 * Durable Object requests attributable to one relay reservation.
 *
 * **Derived from the 2026-09-03 account reading**: 1 100 232 Durable Object requests over a
 * period that carried a run of 6 615 relay reservations plus background traffic. Every
 * WebSocket message on a hibernatable object counts as a request, so a reservation's cost is
 * its protocol chatter and not its byte count.
 *
 * Read the file header before using this number for anything: it is an order-of-magnitude
 * driver corrected by measurement, and {@link stageVerdict}'s tolerance arm is the correction.
 */
export const REQUESTS_PER_RESERVATION = 165

/**
 * Requests one visit spends asking the derived origin whether it is a collector.
 *
 * Plan 39-02's `probeFunnelTarget` (`packages/browser/src/funnel-reporter.ts`) issues exactly
 * one `GET /funnel` per visit before it installs a send port, and that summary's own measurement
 * confirms the figure as **+1 request per visit**, read at a stand-in server's log rather than
 * reasoned about. The stand-in's request filter is keyed on `GET /funnel` specifically, because
 * the page already speaks `GET /self` to the same origin for the kill switch and a filter keyed
 * on the method alone would have counted that poll and reported the probe's cost as two.
 */
export const PROBE_REQUESTS_PER_VISIT = 1

/**
 * The most reports one visit can ever post.
 *
 * Six `enter` reports — one per member of `FUNNEL_STAGES` in `packages/net/src/funnel-schema.ts`
 * — plus one terminal `stalled`. `FunnelReporter.enter` is once-per-stage and `stalled` is
 * once-per-visit, so the hold is bounded by construction and needs no eviction: at most seven
 * reports can ever be in it.
 *
 * This is a ceiling, not an average. Only a visit that reaches `first-task` pays all seven.
 */
export const FUNNEL_POSTS_PER_VISIT = 7

/** Durable Object requests included in the Workers Paid plan, $5/month, per month. */
export const INCLUDED_DO_REQUESTS_PER_MONTH = 10_000_000

/** US dollars per million Durable Object requests beyond the included allowance. */
export const OVERAGE_USD_PER_MILLION = 0.15

/**
 * The factor by which a measured delta may exceed its estimate before the run stops.
 *
 * **A stated judgement, sited against the estimate's own admitted error rather than against a
 * measurement.** The header names two ceilings and one floor inside the estimate, so it can be
 * wrong in either direction by a factor rather than by a percentage; three is the point past
 * which "the model is coarse" stops explaining the gap and something unmodelled is doing it.
 *
 * It is a **default of the CLI layer only**. {@link stageVerdict} requires `tolerance` and
 * throws without it, so a caller cannot inherit this number without naming it.
 */
export const DEFAULT_TOLERANCE = 3

const REFUSAL = 'a stage that cannot state its expected request cost must not be sent'

function requireObject(value, who) {
  if (value === null || typeof value !== 'object') {
    throw new Error(`stage-budget: ${who} needs an object of inputs and got ${describe(value)} — ${REFUSAL}`)
  }
  return value
}

function describe(value) {
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  if (value === null) return 'null'
  return String(value)
}

/** A count: present, finite, and not negative. */
function requireCount(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `stage-budget: '${name}' must be a finite number of zero or more and is ${describe(value)} — ${REFUSAL}`,
    )
  }
  return value
}

/** A count that may not be zero — a divisor, or a factor that would erase what it multiplies. */
function requirePositive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `stage-budget: '${name}' must be a finite number greater than zero and is ${describe(value)} — ${REFUSAL}`,
    )
  }
  return value
}

/** A rate in 0..1 inclusive. A join rate outside that is a typo, not a forecast. */
function requireRate(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `stage-budget: '${name}' must be a finite number between 0 and 1 and is ${describe(value)} — ${REFUSAL}`,
    )
  }
  return value
}

/**
 * The Durable Object requests a stage of invitations is expected to spend.
 *
 * Three terms, kept separate so a reader can check the answer by hand:
 * every invitee is a visit and pays one probe; every visit posts at most seven funnel reports;
 * the fraction that joins holds a reservation and pays its protocol chatter. Rounded **up**,
 * because a budget that rounds down under-states what it will spend.
 *
 * Worked by hand for the runbook's own example — 50 invites at a 0.3 join rate:
 * 50 probes + 350 funnel posts + 15 reservations at 165 each = 50 + 350 + 2475 = **2875**.
 *
 * Throws on any absent or non-finite input. See the header for why there is no default.
 *
 * @param {{invites:number, joinRate:number, requestsPerReservation:number, probesPerVisit:number, funnelPostsPerVisit:number}} inputs
 * @returns {number} whole Durable Object requests
 */
export function estimateStageRequests(inputs) {
  const given = requireObject(inputs, 'estimateStageRequests')
  const invites = requireCount(given.invites, 'invites')
  const joinRate = requireRate(given.joinRate, 'joinRate')
  const requestsPerReservation = requireCount(given.requestsPerReservation, 'requestsPerReservation')
  const probesPerVisit = requireCount(given.probesPerVisit, 'probesPerVisit')
  const funnelPostsPerVisit = requireCount(given.funnelPostsPerVisit, 'funnelPostsPerVisit')

  const visits = invites
  const joins = invites * joinRate

  return Math.ceil(
    visits * probesPerVisit + visits * funnelPostsPerVisit + joins * requestsPerReservation,
  )
}

/**
 * The period's request total projected to the end of the period, rounded up.
 *
 * Module-local on purpose: {@link stageVerdict} compares it and the CLI arm prints it, and a
 * second copy of this arithmetic is a second thing that can disagree with the first.
 */
function projectPeriodRequests(periodTotal, daysElapsed, daysInPeriod) {
  return Math.ceil((periodTotal * daysInPeriod) / daysElapsed)
}

/**
 * Go or stop, with a reason on both — because a `go` with no reason is unauditable.
 *
 * Two arms, checked in this order, and the order is asserted by the spec rather than assumed:
 *
 * 1. **The estimate was wrong by more than the stated factor.** `measuredDelta > tolerance ×
 *    estimate`. The next stage's estimate is derived from the same model, so an estimate that
 *    has already missed is not a thing to size the next stage with.
 * 2. **The projection overruns the included allowance.** `periodTotal × (daysInPeriod /
 *    daysElapsed) > included`. This is the arm that would have caught 2026-09-03: the incident's
 *    own numbers — 1 100 232 in 3 of 30 days — project to 11 002 320 against 10 000 000
 *    included, which is a stop before any invitation goes out.
 *
 * Both comparisons are **strictly greater than**, so a reading exactly at a boundary is a `go`.
 * The projection is rounded up before comparison, which is the conservative direction.
 *
 * `daysElapsed` of zero throws rather than dividing: a projection from zero days is not a
 * projection, and `Infinity > included` would answer `stop` for a reason that is arithmetic
 * rather than evidence.
 *
 * @param {{estimate:number, measuredDelta:number, periodTotal:number, daysElapsed:number, daysInPeriod:number, included:number, tolerance:number}} inputs
 * @returns {{verdict:'go'|'stop', reason:string}}
 */
export function stageVerdict(inputs) {
  const given = requireObject(inputs, 'stageVerdict')
  const estimate = requireCount(given.estimate, 'estimate')
  const measuredDelta = requireCount(given.measuredDelta, 'measuredDelta')
  const periodTotal = requireCount(given.periodTotal, 'periodTotal')
  const daysElapsed = requirePositive(given.daysElapsed, 'daysElapsed')
  const daysInPeriod = requirePositive(given.daysInPeriod, 'daysInPeriod')
  const included = requirePositive(given.included, 'included')
  const tolerance = requirePositive(given.tolerance, 'tolerance')

  const allowed = tolerance * estimate
  const projection = projectPeriodRequests(periodTotal, daysElapsed, daysInPeriod)

  if (measuredDelta > allowed) {
    return {
      verdict: 'stop',
      reason:
        `measured ${measuredDelta} against an estimate of ${estimate}, which is over the ` +
        `${allowed} allowed at tolerance ${tolerance} — the estimate is wrong by more than the ` +
        `stated factor, so the estimate for the next stage is not trustworthy`,
    }
  }

  if (projection > included) {
    return {
      verdict: 'stop',
      reason:
        `the period projects to ${projection} requests against ${included} included — ` +
        `${periodTotal} in ${daysElapsed} of ${daysInPeriod} days; overage is ` +
        `$${OVERAGE_USD_PER_MILLION} per million`,
    }
  }

  return {
    verdict: 'go',
    reason:
      `measured ${measuredDelta} against an estimate of ${estimate} (the ${allowed} allowed at ` +
      `tolerance ${tolerance} was not exceeded), and the period projects to ${projection} ` +
      `against ${included} included`,
  }
}

// ---------------------------------------------------------------------------
// The CLI arm — what the owner runs between stages
// ---------------------------------------------------------------------------
//
//   node tools/run/stage-budget.mjs --invites 50 --join-rate 0.3 --measured-delta 240000 \
//     --period-total 1100232 --days-elapsed 3 --days-in-period 30
//
// Four lines out, one per fact, each prefixed `[stage-budget]`, and an exit code:
//
//   0  go       — the next stage may be sent
//   1  stop     — it may not, and the reason line says which arm fired
//   2  refused  — an input was absent or not a number, so no cost could be stated at all
//
// **Read `EXIT=$?` on the line IMMEDIATELY after the command.** No pipe, no trailing `tail`,
// no `echo` in between. A trailing `tail` has made a failing run report success more than once
// in this repository, and zsh does not have `PIPESTATUS` — it is `pipestatus[1]`.
//
// `--included` and `--tolerance` are optional and fall back to INCLUDED_DO_REQUESTS_PER_MONTH
// and DEFAULT_TOLERANCE. That fallback lives HERE and nowhere else: the two exported functions
// require every input, so nothing can inherit a number without a layer naming it.

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (typeof flag !== 'string' || !flag.startsWith('--')) continue
    const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
    parsed[key] = Number(argv[index + 1])
    index += 1
  }
  return parsed
}

function runCli(argv) {
  const args = parseArgs(argv)
  const included = Number.isFinite(args.included) ? args.included : INCLUDED_DO_REQUESTS_PER_MONTH
  const tolerance = Number.isFinite(args.tolerance) ? args.tolerance : DEFAULT_TOLERANCE

  let estimate
  let outcome
  let projection
  try {
    estimate = estimateStageRequests({
      invites: args.invites,
      joinRate: args.joinRate,
      requestsPerReservation: REQUESTS_PER_RESERVATION,
      probesPerVisit: PROBE_REQUESTS_PER_VISIT,
      funnelPostsPerVisit: FUNNEL_POSTS_PER_VISIT,
    })
    outcome = stageVerdict({
      estimate,
      measuredDelta: args.measuredDelta,
      periodTotal: args.periodTotal,
      daysElapsed: args.daysElapsed,
      daysInPeriod: args.daysInPeriod,
      included,
      tolerance,
    })
    projection = projectPeriodRequests(args.periodTotal, args.daysElapsed, args.daysInPeriod)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[stage-budget] refused ${message}`)
    process.exitCode = 2
    return
  }

  console.log(`[stage-budget] estimate ${estimate} requests for ${args.invites} invites at join rate ${args.joinRate}`)
  console.log(`[stage-budget] projection ${projection} requests for the period against ${included} included`)
  console.log(`[stage-budget] verdict ${outcome.verdict}`)
  console.log(`[stage-budget] reason ${outcome.reason}`)
  process.exitCode = outcome.verdict === 'stop' ? 1 : 0
}

/**
 * Run only when this file is the program, never when it is imported.
 *
 * `process.argv[1]` is resolved by Node to an absolute path, measured on this machine rather
 * than assumed, and it equals the decoded pathname of `import.meta.url` for a directly-invoked
 * module. Under vitest `argv[1]` is the runner, so the spec imports these functions and this
 * block does not fire.
 */
const invokedDirectly =
  typeof process !== 'undefined' &&
  typeof process.argv?.[1] === 'string' &&
  decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]

if (invokedDirectly) {
  runCli(process.argv.slice(2))
}
