/**
 * `RUN-07`'s arithmetic: what a stage of invitations is expected to cost in Durable Object
 * requests, and whether the reading taken afterwards says the next stage may be sent.
 *
 * ## Why this file exists at all, stated as a measurement rather than as a worry
 *
 * On 2026-09-03 the owner posted the demo link to a Telegram group. Within hours the deployed
 * node answered `HTTP 429` with `error code: 1027` on every path — Cloudflare's daily request
 * cap for the free plan, refused at the edge, the Worker script never running. The account read
 * **1 100 232 Durable Object requests against 1 000 000 included, on day 3 of the period**,
 * while Workers invocations over the same day were **1 966**. Two meters, three orders of
 * magnitude apart, and only the first one binds. Recorded in
 * `.planning/debug/2026-09-03-the-free-tier-request-cap-took-the-hosted-tier-down.md`.
 *
 * A spending alert would not have caught it: that is a control on money and this was a control
 * on requests, and the two failure modes are disjoint. So the control has to be arithmetic run
 * before the stage goes out, and the rule this file pins is: **a stage that cannot state its
 * expected request cost is a stage that must not be sent.** That is why every absent input is a
 * throw and not a default — a default would let an unpriced stage be sent while looking priced.
 *
 * ## Why every expected number below is a hand-written literal
 *
 * An assertion that recomputes the estimate from the same inputs the function reads is an
 * assertion reusing the value it tests, and this repository has watched a plant stay green for
 * exactly that reason — both sides moved together. So `2875` is written as `2875`, arrived at by
 * hand from the inputs, and not as an expression over `invites`. The same for `1438`, `8625`
 * and `11002320`, and for every reason string, which is asserted whole.
 *
 * The arithmetic behind `2875`, done by hand so a reader can check it without running anything:
 * 50 visits × 1 probe = 50, plus 50 visits × 7 funnel posts = 350, plus (50 × 0.3) = 15
 * reservations × 165 requests = 2475. 50 + 350 + 2475 = 2875.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error TS7016 — `tools/run/stage-budget.mjs` is plain ESM, which this plan requires
// so the arithmetic imports without a platform, and this repository's `tsconfig.json` sets no
// `allowJs`. So `tsc` RESOLVES the module and then refuses to read it for types. The tree's own
// answer to this is a sibling declaration file — `packages/demo/scripts/compile-kernel.d.mts`
// beside `compile-kernel.mjs`, imported the same way by three specs — and a fourth file is
// outside this plan's writable set, so the suppression stands here instead and is reported.
// It is **self-retiring**: add `tools/run/stage-budget.d.mts` and this directive becomes an
// "Unused '@ts-expect-error'" error of its own, exactly as `agent-contract.test.ts` relies on.
// What it costs is stated rather than hidden: every binding below is `any` to `tsc`, so the
// module's shape is checked by this file at RUNTIME — each of the eight is called or read in a
// case — and not by the compiler. The RED run proved that check is live: before the module
// existed, all fifteen cases failed at `Cannot find module`.
import * as stageBudget from '../../../tools/run/stage-budget.mjs'

const {
  DEFAULT_TOLERANCE,
  estimateStageRequests,
  FUNNEL_POSTS_PER_VISIT,
  INCLUDED_DO_REQUESTS_PER_MONTH,
  OVERAGE_USD_PER_MILLION,
  PROBE_REQUESTS_PER_VISIT,
  REQUESTS_PER_RESERVATION,
  stageVerdict,
} = stageBudget

/**
 * The inputs of the worked example, written out once so each case varies one thing.
 *
 * Deliberately NOT built from the module's own constants. If this object read
 * `REQUESTS_PER_RESERVATION` and the assertion below read `2875`, the pair would still be two
 * independent statements — but a reader would have to check that, and the next editor would be
 * one keystroke from making the expected value follow the input. Written out, the two sides
 * cannot move together.
 */
const FIFTY_AT_A_THIRD = {
  invites: 50,
  joinRate: 0.3,
  requestsPerReservation: 165,
  probesPerVisit: 1,
  funnelPostsPerVisit: 7,
}

/** The 2026-09-03 account reading, as the inputs of a between-stage verdict. */
const THE_INCIDENT_READING = {
  estimate: 2875,
  measuredDelta: 3000,
  periodTotal: 1100232,
  daysElapsed: 3,
  daysInPeriod: 30,
  included: 10000000,
  tolerance: 3,
}

