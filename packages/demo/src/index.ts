/**
 * `@o2/demo` — the Pythagorean-triple 2-colouring computation.
 *
 * Find a 2-colouring of {1..N} in which no Pythagorean triple (a² + b² = c², c ≤ N)
 * is monochromatic. N = 7824 admits one; 7825 does not, which was settled in 2016 by
 * a SAT search whose proof ran to 200 terabytes. The problem is here because it has
 * the shape a public compute fabric needs: the search splits into independent cubes
 * with no shared state, and — the part that matters — an answer is *checkable* in
 * milliseconds by anyone, from the definition alone.
 *
 * That asymmetry is the demo. The fabric is untrusted, the nodes are strangers, the
 * blocks arrive from wherever, and none of it has to be believed: `verifyColouring`
 * re-derives the triples itself and either accepts the claimed colouring or names
 * the triple that refutes it. Checking n = 7824 costs about 80 ms in a browser tab.
 *
 * How far the *search* gets is a separate question. The guest runs plain depth-first
 * search — no unit propagation, no conflict-driven backjumping — over values ordered
 * by how many triples they appear in, most constrained first. Measured with the
 * shipped budget of five million backtracks per shard:
 *
 *   1 cube      n = 300
 *   8 cubes     n = 500
 *   64 cubes    n = 500
 *   256 cubes   n = 600
 *   1024 cubes  n = 600
 *
 * The reach grows with the number of participants, in steps rather than smoothly.
 * That property is the point of the demo and it is not free: under the obvious
 * increasing-value order the same search stalls at n = 205 and more cubes buy
 * *nothing*, because the first k values are the least constrained ones — 1 and 2
 * appear in no triple at all, so fixing them splits the work without splitting the
 * difficulty. Ordering by constraint is what makes a cube's assignment informative.
 *
 * Past the reachable bound a shard returns 'budget', meaning "I do not know" — a
 * deliberately different answer from 'exhausted', which means "this cube provably
 * contains no colouring". Conflating the two would turn a shortage of compute into a
 * false mathematical claim; keeping them apart is what lets any result be reported
 * at all.
 *
 * Portable by the same rule as `@o2/core`: no platform imports, no libp2p. The
 * kernel is WASM bytes carried as base64, so the whole package runs unchanged in a
 * browser tab, in Node, and inside a Worker.
 */

// The question, derived from its definition, plus the search order derived from it.
export { assignmentOrder, enumerateTriples, valueDegrees } from './triples.ts'
export type { Triple } from './triples.ts'

// The independent verifier — the centrepiece.
export { colourOf, verifyColouring } from './colouring.ts'
export type { ColouringVerdict } from './colouring.ts'

// The guest module.
export { kernelBytes } from './kernel.ts'

// Host-side job construction and result reading.
export {
  COLOURING_BYTES,
  DEFAULT_BUDGET,
  INPUT_VERSION,
  MAX_N,
  MAX_TRIPLES,
  answerOf,
  buildInput,
  readPartial,
} from './job.ts'
export type { PartialStatus, ShardPartial } from './job.ts'
