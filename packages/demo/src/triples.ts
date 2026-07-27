/**
 * Pythagorean triple enumeration — the definition, and nothing but the definition.
 *
 * A triple is `(a, b, c)` with `a < b < c ≤ n` and `a² + b² = c²`. That sentence is
 * the whole specification, and this file is a direct transcription of it: two
 * nested loops over `a` and `b`, and an equality test done in integers.
 *
 * `Math.sqrt` appears exactly once, and only to *propose* a candidate `c`. The
 * acceptance test is `c * c === s`, which is integer multiplication on values below
 * 2⁵³ and therefore exact. A float comparison anywhere in the acceptance path would
 * make the triple set a property of the host's rounding behaviour rather than a
 * property of arithmetic — and the entire point of this package is that the
 * verifier's answer does not depend on where it runs.
 *
 * Pure module: no platform imports, no I/O.
 */

/** One Pythagorean triple, with its legs ordered. */
export interface Triple {
  readonly a: number
  readonly b: number
  readonly c: number
}

/**
 * Every Pythagorean triple with hypotenuse at most `n`, ascending by `c` then `a`.
 *
 * The order is part of the contract: the guest kernel receives this list and relies
 * on it being grouped by `c` so that "the triples completed by assigning value v"
 * is a contiguous range. It is also what makes two independently built inputs
 * byte-identical, which is what lets a shard's input CID be a stable name.
 */
export function enumerateTriples(n: number): readonly Triple[] {
  const out: Triple[] = []
  if (!Number.isInteger(n) || n < 5) return out

  // Hoisted: the bound is loop-invariant, and `c ≤ n` is exactly `s ≤ n²`.
  const limit = n * n

  for (let a = 3; a < n; a++) {
    const aa = a * a
    for (let b = a + 1; ; b++) {
      const s = aa + b * b
      if (s > limit) break
      // Proposal only. `Math.sqrt` is correctly rounded, so for a perfect square
      // below 2⁵³ it already returns the exact root; `Math.round` costs nothing and
      // removes any dependence on that guarantee.
      const c = Math.round(Math.sqrt(s))
      // The acceptance test. Integers only. `c > b` follows from c² = a² + b² > b²,
      // so `a < b < c` holds by construction rather than by assertion.
      if (c * c === s) out.push({ a, b, c })
    }
  }

  // Sorting by `c` then `a` is a total order here: within one `c`, no two triples
  // share an `a`, because `b` is then determined by b² = c² − a².
  out.sort((x, y) => (x.c === y.c ? x.a - y.a : x.c - y.c))
  return out
}

/**
 * How many triples each value appears in, indexed by value. Index 0 is unused.
 *
 * This is the value's degree in the constraint hypergraph, and it is the only
 * heuristic the search uses.
 */
export function valueDegrees(n: number): readonly number[] {
  const degrees: number[] = new Array<number>(Math.max(0, n + 1)).fill(0)
  for (const { a, b, c } of enumerateTriples(n)) {
    degrees[a] = (degrees[a] ?? 0) + 1
    degrees[b] = (degrees[b] ?? 0) + 1
    degrees[c] = (degrees[c] ?? 0) + 1
  }
  return degrees
}

/**
 * The order values are assigned in: most-constrained first, ties by value ascending.
 *
 * Value order is the single biggest lever on how far this search gets, and increasing
 * value order — the obvious choice — is close to the worst one. Under it the search
 * stalls at n = 205, because value 205's triples reach back to values in the sixties
 * and chronological backtracking has to re-enumerate everything in between before it
 * can revise one of them. Conflicts surface a hundred and forty levels below where
 * they are caused, and the subtree in between is explored exhaustively for nothing.
 *
 * Assigning the most constrained values first inverts that: the values that
 * participate in the most triples are decided near the root, so a conflict is
 * detected within a few levels of the choice responsible for it. Measured, that moves
 * the wall from 205 to the mid-hundreds, and — the part that matters for a fabric —
 * it makes the cube decomposition informative, because the k values a cube fixes are
 * now the k values the rest of the search is most sensitive to.
 *
 * The tie-break is by value rather than by anything derived, so the order is a pure
 * function of `n`. Every node must compute the same order or the shards are not
 * solving the same problem; determinism here is a correctness requirement, not a
 * convenience.
 */
export function assignmentOrder(n: number): readonly number[] {
  if (!Number.isInteger(n) || n < 1) return []
  const degrees = valueDegrees(n)
  const order: number[] = []
  for (let v = 1; v <= n; v++) order.push(v)
  order.sort((x, y) => (degrees[y] ?? 0) - (degrees[x] ?? 0) || x - y)
  return order
}
