/**
 * The Primes surface's formatter — UI-SPEC section 4.3, N1 through N12.
 *
 * # This is **Option B**, and it closes nothing
 *
 * Read this paragraph before reading the twelve tidy regions below and concluding that the
 * prime-counting workload shipped. **It did not.** UI-SPEC section 10 offers two dispositions
 * for this surface and this file implements the smaller one: *ship the absence*. The surface
 * states in plain words that there is no dispatch path from a browser tab, carries no run
 * control at all, and renders every one of its reading regions at its `unavailable` sentence
 * permanently. It is honest, and honest is not the same as done.
 *
 * ## The three facts, measured rather than inferred — UI-SPEC section 10
 *
 * 1. **No signed record vouches for the prime-counting module.**
 *    `packages/demo/src/kernel-record.ts` exports `KERNEL_RECORD` (colouring) and `PI_RECORD`,
 *    both signed by `KERNEL_TRUST_ANCHOR`. There is no third record. `primesKernelBytes`
 *    exists and is checked against `primes.wat`, and nothing vouches for it. A tab pins that
 *    one anchor, so every executor — *including this tab's own* — refuses a prime-counting
 *    dispatch for a provenance failure.
 * 2. **`runJob` cannot carry the input.** Its shards are built as
 *    `{ value: { a: i }, label: 'public' }`, and the prime kernel reads an eight-byte block
 *    from `buildPrimesInput(n)`. Even with a record, `runJob` would dispatch the wrong bytes.
 * 3. **Re-signing is not free.** `scripts/sign-kernel.ts` mints a new ed25519 key on every run
 *    and discards the private half, so the existing records cannot be extended. A third record
 *    means a **new trust anchor**, all three records re-signed together, and a change to what
 *    a stock `o2 agent` and a stock `o2 seed` will run.
 *
 * ## What stays open, named so a later reader cannot miss it
 *
 * The v1.1 audit's **G4** row was amended on 2026-08-08 to split its two halves: π is wired,
 * and *"the primes half is untouched"* — `buildPrimesInput`, `primesKernelBytes`,
 * `projectPrimeCount`, `readPrimeCount` and `PRIME_COUNT_KEY` have **zero production
 * callers**. This file calls none of them. It imports exactly one symbol from `@o2/demo`,
 * `PRIME_MAX_N`, which is a number and not a path to a job. So G4's primes half is still open
 * after this surface ships, and `packages/node/src/demo-primes.e2e.test.ts` **measures** that
 * rather than asserting it — with a grep that is designed to go red the day somebody wires the
 * workload, because at that moment this surface has stopped being honest and must be
 * replanned.
 *
 * **Option A is an owner decision and must not be begun here.** Extending `sign-kernel.ts`,
 * regenerating `kernel-record.ts` under a new anchor and adding `TabApi.runPrimes` touches the
 * trust root of the whole fabric. Nothing in this file is a step toward it.
 *
 * ## Why there is no disabled button
 *
 * UI-SPEC section 4.3: *a disabled control with no explanation is a placeholder wearing a
 * different hat*. And section 10 refuses outright to specify a control that produces
 * **refusals discovered as timeouts** — a button that looks like it works and hangs is worse
 * than no button, and it is the same failure the bring-your-own form's required record exists
 * to prevent, one workload over. The absence of the control is what puts `primes` in P5's
 * *skipped* list rather than its *exercised* one.
 *
 * ## The absence is prose, not an error
 *
 * Nothing on this surface renders in the refusal colour. UI-SPEC section 1.5 reserves
 * `--color-refusal` for a withheld frame, a refuted verdict, a provenance refusal in
 * bring-your-own, and `state[data-tone='blocked']`. **An absence is not an error**: no run
 * failed here, because none was attempted.
 *
 * ## No DOM, no globals, one record
 *
 * {@link format} takes nothing and returns a {@link SurfaceRender}: already-formatted strings
 * for all twelve regions, and the lines of `#primes-report`. Both come out of one pass,
 * so the rendered cards and the text view cannot format one value two ways — UI-SPEC section
 * 2.2's rule, which P6 in `packages/node/src/demo-region-properties.ts` holds against a real
 * page. Nothing here touches `document`, `window` or `window.o2`, and there is no `innerHTML`.
 */

