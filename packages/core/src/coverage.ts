/**
 * Coverage over owners — CHURN-05.
 *
 * A cross-owner aggregate computed over eight of ten owners is a *different number*
 * from the same aggregate over ten. Both are correct answers to different questions,
 * and the failure mode this module exists to prevent is presenting the first as
 * though it were the second — which needs no bug at all, only a missing sentence.
 *
 * ## Coverage travels with the value, or it is not coverage
 *
 * The same reasoning as attestation strength in `quorum.ts`. If the aggregate can be
 * read without its coverage, then somewhere in the system it will be, and the report
 * becomes a diagnostic nobody looks at rather than a qualifier on the number. So the
 * aggregate is a **product type**: `CoveredAggregate<T>` has no accessor that yields
 * the value alone, and every site that displays a number has to have handled the
 * coverage to get there.
 *
 * `complete` is derived, never passed in — a caller able to declare a partial result
 * complete would eventually declare one that was not.
 *
 * ## Why owners and not nodes
 *
 * The unit is the *owner*, because that is the unit of data. An owner with three nodes
 * offline but one still answering has contributed everything they hold; an owner with
 * every node offline is a hole in the dataset regardless of how many nodes the fabric
 * had up. Counting nodes would make a job over one large owner and nine small ones
 * look nearly complete when the large one is missing.
 *
 * Pure module.
 */

import type { OwnerId } from './sovereignty.ts'

export interface CoverageReport {
  /** Owners that contributed. */
  readonly covered: number
  /** Owners the job was defined over. */
  readonly total: number
  /** Owners expected but absent, sorted. */
  readonly missing: readonly OwnerId[]
  /** Contributors that were not expected, sorted. Usually empty; never ignored. */
  readonly unexpected: readonly OwnerId[]
  /** Derived: every expected owner contributed. */
  readonly complete: boolean
}

/**
 * Compare who was expected against who contributed.
 *
 * `unexpected` exists because silently accepting a contribution from an owner outside
 * the job's definition would change the aggregate without changing the coverage, which
 * is precisely the kind of invisible difference this module is for. It is reported
 * rather than rejected — the aggregation may be legitimate and the *definition* stale
 * — but it cannot pass unnoticed.
 */
export function coverageOf(
  expected: readonly OwnerId[],
  contributed: readonly OwnerId[],
): CoverageReport {
  const wanted = new Set(expected)
  const got = new Set(contributed)

  const missing = [...wanted].filter((owner) => !got.has(owner)).sort()
  const unexpected = [...got].filter((owner) => !wanted.has(owner)).sort()
  const covered = [...wanted].filter((owner) => got.has(owner)).length

  return {
    covered,
    total: wanted.size,
    missing,
    unexpected,
    // An empty job is not a complete one — "0 of 0 owners" answers nothing, and
    // reporting it as complete would let an empty owner set silently pass.
    complete: wanted.size > 0 && missing.length === 0 && unexpected.length === 0,
  }
}

/** One line fit to print beside the number, in the form the criterion asks for. */
export function describeCoverage(report: CoverageReport): string {
  const head = `covered: ${report.covered}/${report.total} owners`
  if (report.complete) return `${head} — complete`

  const parts: string[] = []
  if (report.missing.length > 0) parts.push(`missing ${report.missing.join(', ')}`)
  if (report.unexpected.length > 0) parts.push(`unexpected ${report.unexpected.join(', ')}`)
  if (report.total === 0) parts.push('no owners were expected')
  return `${head} — PARTIAL (${parts.join('; ')})`
}

/**
 * An aggregate that cannot be read without its coverage.
 *
 * There is no `.value` shortcut past the report and no unwrap helper, deliberately.
 * Destructuring gives you both or neither, which is the whole point — a number that
 * has lost its denominator is worse than no number, because it looks like an answer.
 */
export interface CoveredAggregate<T> {
  readonly value: T
  readonly coverage: CoverageReport
}

/** Pair an aggregate with the coverage it was computed over. */
export function withCoverage<T>(
  value: T,
  expected: readonly OwnerId[],
  contributed: readonly OwnerId[],
): CoveredAggregate<T> {
  return { value, coverage: coverageOf(expected, contributed) }
}
