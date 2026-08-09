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

// DET-03/DATA-08 — who meant those bytes to run. `KERNEL_TRUST_ANCHOR` is the public
// key a node pins so `guardModuleProvenance` can accept `KERNEL_RECORD` and refuse
// everything else. Generated and committed by `scripts/sign-kernel.ts`; read that
// file's header before regenerating, because both node binaries default to this anchor.
// `PI_RECORD` shares `KERNEL_TRUST_ANCHOR` — one key signs both, because both node binaries
// default to exactly one anchor and a second key would be refused by every stock node.
export { KERNEL_NAME, KERNEL_RECORD, KERNEL_TRUST_ANCHOR, PI_NAME, PI_RECORD } from './kernel-record.ts'

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

// The prime-counting workload — a second guest module, sharing the same four-function
// host ABI and the same publish-time determinism argument.
//
// It is here rather than in a package of its own because it is the same *kind* of
// thing as the colouring job: a deterministic integer guest plus the host code that
// builds its input and reads its output. What it adds is an oracle this project did
// not write. The colouring answer is checked by `verifyColouring`, which shares an
// author with the fabric; π(x) was tabulated in the mathematical literature long
// before this repository existed, so a wrong answer cannot talk it into agreeing.
export {
  PRIME_COUNT_BYTES,
  PRIME_COUNT_KEY,
  PRIME_INPUT_VERSION,
  PRIME_MAX_N,
  buildPrimesInput,
  primesKernelBytes,
  projectPrimeCount,
  readPrimeCount,
} from './primes.ts'

// The third kernel, and the complement of the second rather than a repeat of it. The
// prime count's oracle is published but blind in one direction, measured rather than
// supposed: quoted at powers of ten, and a power of ten sits far enough from the prime
// below it that a guest losing the top of its range still returns the right total. The
// Madhava-Leibniz series has no such gap — every term is non-zero, and the ones a
// tail-dropping defect loses are the largest ones left.
export {
  PI_INPUT_VERSION,
  PI_MAX_TERMS,
  PI_PARTIAL_BYTES,
  PI_PARTIAL_KEY,
  PI_SCALE,
  buildPiInput,
  estimatePi,
  piErrorBound,
  piKernelBytes,
  projectPiPartial,
  readPiPartial,
} from './pi.ts'
