/**
 * Summary statistics for makespan — BENCH-03.
 *
 * The methodology pre-registers "p50/p95/p99, never a bare mean". This module is how
 * that survives contact with a hurried caller: **there is no function that returns a
 * mean.** `summarise` returns a `Summary`, the mean is a field on it, and the field is
 * named `meanForCostArithmeticOnly` — long and awkward on purpose, because a name that
 * is annoying to type into a headline is doing more work than a comment asking people
 * not to.
 *
 * ## Why a mean is the wrong headline here
 *
 * A job's makespan is the time of its *slowest* shard, so the distribution is a maximum
 * of N samples: right-skewed with a long tail by construction, not by accident. The
 * mean of such a distribution sits in the gap between the typical run and the tail and
 * describes neither. p50 says what usually happens; p99 says what the unlucky user
 * experiences; the mean says something that happened to nobody.
 *
 * ## Small samples are labelled, not laundered
 *
 * p99 of ten observations *is the maximum*. Presenting it as a 99th percentile implies
 * a precision that is not there, so `reliable` is false below `MIN_RELIABLE_SAMPLES`
 * and `describe` says so in the text a reader will actually paste somewhere.
 *
 * Pure module.
 */

/** Below this, a p95/p99 is arithmetic rather than information. */
export const MIN_RELIABLE_SAMPLES = 10

export interface Summary {
  readonly n: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly min: number
  readonly max: number
  /**
   * Present only because cost arithmetic needs it (total = mean × n).
   *
   * Deliberately unwieldy. See the module note: this must never be the headline.
   */
  readonly meanForCostArithmeticOnly: number
  /** False when `n < MIN_RELIABLE_SAMPLES`, making the tail percentiles decorative. */
  readonly reliable: boolean
}

/**
 * Nearest-rank percentile: the smallest observed value at or above the rank.
 *
 * Chosen over linear interpolation because every reported number is then a value that
 * was actually observed. An interpolated p99 is a number no run produced, which is a
 * strange thing to publish as the tail of a real system.
 */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  if (!(q > 0 && q <= 1)) throw new RangeError(`percentile q must be in (0, 1], got ${q}`)
  const rank = Math.ceil(q * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number
}

/** Summarise observations. Input order is irrelevant; the copy is sorted. */
export function summarise(observations: readonly number[]): Summary {
  if (observations.length === 0) {
    return {
      n: 0,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      meanForCostArithmeticOnly: Number.NaN,
      reliable: false,
    }
  }

  const sorted = [...observations].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)

  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    meanForCostArithmeticOnly: total / sorted.length,
    reliable: sorted.length >= MIN_RELIABLE_SAMPLES,
  }
}

/** Adaptive precision — a fixed decimal renders a sub-millisecond baseline as `0.0ms`. */
const ms = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0ms'
  if (value < 0.01) return `${value.toFixed(4)}ms`
  if (value < 1) return `${value.toFixed(3)}ms`
  return `${value.toFixed(1)}ms`
}

/**
 * One line fit to publish.
 *
 * Leads with p50 and always carries `n`. When the sample is too small the caveat is in
 * the string itself, so it travels with the number into whatever document it is pasted
 * into — a caveat that lives only in the surrounding prose gets separated from its
 * number on the first copy-paste.
 */
export function describe(summary: Summary): string {
  if (summary.n === 0) return 'no observations'
  const body = `p50 ${ms(summary.p50)} · p95 ${ms(summary.p95)} · p99 ${ms(summary.p99)} (n=${summary.n})`
  return summary.reliable
    ? body
    : `${body} — n < ${MIN_RELIABLE_SAMPLES}, tail percentiles unreliable`
}