import { PRIME_MAX_N } from '@o2/demo'
import { ARG_NOT_DISPATCHED, REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type { SurfaceRender } from '../render.ts'

/**
 * UI-SPEC section 4.3's surface-level copy, **verbatim**, rendered once as a panel above the
 * cards.
 *
 * Held here rather than as static prose in `index.html` for the reason Plan 27-05 removed the
 * lone-tab card's static copy: a sentence a spec asserts must have one author, and a sentence
 * typed into the markup and typed again into a spec is two sentences that can drift. The page
 * writes this constant into the panel by `textContent`; `demo-primes.e2e.test.ts` compares the
 * screen against this same export.
 */
export const NO_DISPATCH_PATH: string =
  'This workload has no dispatch path from a browser tab. The prime-counting module ships ' +
  'in this repository and runs in the Node test suite, but no signed record vouches for it, ' +
  'and every executor in this fabric refuses a module whose record no pinned anchor signed. ' +
  'The published figures below are measurements from a run recorded elsewhere; nothing on ' +
  'this screen is a reading from your tab.'

/**
 * The mockup's stated-weakness panel, **verbatim**, and it matters more here than anywhere.
 *
 * The oracle is the one check on this page whose authority does not come from this repository,
 * and this paragraph is the statement of where that authority runs out. Kept beside the panel
 * that says the check has nothing to check: a reader who takes only one thing from this
 * surface should take that the independent oracle exists, is blind in one direction, and is
 * currently unreachable from a tab.
 *
 * Prose, not a figure region — UI-SPEC section 4.3 says so explicitly, and the catalogue's
 * tally of twelve depends on it staying prose.
 */
export const STATED_WEAKNESS: string =
  'The oracle is blind in one direction. Published π values are quoted at powers of ten, and ' +
  'a power of ten sits far from the prime below it, so a guest that loses the top of its ' +
  'range returns the right total anyway. That hole is what the π series closes.'

/**
 * The published prime-counting function at four powers of ten — N10, and the only figures on
 * this surface that are not a named absence.
 *
 * **`cited`, and never a reading.** These are values published in the mathematical literature
 * long before this repository existed; that is exactly why the surface exists, since a
 * verifier sharing an author with the fabric cannot catch a misconception held in both. The
 * provenance travels in the same region as the numbers, so a figure cannot be separated from
 * the statement of where it came from.
 *
 * Written as `[exponent, count]` and the label composed, rather than as a hand-typed
 * `'10⁴'`: the superscript block is what `DIGIT` in `../../src/demo-regions.ts` had to be
 * widened for, and one table with the exponent typed twice is a table that can disagree with
 * itself about which x a count belongs to.
 */
export const ORACLE: readonly (readonly [exponent: number, count: number])[] = [
  [4, 1229],
  [5, 9592],
  [6, 78498],
  [7, 664579],
]

/** U+2070..U+2079, indexed by digit. The only way this file produces a superscript. */
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** `4` -> `10⁴`. Composed from {@link SUPERSCRIPTS} so no exponent is typed as a glyph. */
function powerOfTen(exponent: number): string {
  const digits = String(exponent)
    .split('')
    .map((digit) => SUPERSCRIPTS[Number(digit)] ?? digit)
    .join('')
  return `10${digits}`
}

/**
 * Where the oracle's counts were checked against this repository's own kernel — in a run that
 * was **not this tab**.
 *
 * The committed document records the prime kernel matching every published value at these four
 * bounds, including the largest, in a Node process on one machine. Naming the document is what
 * makes the claim checkable; naming the machine is what stops it being read as a reading from
 * the visitor's browser.
 */
const ORACLE_PROVENANCE: readonly string[] = [
  'Published in the mathematical literature; not computed here.',
  '',
  'The prime-counting module in this repository was measured against all four of these ' +
    'values and matched every one — recorded in docs/perf/prime-and-pi-benchmarks.md, ' +
    'under guest throughput. That was a Node process on one machine, in a run made ' +
    'elsewhere and at another time. It was not this tab, and no part of this screen is a ' +
    'reading from this tab.',
]

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's `unavailable` sentence for a region.
 *
 * Read from `../../src/demo-regions.ts` and never written here — the same rule
 * `surfaces/pi.ts` follows, and for a sharper reason on this surface: these sentences are what
 * every reading region shows **permanently**, and P3 compares the screen against the committed
 * catalogue. A sentence composed here would be a second author of the only copy this surface
 * has. A missing arm throws rather than falling back.
 */
function unavailable(id: string): string {
  const region = CATALOGUE.get(id)
  const sentence = region?.absence?.unavailable
  if (sentence === undefined) {
    throw new Error(`primes: "${id}" holds no unavailable arm in the catalogue`)
  }
  return sentence
}

/**
 * Every primes reading, derived from the catalogue and never listed.
 *
 * Exported so the page can assert against the same derivation the formatter uses. Deriving
 * rather than listing is what makes a thirteenth region — should UI-SPEC ever grow one — an
 * automatic member rather than something a reader has to notice.
 */
export const PRIMES_READING_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'primes' && region.kind === 'reading',
).map((region) => region.id)

