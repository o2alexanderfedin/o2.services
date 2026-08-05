/**
 * Host side of the pi-estimating job: build the shard input, read a shard's scaled
 * partial, and project a partial into the partial shape the fabric's one combiner
 * accepts.
 *
 * **Why this workload exists, when `primes.ts` already distributes against a published
 * oracle.** It closes a hole that was measured in that one rather than argued about.
 * pi(x) is quoted at powers of ten, and a power of ten sits a long way from the prime
 * below it, so a guest that loses the top of its range returns the right total anyway —
 * the numbers it dropped held no primes. Planted against `primes.wat`, that defect was
 * caught at n = 1000 and at no larger bound.
 *
 * The Madhava-Leibniz series has no such gap, because every term is non-zero: where the
 * prime count's dropped numbers hold no primes and change nothing, a lost term here
 * moves the total by around five hundred million units.
 *
 * **Measured rather than predicted**, by planting that same deletion in `pi.wat` and
 * re-running: the shard-count sweep caught it at the first count it tried, while the
 * comparison against published pi *passed*. Three lost tail terms mostly cancel and
 * leave about 2e-6 of error against a 2.0e-6 remainder bound, so the oracle missed it by
 * a hair. The published constant is necessary and not sufficient here too; what has the
 * falsifying power is requiring the scaled total to be bit-identical at every shard
 * count, which is only possible because no term is zero.
 *
 * Every shard of a job receives the *same* input block — one block, content-addressed
 * once, fetched by every node from whoever is nearest. Shards differ only by what
 * `partition()` tells the guest, which costs zero bytes on the wire. That is the
 * colouring and prime jobs' arrangement, reused deliberately rather than reinvented.
 *
 * Pure module: no platform imports. `@o2/core` is portable by the same rule.
 */

import type { CanonicalValue } from '@o2/core'
import { CID } from 'multiformats/cid'
import { PI_WASM_BASE64 } from './pi-bytes.ts'

/**
 * Payload layout the guest expects. Bumped when the layout changes; the guest refuses
 * anything else rather than misreading it.
 */
export const PI_INPUT_VERSION: number = 1

/**
 * Largest term count the guest accepts.
 *
 * 2^31 - 1, and the figure is a property of the guest's arithmetic rather than a
 * policy: the term index is carried in an unsigned i32. This is not a recommendation
 * about what to run — a job near this bound would take days on one node. See the
 * callers for what they actually pass.
 */
export const PI_MAX_TERMS: number = 2_147_483_647

/** Width of the guest's partial field, in bytes — always this, whatever the value is. */
export const PI_PARTIAL_BYTES: number = 8

/**
 * The fixed-point scale the guest sums in: one unit is 10^-15 of pi/4.
 *
 * **Chosen against `Number.MAX_SAFE_INTEGER`, not against the width of an i64.** The
 * guest sums in i64, which would hold a 10^18 scale comfortably, but the partial does
 * not stop at the guest boundary — `fabricCombiner` adds these values as JavaScript
 * numbers. At 10^18 that addition would silently lose low digits *in the aggregate*,
 * which is the one place no shard-level check could see it. At 10^15 the total,
 * roughly 7.85e14, stays a exactly-representable integer on both sides.
 *
 * Kept in step with `$SCALE` in `pi.wat` by `pi-build.node.test.ts`, which reads the
 * constant out of the guest source rather than trusting this comment.
 */
export const PI_SCALE: number = 1_000_000_000_000_000

/**
 * The shard input, little-endian and read by the guest with align=1 (the payload
 * begins at a CBOR header boundary, so nothing in it is naturally aligned).
 * `submitJob` wraps this in DAG-CBOR as a byte string; the guest skips that header.
 *
 *   off 0   u32   version   = PI_INPUT_VERSION
 *   off 4   u32   terms     sum terms k = 0 .. terms-1 of the series
 *
 * Eight bytes total, so DAG-CBOR encodes it with a one-byte header (`0x48`). The guest
 * still handles the wider header forms, because a guest that depended on the encoder's
 * choice of width would break the day a longer payload was added here.
 */
export function buildPiInput(terms: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(terms) || terms < 0 || terms > PI_MAX_TERMS) {
    throw new RangeError(`term count must be an integer in [0, ${PI_MAX_TERMS}], got ${String(terms)}`)
  }
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, PI_INPUT_VERSION, true)
  view.setUint32(4, terms, true)
  return bytes
}

/** Narrow a decoded value to an IPLD map. A guard, so no cast is needed below. */
function isRecord(value: CanonicalValue): value is { readonly [k: string]: CanonicalValue } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Uint8Array) &&
    !Array.isArray(value) &&
    CID.asCID(value) === null
  )
}

