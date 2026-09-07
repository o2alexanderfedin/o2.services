/**
 * Types for the staged-invite request budget. See `stage-budget.mjs`.
 *
 * A sibling declaration file rather than `allowJs`, on this tree's own precedent:
 * `packages/demo/scripts/compile-kernel.d.mts` sits beside `compile-kernel.mjs` for the same
 * reason and is imported the same way. The module is plain ESM so the arithmetic runs with no
 * build step, which is what makes it usable from a runbook the owner follows by hand.
 *
 * Adding this file retires the `@ts-expect-error` at `packages/node/src/stage-budget.node.test.ts:34`
 * by making it unused — which is how that directive was written to end, and why it is a
 * directive rather than a comment.
 */

/**
 * Durable Object requests one relay reservation is charged.
 *
 * **A quotient, not a decomposition, and 2026-09-07's source reading says it is the wrong
 * SHAPE rather than the wrong value.** It was derived as 1 100 232 DO requests over a run of
 * 6 615 reservations. Read out of the source, the cost is `51 + 164 * minutes` — a
 * per-connection-minute RATE, dominated by `ConnectionMonitor` opening a fresh
 * `/ipfs/ping/1.0.0` stream every 10 s in both directions, and doubled again because
 * `websocket-to-conn.ts` sends one WebSocket frame per constituent buffer. So 165 is
 * approximately one peer-minute, and a peer that connects and never reserves costs the same.
 * See `.planning/consults/2026-09-07-what-a-reservation-actually-costs.md`.
 *
 * It is left at 165 here because it is a defensible order-of-magnitude figure for a short
 * visit and because the after-stage comparison exists precisely to correct it by measurement.
 * Reframing the model is an owner decision, not a silent edit.
 */
export declare const REQUESTS_PER_RESERVATION: number

/** One `GET /funnel` probe per visit before a send port is installed (plan 39-02). */
export declare const PROBE_REQUESTS_PER_VISIT: number

/** Six stage `enter` reports plus one terminal `stalled` — bounded by construction. */
export declare const FUNNEL_POSTS_PER_VISIT: number

/** Workers Paid, $5/month. */
export declare const INCLUDED_DO_REQUESTS_PER_MONTH: number

/** Overage in US dollars per million Durable Object requests. */
export declare const OVERAGE_USD_PER_MILLION: number

/** How far a measured delta may exceed its estimate before a stage stops. */
export declare const DEFAULT_TOLERANCE: number

/** The inputs to a stage's expected cost. Every one is required; there is no default. */
export interface StageEstimateInputs {
  readonly invites: number
  readonly joinRate: number
  readonly requestsPerReservation: number
  readonly probesPerVisit: number
  readonly funnelPostsPerVisit: number
}

/**
 * The Durable Object requests a stage of invitations is expected to spend, rounded up.
 *
 * Throws on any absent or non-finite input — a stage that cannot state its expected cost is a
 * stage that must not be sent, so refusing is the default rather than a fallback.
 */
export declare function estimateStageRequests(inputs: StageEstimateInputs): number

/** The readings a stage's go/no-go is decided on. */
export interface StageVerdictInputs {
  readonly estimate: number
  readonly measuredDelta: number
  readonly periodTotal: number
  readonly daysElapsed: number
  readonly daysInPeriod: number
  readonly included: number
  readonly tolerance: number
}

/** Go or stop, with the reason named rather than left to the reader. */
export interface StageVerdict {
  readonly verdict: 'go' | 'stop'
  readonly reason: string
}

/**
 * Whether the next stage may be sent.
 *
 * Both comparisons are strictly greater than, so a reading exactly at a boundary is a `go`.
 * `daysElapsed` of zero throws rather than dividing, because a projection from zero days is
 * arithmetic rather than evidence.
 */
export declare function stageVerdict(inputs: StageVerdictInputs): StageVerdict