/** The oracle table as text: a header row, then one row per published value. */
function oracleTable(): string[] {
  const rows = ORACLE.map(([exponent, count]) => `  ${powerOfTen(exponent).padEnd(6)} ${count}`)
  return ['  x      the count of primes below x', ...rows]
}

/**
 * The whole Primes surface — all twelve regions and the text view, from one pass.
 *
 * It takes no argument, and that is the surface's whole claim in one signature: there is no
 * reading to pass it. Every other surface's formatter on this page takes a run.
 *
 * All twelve are in the returned record. The two `control` regions carry
 * {@link ARG_NOT_DISPATCHED} read from the catalogue module rather than a literal typed into
 * the markup, because on this surface that copy is **permanent**: the four other argument
 * controls on the page are overwritten with a figure as soon as a peer list is discovered,
 * and these two never are.
 */
export function format(): SurfaceRender {
  const regions: Record<string, string> = {}

  // ---- N1, N2: the arguments a dispatch WOULD send ----
  //
  // `control`, not `reading`. Nothing has been asked of the fabric, so there is nothing to
  // read — and here there never will be. What they make visible is that the shape of the
  // request is known and only the path to send it is missing.
  regions['primes/n-arg'] = ARG_NOT_DISPATCHED
  regions['primes/shards-arg'] = ARG_NOT_DISPATCHED

  // ---- N3..N9, N11: every reading, at its unavailable sentence, permanently ----
  //
  // Derived from the catalogue rather than enumerated, so this loop cannot fall behind
  // UI-SPEC. Each sentence comes from `unavailable()`, i.e. from the committed catalogue, so
  // P3's comparison is between the screen and the catalogue rather than between the screen and
  // a copy this file holds.
  for (const id of PRIMES_READING_IDS) regions[id] = unavailable(id)

  // ---- N10: the published oracle, cited, with its provenance in the same region ----
  const table = oracleTable()
  regions['primes/oracle-table'] = [...table, '', ...ORACLE_PROVENANCE].join('\n').trim()

  // ---- N12: the constant, labelled with the symbol it came from ----
  //
  // Imported, never transcribed. UI-SPEC's N12 row names `@o2/demo.PRIME_MAX_N`, and the
  // symbol travels beside the value so a reader can check the claim without reading this file.
  regions['primes/max-n'] = `${PRIME_MAX_N} — @o2/demo.PRIME_MAX_N`

  // ---- the text view, from the same record ----
  const text: string[] = [
    NO_DISPATCH_PATH,
    '',
    'What a dispatch would send:',
    `  N       ${regions['primes/n-arg'] ?? ''}`,
    `  shards  ${regions['primes/shards-arg'] ?? ''}`,
    '',
    'What this tab has read:',
    ...PRIMES_READING_IDS.map((id) => `  ${id}: ${regions[id] ?? ''}`),
    '',
    'The published oracle this surface exists to be checked against:',
    ...table,
    '',
    ...ORACLE_PROVENANCE,
    '',
    `Largest bound the shipped module accepts: ${regions['primes/max-n'] ?? ''}`,
    '',
    STATED_WEAKNESS,
  ]

  return { regions, text }
}