/**
 * The scaled sum of the terms a shard owned.
 *
 * **Throws rather than returning zero.** The guest emits `status = 1` with a partial of
 * zero when it refused the block, and a refusal added into an aggregate is
 * indistinguishable from a sub-range that genuinely summed to zero. That second case is
 * not hypothetical here the way it is for a prime count: an alternating series crosses
 * zero constantly, so zero is an ordinary partial. One is a failure that must be named,
 * the other is an ordinary contribution, and they must not share a value.
 *
 * **Read as signed**, which is where this differs from `readPrimeCount` on an otherwise
 * identical frame. A shard whose range begins at an odd term index sums to a negative
 * number — the series alternates, and the sign of a partial is a fact about where the
 * range started, not about whether anything went wrong.
 */
export function readPiPartial(output: CanonicalValue): number {
  if (!isRecord(output)) throw new Error('output is not a pi partial')

  const status = output['s']
  if (!(status instanceof Uint8Array) || status.length !== 1) {
    throw new Error('output is not a pi partial')
  }
  if (status[0] !== 0) throw new Error(`the guest refused this shard (status ${String(status[0])})`)

  const field = output['p']
  if (!(field instanceof Uint8Array) || field.length !== PI_PARTIAL_BYTES) {
    throw new Error('output is not a pi partial')
  }

  const wide = new DataView(field.buffer, field.byteOffset, PI_PARTIAL_BYTES).getBigInt64(0, true)
  // The scale was picked so this cannot happen; it is checked anyway, because the one
  // failure this design set out to avoid is a silent loss of precision in the sum.
  if (wide > BigInt(Number.MAX_SAFE_INTEGER) || wide < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`a partial of ${wide.toString()} does not fit a JavaScript number`)
  }
  return Number(wide)
}

/**
 * The key every shard's partial is summed under.
 *
 * One key, deliberately. `fabricCombiner` sums `counts` key-wise, so shards writing the
 * same key add up and shards writing different keys do not. A per-shard key would make
 * the aggregate a table of partials that still has to be summed by somebody, and the
 * summing is the part the fabric is supposed to be doing.
 */
export const PI_PARTIAL_KEY = 'pi'

/**
 * The job's projection: an agreed shard output becomes a `{counts, rows}` partial.
 *
 * **Derived from the shard's output, never from its index.** A projection written
 * against `partitionIndex` would make every leaf a function of an integer the requestor
 * already holds, so nothing any executor computed would enter the aggregate at all —
 * and a guest returning any agreed output whatsoever would produce the same root.
 *
 * `rows` carries the number of sub-ranges folded in, which is how the aggregate says
 * how many shards it covers.
 */
export function projectPiPartial(output: CanonicalValue): CanonicalValue {
  return { counts: { [PI_PARTIAL_KEY]: readPiPartial(output) }, rows: 1 }
}

/**
 * The summed partials, read as an estimate of pi.
 *
 * The series converges to pi/4, and the guest scales by `PI_SCALE`, so this undoes both.
 * It is the only place a division by the scale happens: doing it per shard would
 * truncate each partial separately and turn an exact integer sum into an approximate
 * one for no reason.
 */
export function estimatePi(scaledTotal: number): number {
  return (4 * scaledTotal) / PI_SCALE
}

/**
 * How far from pi the estimate is allowed to be after `terms` terms.
 *
 * This is the alternating-series remainder bound and nothing about this project: for a
 * series whose terms decrease monotonically to zero, the error after N terms is no
 * larger than the first term left out, which here is 1/(2N+1) before the factor of 4.
 * It is rigorous rather than empirical, so a test asserting against it is checking the
 * fabric's arithmetic and not a threshold somebody tuned until it went green.
 *
 * The guest's own truncation — one unit of `PI_SCALE` per term, at worst — is four
 * orders of magnitude below this at the term counts anything here runs, and is covered
 * by the same bound rather than tracked separately.
 */
export function piErrorBound(terms: number): number {
  if (!Number.isInteger(terms) || terms < 1) {
    throw new RangeError(`term count must be a positive integer, got ${String(terms)}`)
  }
  return 4 / (2 * terms + 1)
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The compiled guest module, as bytes.
 *
 * `pi.wasm` is committed next to `pi.wat`, but a browser tab has no filesystem to read
 * it from, so the bytes also travel as base64 in the generated `pi-bytes.ts`. `atob` is
 * a global in Node and in every browser, so decoding needs no platform branch and no
 * dependency.
 *
 * The two representations are generated by one script and asserted equal — along with a
 * fresh recompilation of the `.wat` — in `pi-build.node.test.ts`.
 */
export const piKernelBytes: Uint8Array<ArrayBuffer> = decodeBase64(PI_WASM_BASE64)
