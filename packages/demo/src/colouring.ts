/**
 * The independent verifier.
 *
 * This is the centrepiece of the demo, and the reason the demo is worth running at
 * all. A visitor's tab is handed a claimed 2-colouring of {1..N} by a fabric of
 * machines it has never met, running code it did not write, over blocks it did not
 * produce. It has no reason to trust any of that — and it does not have to.
 *
 * `verifyColouring` enumerates the Pythagorean triples **itself**, from the
 * definition, via `enumerateTriples`. It deliberately takes no triple list as a
 * parameter. Accepting one would reduce the check to "the answer is consistent with
 * whatever the fabric said the question was", which is not a check at all: a node
 * that omitted the triples it violated would pass. By re-deriving the question from
 * `n` alone, the verifier's only inputs are a single integer and the claimed answer,
 * and its verdict depends on nothing the fabric supplied.
 *
 * That asymmetry — search is expensive and distributed, checking is cheap and local
 * — is what makes an untrusted compute fabric useful for this class of problem.
 *
 * Pure module: no platform imports, no I/O.
 */

import { enumerateTriples } from './triples.ts'
import type { Triple } from './triples.ts'

/**
 * The outcome of checking a claimed colouring.
 *
 * A rejection names the offending triple rather than merely reporting failure: the
 * witness is small, independently checkable by hand, and is what turns "the
 * verifier said no" into evidence.
 */
export type ColouringVerdict =
  | { readonly ok: true; readonly n: number; readonly triplesChecked: number }
  | { readonly ok: false; readonly n: number; readonly violation: Triple }

/**
 * The colour assigned to `value`, which is 1-based: value `v` lives in bit `v - 1`.
 *
 * Bits are packed little-endian within each byte, matching the guest kernel's
 * output. A value outside the packed range reads as colour 0 rather than throwing —
 * a short `bits` array then yields an all-zero colouring, which any `n ≥ 5` rejects
 * on the triple (3, 4, 5). Silence is not an option the caller can reach.
 */
export function colourOf(bits: Uint8Array, value: number): 0 | 1 {
  const index = value - 1
  if (index < 0) return 0
  const byte = bits[index >> 3] ?? 0
  return ((byte >> (index & 7)) & 1) === 1 ? 1 : 0
}

/**
 * Check a claimed 2-colouring of {1..n} against the definition.
 *
 * Succeeds only when no Pythagorean triple with `c ≤ n` is monochromatic.
 */
export function verifyColouring(n: number, bits: Uint8Array): ColouringVerdict {
  const triples = enumerateTriples(n)
  for (const triple of triples) {
    const colour = colourOf(bits, triple.a)
    if (colour === colourOf(bits, triple.b) && colour === colourOf(bits, triple.c)) {
      return { ok: false, n, violation: triple }
    }
  }
  return { ok: true, n, triplesChecked: triples.length }
}
