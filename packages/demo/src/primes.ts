/**
 * Host side of the prime-counting job: build the shard input, read a shard's count,
 * and project a count into the partial the fabric's one combiner accepts.
 *
 * **Why this workload exists, when the colouring job already distributes.** The
 * colouring result is checked by `verifyColouring`, which this repository also wrote.
 * That is a strong check — it re-derives the triples from the definition — but the
 * fabric and its verifier share an author, so a misconception held in both is
 * invisible to the pair. π(x) does not have that weakness: the values below were
 * tabulated in the mathematical literature long before this project, so they are an
 * oracle nothing here produced. A wrong answer cannot make them agree.
 *
 * Every shard of a job receives the *same* input block — one block, content-addressed
 * once, fetched by every node from whoever is nearest. Shards differ only by what
 * `partition()` tells the guest, which costs zero bytes on the wire. That is the
 * colouring job's arrangement and it is reused deliberately rather than reinvented.
 *
 * Pure module: no platform imports. `@o2/core` is portable by the same rule.
 */

import type { CanonicalValue } from '@o2/core'
import { CID } from 'multiformats/cid'
import { PRIMES_WASM_BASE64 } from './primes-bytes.ts'

/**
 * Payload layout the guest expects. Bumped when the layout changes; the guest refuses
 * anything else rather than misreading it.
 */
export const PRIME_INPUT_VERSION: number = 1

/**
 * Largest bound the guest accepts.
 *
 * 2^31 - 1, and the figure is a property of the kernel's arithmetic rather than a
 * policy: every product the guest forms must stay inside *unsigned* i32, and the
 * largest is (√MAX_N + 1)² = 46341² = 2 147 488 281. Above this bound the guest
 * refuses instead of computing a number that would look like an answer.
 *
 * This is not a recommendation about what to run. A bound near it would take hours on
 * one node; see the callers for what they actually pass.
 */
export const PRIME_MAX_N: number = 2_147_483_647

/** Width of the guest's count field, in bytes — always this, whatever the count is. */
export const PRIME_COUNT_BYTES: number = 8

/**
 * The shard input, little-endian and read by the guest with align=1 (the payload
 * begins at a CBOR header boundary, so nothing in it is naturally aligned).
 * `submitJob` wraps this in DAG-CBOR as a byte string; the guest skips that header.
 *
 *   off 0   u32   version   = PRIME_INPUT_VERSION
 *   off 4   u32   n         count the primes p with 2 <= p <= n
 *
 * Eight bytes total, so DAG-CBOR encodes it with a one-byte header (`0x48`). The guest
 * still handles the wider header forms, because a guest that depended on the encoder's
 * choice of width would break the day a longer payload was added here.
 */
export function buildPrimesInput(n: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(n) || n < 0 || n > PRIME_MAX_N) {
    throw new RangeError(`prime bound must be an integer in [0, ${PRIME_MAX_N}], got ${String(n)}`)
  }
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, PRIME_INPUT_VERSION, true)
  view.setUint32(4, n, true)
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
 * The primes a shard counted in its own sub-range.
 *
 * **Throws rather than returning zero**, and the distinction is the whole reason this
 * function exists instead of an inline read. The guest emits `status = 1` with a count
 * of zero when it refused the block — and a refusal summed into an aggregate is
 * indistinguishable from a sub-range that genuinely held no primes. One is a failure
 * that must be named; the other is an ordinary contribution. They must not share a
 * value.
 *
 * Throwing routes a bad shard into `reduceJob`'s per-shard try/catch, which turns it
 * into a named failure. Returning a sentinel would instead produce a perfectly
 * well-formed leaf carrying a wrong number, and the aggregate would be quietly short
 * by exactly the primes that shard was supposed to count — the failure mode that would
 * be hardest to notice, because π(x) is only checkable if you already know it.
 */
export function readPrimeCount(output: CanonicalValue): number {
  if (!isRecord(output)) throw new Error('output is not a prime-count partial')

  const status = output['s']
  if (!(status instanceof Uint8Array) || status.length !== 1) {
    throw new Error('output is not a prime-count partial')
  }
  if (status[0] !== 0) throw new Error(`the guest refused this shard (status ${String(status[0])})`)

  const field = output['c']
  if (!(field instanceof Uint8Array) || field.length !== PRIME_COUNT_BYTES) {
    throw new Error('output is not a prime-count partial')
  }

  // Read as 64 bits because that is the width the guest emits, then narrow — rather
  // than reading the low 32 and assuming the high half is zero, which would be an
  // assumption about magnitude in the one place this design set out not to make one.
  const wide = new DataView(field.buffer, field.byteOffset, PRIME_COUNT_BYTES).getBigUint64(0, true)
  if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`a count of ${wide.toString()} does not fit a JavaScript number`)
  }
  return Number(wide)
}

/**
 * The key every shard's count is summed under.
 *
 * One key, deliberately. `fabricCombiner` sums `counts` key-wise, so shards writing the
 * same key add up and shards writing different keys do not. A per-shard key would make
 * the aggregate a table of shard counts that still has to be summed by somebody, and
 * the summing is the part the fabric is supposed to be doing.
 */
export const PRIME_COUNT_KEY = 'primes'

/**
 * The job's projection: an agreed shard output becomes a `{counts, rows}` partial.
 *
 * **Derived from the shard's output, never from its index.** A projection written
 * against `partitionIndex` would make every leaf a function of an integer the requestor
 * already holds, so nothing any executor computed would enter the aggregate at all —
 * and a guest returning any agreed output whatsoever would produce the same root.
 *
 * `rows` carries the number of sub-ranges folded in, which is how the aggregate says
 * how many shards it covers. `reduceJob` keys each leaf on its partition index, so two
 * shards that happen to count the same number of primes stay two contributions rather
 * than deduplicating into one — which is exactly the silent undercount this projection
 * would otherwise invite, since equal counts are common when the ranges are equal.
 */
export function projectPrimeCount(output: CanonicalValue): CanonicalValue {
  return { counts: { [PRIME_COUNT_KEY]: readPrimeCount(output) }, rows: 1 }
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
 * `primes.wasm` is committed next to `primes.wat`, but a browser tab has no filesystem
 * to read it from, so the bytes also travel as base64 in the generated
 * `primes-bytes.ts`. `atob` is a global in Node and in every browser, so decoding needs
 * no platform branch and no dependency.
 *
 * Kept here rather than in a `primes-kernel.ts` of its own — the colouring kernel
 * splits `kernel.ts` from `job.ts` because its host side is three hundred lines of
 * triple enumeration, and this one is short enough that a second file would be filing
 * rather than structure.
 *
 * The two representations are generated by one script and asserted equal — along with
 * a fresh recompilation of the `.wat` — in `primes-build.node.test.ts`.
 */
export const primesKernelBytes: Uint8Array<ArrayBuffer> = decodeBase64(PRIMES_WASM_BASE64)