describe('estimateStageRequests — the number a stage must be able to state before it is sent', () => {
  it('answers 2875 for a stage of 50 invites at a 0.3 join rate', () => {
    expect(estimateStageRequests(FIFTY_AT_A_THIRD)).toBe(2875)
  })

  it('rounds up, because a budget that rounds down under-states what it will spend', () => {
    // 25 visits × 1 = 25, plus 25 × 7 = 175, plus 7.5 reservations × 165 = 1237.5.
    // 25 + 175 + 1237.5 is 1437.5, and a stage cannot send half a request.
    expect(estimateStageRequests({ ...FIFTY_AT_A_THIRD, invites: 25 })).toBe(1438)
  })

  it('answers 0 for a stage of nobody, so the answer is not a constant', () => {
    expect(estimateStageRequests({ ...FIFTY_AT_A_THIRD, invites: 0 })).toBe(0)
  })

  it('counts the reservation term separately from the per-visit terms', () => {
    // Same 50 invites, join rate 0, so the reservation term vanishes and only the
    // per-visit terms remain: 50 + 350 = 400. If the three terms were not separable this
    // would still read 2875.
    expect(estimateStageRequests({ ...FIFTY_AT_A_THIRD, joinRate: 0 })).toBe(400)
  })

  it('throws when any input is absent — one assertion per field', () => {
    const { invites, joinRate, requestsPerReservation, probesPerVisit, funnelPostsPerVisit } =
      FIFTY_AT_A_THIRD
    expect(() =>
      estimateStageRequests({ joinRate, requestsPerReservation, probesPerVisit, funnelPostsPerVisit }),
    ).toThrow(/invites/)
    expect(() =>
      estimateStageRequests({ invites, requestsPerReservation, probesPerVisit, funnelPostsPerVisit }),
    ).toThrow(/joinRate/)
    expect(() =>
      estimateStageRequests({ invites, joinRate, probesPerVisit, funnelPostsPerVisit }),
    ).toThrow(/requestsPerReservation/)
    expect(() =>
      estimateStageRequests({ invites, joinRate, requestsPerReservation, funnelPostsPerVisit }),
    ).toThrow(/probesPerVisit/)
    expect(() =>
      estimateStageRequests({ invites, joinRate, requestsPerReservation, probesPerVisit }),
    ).toThrow(/funnelPostsPerVisit/)
    expect(() => estimateStageRequests(undefined)).toThrow(/stage-budget/)
  })

  it('throws when an input is present and is not a finite number', () => {
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, invites: Number.NaN })).toThrow(
      /invites/,
    )
    expect(() =>
      estimateStageRequests({ ...FIFTY_AT_A_THIRD, invites: Number.POSITIVE_INFINITY }),
    ).toThrow(/invites/)
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, joinRate: '0.3' })).toThrow(/joinRate/)
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, probesPerVisit: null })).toThrow(
      /probesPerVisit/,
    )
  })

  it('throws on a negative count and on a join rate outside 0..1', () => {
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, invites: -1 })).toThrow(/invites/)
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, joinRate: 1.5 })).toThrow(/joinRate/)
    expect(() => estimateStageRequests({ ...FIFTY_AT_A_THIRD, joinRate: -0.1 })).toThrow(/joinRate/)
  })
})

describe('stageVerdict — go or stop, with a named reason on both', () => {
  it('stops when the measured delta is over the tolerance factor times the estimate', () => {
    const verdict = stageVerdict({ ...THE_INCIDENT_READING, measuredDelta: 20000, periodTotal: 300000 })
    expect(verdict.verdict).toBe('stop')
    expect(verdict.reason).toBe(
      'measured 20000 against an estimate of 2875, which is over the 8625 allowed at tolerance 3 — the estimate is wrong by more than the stated factor, so the estimate for the next stage is not trustworthy',
    )
  })

  it('stops when the period projection overruns the included allowance — the 2026-09-03 numbers', () => {
    const verdict = stageVerdict(THE_INCIDENT_READING)
    expect(verdict.verdict).toBe('stop')
    expect(verdict.reason).toBe(
      'the period projects to 11002320 requests against 10000000 included — 1100232 in 3 of 30 days; overage is $0.15 per million',
    )
  })

  it('goes when neither arm fires, and the reason names both comparisons', () => {
    const verdict = stageVerdict({ ...THE_INCIDENT_READING, periodTotal: 300000 })
    expect(verdict.verdict).toBe('go')
    expect(verdict.reason).toBe(
      'measured 3000 against an estimate of 2875 (the 8625 allowed at tolerance 3 was not exceeded), and the period projects to 3000000 against 10000000 included',
    )
  })

  it('reports the tolerance arm when both arms fire, so the precedence is pinned', () => {
    const verdict = stageVerdict({ ...THE_INCIDENT_READING, measuredDelta: 20000 })
    expect(verdict.verdict).toBe('stop')
    expect(verdict.reason).toContain('the estimate is wrong by more than the stated factor')
  })

  it('is go at each boundary, because both rules are strictly greater than', () => {
    const atTolerance = stageVerdict({
      ...THE_INCIDENT_READING,
      measuredDelta: 8625,
      periodTotal: 300000,
    })
    expect(atTolerance.verdict).toBe('go')
    const atProjection = stageVerdict({ ...THE_INCIDENT_READING, periodTotal: 1000000 })
    expect(atProjection.verdict).toBe('go')
    expect(atProjection.reason).toContain('projects to 10000000 against 10000000 included')
  })

  it('throws rather than dividing when no days have elapsed', () => {
    expect(() => stageVerdict({ ...THE_INCIDENT_READING, daysElapsed: 0 })).toThrow(/daysElapsed/)
  })

  it('throws when any of its own inputs is absent or is not a finite number', () => {
    const { estimate, ...withoutEstimate } = THE_INCIDENT_READING
    expect(estimate).toBe(2875)
    expect(() => stageVerdict(withoutEstimate)).toThrow(/estimate/)
    expect(() => stageVerdict({ ...THE_INCIDENT_READING, included: Number.NaN })).toThrow(/included/)
    expect(() => stageVerdict({ ...THE_INCIDENT_READING, tolerance: 0 })).toThrow(/tolerance/)
    expect(() => stageVerdict(undefined)).toThrow(/stage-budget/)
  })
})

describe('the constants carry the readings they were derived from', () => {
  it('reads as it was measured, each value written here by hand', () => {
    expect(REQUESTS_PER_RESERVATION).toBe(165)
    expect(PROBE_REQUESTS_PER_VISIT).toBe(1)
    expect(FUNNEL_POSTS_PER_VISIT).toBe(7)
    expect(INCLUDED_DO_REQUESTS_PER_MONTH).toBe(10000000)
    expect(OVERAGE_USD_PER_MILLION).toBe(0.15)
    expect(DEFAULT_TOLERANCE).toBe(3)
  })
})
